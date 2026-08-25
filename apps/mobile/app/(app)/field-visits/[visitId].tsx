import { useEffect, useMemo, useRef, useState } from "react"
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { CameraView, useCameraPermissions } from "expo-camera"
import * as Crypto from "expo-crypto"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import {
  enqueueFieldVisitAction,
  enqueueFieldVisitUpdate,
  fieldOutboxResult,
  readFieldCache,
  writeFieldCache,
} from "../../../src/db/local-store"
import type {
  FieldRoutePoint,
  FieldVisitRequirement,
  FieldVisitWorkspaceData,
} from "../../../src/field/contracts"
import type {
  FieldVisitOutcome,
  FieldVisitPotential,
} from "../../../src/field/execution-outbox"
import { useField } from "../../../src/field/field-context"
import { fieldErrorMessage } from "../../../src/field/error-message"
import {
  completeOptimisticFieldVisit,
  findFieldVisit,
  setOptimisticFieldVisitSyncState,
} from "../../../src/field/visit-cache"
import {
  addOptimisticVisitAction,
  addOptimisticVisitPhoto,
  buildVisitActionEvidence,
  emptyVisitActionDraft,
  hasFutureVisitNextAction,
  localFieldVisitWorkspace,
  mergeServerVisitWorkspace,
  missingRequiredVisitActions,
  setVisitActionSyncState,
  setVisitPhotoSyncState,
  setVisitWorkspaceSyncState,
  type FieldVisitActionDraft,
  visitActionDraftFromEvidence,
  visitActionDraftIssue,
  visitRequirementProgress,
} from "../../../src/field/visit-workspace"
import { persistAndQueueFieldVisitPhoto } from "../../../src/field/visit-photo-store"
import { getCurrentDeviceLocation } from "../../../src/location/device-location"
import { useSync } from "../../../src/sync/sync-context"
import { t, type MessageKey, useLocale } from "../../../src/i18n"
import { formatShortDateTime, formatTime } from "../../../src/i18n/date-format"
import { formatRouteTime, shiftDateKey } from "../../../src/field/route-time"
import { tenantDateKey } from "../../../src/field/tenant-time"
import { routeNavigationUrls, type RouteNavigationPlatform } from "../../../src/field/route-navigation"
import { colors, cardShadow, radii } from "../../../src/theme"
import {
  agentTaskStatusLabel,
  visitPhotoNeedsRetake,
  visitPhotoStateLabel,
} from "../../../src/field/labels"
import { TabIcon } from "../../../src/components/TabIcon"

const outcomes: FieldVisitOutcome[] = ["SUCCESSFUL", "PARTIAL", "NO_CONTACT", "RESCHEDULE"]
const potentials: FieldVisitPotential[] = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"]
const stockStates = ["AVAILABLE", "NOT_AVAILABLE", "UNKNOWN"] as const
const nextPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const
const RESCHEDULE_FOLLOW_UP_REQUIREMENT: FieldVisitRequirement = {
  actionKey: "NEXT_ACTION",
  mode: "REQUIRED",
  minCount: 1,
  conditions: null,
  allowWaiver: false,
}

function actionLabel(requirement: FieldVisitRequirement): string {
  return t(`visitAction_${requirement.actionKey}` as MessageKey)
}

export default function FieldVisitWorkspaceScreen() {
  const locale = useLocale()
  const { visitId } = useLocalSearchParams<{ visitId: string }>()
  const field = useField()
  const { sync } = useSync()
  const tenantTimeZone = field.week?.timezone ?? field.workday?.timezone ?? "UTC"
  const tenantToday = field.week?.today ?? field.workday?.today ?? tenantDateKey(new Date(), tenantTimeZone) ?? new Date().toISOString().slice(0, 10)
  const defaultFollowUpDate = shiftDateKey(tenantToday, 1)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView | null>(null)
  const visitScroll = useRef<ScrollView | null>(null)
  const editorOffset = useRef(0)
  const cacheKey = `field.visit.workspace.${visitId}`
  const cached = readFieldCache<FieldVisitWorkspaceData>(cacheKey)?.value ?? null
  const local = localFieldVisitWorkspace(field.week, visitId, field.profile?.agent.id ?? "")
  const [workspace, setWorkspace] = useState<FieldVisitWorkspaceData | null>(cached ?? local)
  const [activeRequirement, setActiveRequirement] = useState<FieldVisitRequirement | null>(null)
  const [actionDraft, setActionDraft] = useState<FieldVisitActionDraft>(() => emptyVisitActionDraft(defaultFollowUpDate))
  const [outcome, setOutcome] = useState<FieldVisitOutcome>("SUCCESSFUL")
  const [potential, setPotential] = useState<FieldVisitPotential>("UNKNOWN")
  const [resultNote, setResultNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [photoCameraOpen, setPhotoCameraOpen] = useState(false)

  const weekVisit = findFieldVisit(field.week, visitId)
  const requirements = workspace?.visit.requirementSnapshot?.requirements
    .filter((requirement) => requirement.mode !== "HIDDEN") ?? []
  const missing = useMemo(
    () => workspace ? missingRequiredVisitActions(workspace) : [],
    [workspace],
  )
  const hasRescheduleFollowUp = workspace
    ? hasFutureVisitNextAction(workspace, tenantToday, tenantTimeZone)
    : false
  const visibleRequirements = outcome === "RESCHEDULE" && !requirements.some(
    (requirement) => requirement.actionKey === "NEXT_ACTION",
  )
    ? [...requirements, RESCHEDULE_FOLLOW_UP_REQUIREMENT]
    : requirements
  const rescheduleFollowUpMissing = outcome === "RESCHEDULE" && !hasRescheduleFollowUp
  const relatedWork = useMemo(() => {
    if (!workspace) return []
    const seen = new Set<string>()
    return [...workspace.visit.tasks, ...workspace.reminders].filter((task) => {
      if (seen.has(task.id)) return false
      seen.add(task.id)
      return true
    })
  }, [workspace])

  function persist(next: FieldVisitWorkspaceData) {
    setWorkspace(next)
    writeFieldCache(cacheKey, next)
  }

  function openActionEditor(requirement: FieldVisitRequirement) {
    setActiveRequirement(requirement)
    const existingAction = [...(workspace?.visit.actionResults ?? [])].reverse().find((result) => (
      result.actionKey === requirement.actionKey && result.syncState !== "REJECTED"
    ))
    setActionDraft(visitActionDraftFromEvidence(
      requirement.actionKey,
      existingAction?.evidence,
      defaultFollowUpDate,
      tenantTimeZone,
    ))
    setTimeout(() => {
      visitScroll.current?.scrollTo({ y: Math.max(0, editorOffset.current - 14), animated: true })
    }, 48)
  }

  function updateActionDraft<Key extends keyof FieldVisitActionDraft>(
    key: Key,
    value: FieldVisitActionDraft[Key],
  ) {
    setActionDraft((current) => ({ ...current, [key]: value } as FieldVisitActionDraft))
  }

  function openRescheduleFollowUp() {
    openActionEditor(RESCHEDULE_FOLLOW_UP_REQUIREMENT)
  }

  async function refreshWorkspace(base: FieldVisitWorkspaceData | null = workspace) {
    try {
      const server = await fieldApi.visitWorkspace(visitId)
      const next = mergeServerVisitWorkspace(base, server)
      persist(next)
    } catch {
      if (!base && local) persist(local)
    }
  }

  useEffect(() => {
    if (!workspace && local) persist(local)
    void refreshWorkspace()
  // Initial cache/server hydration is tied to the visit id.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId])

  async function saveAction(status: "COMPLETED" | "WAIVED") {
    if (!activeRequirement || !workspace) return
    if (activeRequirement.actionKey === "PHOTO") return
    if (status === "WAIVED" && !activeRequirement.allowWaiver) return
    const issue = visitActionDraftIssue({
      actionKey: activeRequirement.actionKey,
      status,
      draft: actionDraft,
      afterDateKey: status === "COMPLETED" ? tenantToday : undefined,
      timeZone: tenantTimeZone,
    })
    if (issue) {
      Alert.alert(t(
        issue === "NEXT_ACTION_DATE"
          ? "fieldVisitFutureDateRequired"
          : issue === "STOCK_QUANTITY"
            ? "fieldVisitStockQuantityInvalid"
            : "fieldVisitFormRequired",
      ))
      return
    }
    setSaving(true)
    try {
      const completedAt = new Date().toISOString()
      const existingNextAction = activeRequirement.actionKey === "NEXT_ACTION"
        ? [...workspace.visit.actionResults].reverse().find((result) => (
          result.actionKey === "NEXT_ACTION" && result.syncState !== "REJECTED"
        ))
        : null
      const actionResultId = existingNextAction?.id ?? `field-action-${Crypto.randomUUID()}`
      const payload = {
        actionResultId,
        visitId,
        actionKey: activeRequirement.actionKey,
        status,
        evidence: buildVisitActionEvidence({
          actionKey: activeRequirement.actionKey,
          status,
          draft: actionDraft,
          completedAt,
          timeZone: tenantTimeZone,
        }),
        completedAt,
      } as const
      const queued = enqueueFieldVisitAction(payload)
      const optimistic = addOptimisticVisitAction(workspace, payload)
      persist(optimistic)
      setActiveRequirement(null)
      setActionDraft(emptyVisitActionDraft(defaultFollowUpDate))
      await sync()
      const result = fieldOutboxResult(queued.clientOpId)
      if (result?.status === "conflict" || result?.status === "rejected") {
        persist(setVisitActionSyncState(
          optimistic,
          actionResultId,
          result.status === "conflict" ? "CONFLICT" : "REJECTED",
        ))
        Alert.alert(t("syncNeedsAttention"))
      } else if (result?.status === "applied") {
        await refreshWorkspace(optimistic)
      } else {
        Alert.alert(t("fieldVisitActionQueued"))
      }
    } finally {
      setSaving(false)
    }
  }

  async function openPhotoCamera() {
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission()
    if (!permission.granted) {
      Alert.alert(t("cameraPermissionDenied"))
      return
    }
    setPhotoCameraOpen(true)
  }

  async function captureVisitPhoto() {
    if (!workspace || !field.profile || saving) return
    setSaving(true)
    try {
      const picture = await cameraRef.current?.takePictureAsync({ quality: 0.7, exif: true })
      if (!picture?.uri) return
      const location = await getCurrentDeviceLocation({ requestPermission: false }).catch(() => null)
      const takenAt = new Date().toISOString()
      const queued = await persistAndQueueFieldVisitPhoto({
        visitId,
        agentId: field.profile.agent.id,
        sourceUri: picture.uri,
        category: "visit",
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        takenAt,
      })
      const optimistic = addOptimisticVisitPhoto(workspace, {
        clientPhotoId: queued.payload.clientPhotoId,
        fileUri: queued.payload.fileUri,
        category: queued.payload.category,
        takenAt,
      })
      persist(optimistic)
      setPhotoCameraOpen(false)
      setActiveRequirement(null)
      Vibration.vibrate(40)
      await sync()
      const result = fieldOutboxResult(queued.clientOpId)
      if (result?.status === "conflict" || result?.status === "rejected") {
        persist(setVisitPhotoSyncState(
          optimistic,
          queued.payload.clientPhotoId,
          result.status === "conflict" ? "CONFLICT" : "REJECTED",
        ))
        Alert.alert(t("syncNeedsAttention"))
      } else if (result?.status === "applied") {
        await refreshWorkspace(optimistic)
      } else {
        Alert.alert(t("photoQueued"))
      }
    } catch (error) {
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "fieldVisitConflict"))
    } finally {
      setSaving(false)
    }
  }

  function checkout() {
    if (!workspace || !field.week) return
    if (missing.length > 0) {
      Alert.alert(t("fieldVisitMissingActions", { actions: missing.map(actionLabel).join(", ") }))
      return
    }
    if (rescheduleFollowUpMissing) {
      openRescheduleFollowUp()
      Alert.alert(t("fieldVisitRescheduleFollowUpRequired"))
      return
    }
    Alert.alert(t("fieldVisitCheckout"), t("fieldVisitCheckoutConfirm"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("fieldVisitCheckout"), onPress: () => void submitCheckout() },
    ])
  }

  async function submitCheckout() {
    if (!workspace || !field.week) return
    const checkedInWeek = field.week
    const checkedInWorkspace = workspace
    setSaving(true)
    try {
      const location = await getCurrentDeviceLocation({ requestPermission: false }).catch(() => null)
      const checkOutAt = new Date().toISOString()
      const queued = enqueueFieldVisitUpdate({
        visitId,
        status: "CHECKED_OUT",
        checkOutAt,
        checkOutLat: location?.latitude ?? null,
        checkOutLng: location?.longitude ?? null,
        outcome,
        potential,
        resultNotes: resultNote.trim() || null,
      })
      const optimisticWeek = completeOptimisticFieldVisit(field.week, {
        visitId,
        checkOutAt,
        outcome,
        potential,
        resultNotes: resultNote.trim() || null,
      })
      field.applyLocalWeek(optimisticWeek)
      persist({
        ...workspace,
        visit: {
          ...workspace.visit,
          status: "CHECKED_OUT",
          checkOutAt,
          outcome,
          potential,
          resultNotes: resultNote.trim() || null,
          syncState: "PENDING",
        },
      })
      await sync()
      const result = fieldOutboxResult(queued.clientOpId)
      if (result?.status === "conflict" || result?.status === "rejected") {
        const syncState = result.status === "conflict" ? "CONFLICT" : "REJECTED"
        field.applyLocalWeek(setOptimisticFieldVisitSyncState(
          checkedInWeek,
          visitId,
          syncState,
        ))
        const recovered = setVisitWorkspaceSyncState(checkedInWorkspace, syncState)
        persist(recovered)
        await refreshWorkspace(recovered)
        Alert.alert(t("syncNeedsAttention"))
        return
      }
      if (result?.status !== "applied") Alert.alert(t("fieldVisitResultQueued"))
      router.replace(`/(app)/routes/${workspace.visit.routeId}` as never)
    } catch (error) {
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "fieldVisitConflict"))
    } finally {
      setSaving(false)
    }
  }

  if (photoCameraOpen) {
    return (
      <SafeAreaView style={styles.cameraRoot} edges={["top", "bottom"]}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" mode="picture" />
        <View style={styles.cameraTop}>
          <Text style={styles.cameraTitle}>{t("visitAction_PHOTO")}</Text>
          <Text style={styles.cameraHint}>{t("fieldVisitPhotoCaptureHint")}</Text>
        </View>
        <View style={styles.cameraActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("cancel")}
            accessibilityState={{ disabled: saving, busy: saving }}
            disabled={saving}
            onPress={() => setPhotoCameraOpen(false)}
            style={({ pressed }) => [styles.cameraCancel, pressed && !saving && styles.pressed]}
          >
            <Text style={styles.cameraCancelText}>{t("cancel")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("takePhoto")}
            accessibilityHint={t("fieldVisitPhotoCaptureHint")}
            accessibilityState={{ disabled: saving, busy: saving }}
            disabled={saving}
            onPress={() => void captureVisitPhoto()}
            style={({ pressed }) => [styles.shutter, saving && styles.disabled, pressed && !saving && styles.pressed]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <View style={styles.cameraSpacer} />
        </View>
      </SafeAreaView>
    )
  }

  if (!workspace || !weekVisit) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.missing}>
          <Text style={styles.title}>{t("fieldDataError")}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("back")}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>{t("back")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  const customerName = workspace.visit.contact?.displayName ?? workspace.visit.customer.name
  const isCompleted = workspace.visit.status === "CHECKED_OUT"
  const visitAddress = [
    workspace.visit.customer.address,
    workspace.visit.customer.city,
  ].filter((value): value is string => Boolean(value)).join(", ")
  const visitPhone = workspace.visit.contact?.phone ?? workspace.visit.customer.phone ?? null
  const navigationPlatform: RouteNavigationPlatform = Platform.OS === "android"
    ? "android"
    : Platform.OS === "ios"
      ? "ios"
      : "other"
  const visitNavigationPoint: Pick<FieldRoutePoint, "customer" | "contact"> = {
    customer: {
      id: workspace.visit.customer.id,
      name: workspace.visit.customer.name,
      code: null,
      objectType: workspace.visit.customer.objectType,
      category: "",
      address: workspace.visit.customer.address ?? null,
      city: workspace.visit.customer.city ?? null,
      phone: workspace.visit.customer.phone ?? null,
      latitude: workspace.visit.customer.latitude ?? null,
      longitude: workspace.visit.customer.longitude ?? null,
    },
    contact: workspace.visit.contact ? {
      id: workspace.visit.contact.id,
      displayName: workspace.visit.contact.displayName,
      type: workspace.visit.contact.type,
      specialtyName: workspace.visit.contact.specialtyName ?? null,
      phone: workspace.visit.contact.phone ?? null,
    } : null,
  }
  const visitNavigationUrls = routeNavigationUrls(visitNavigationPoint, navigationPlatform)
  const plannedVisitTime = workspace.visit.routePoint?.plannedTime
    ? formatRouteTime(workspace.visit.routePoint.plannedTime, tenantTimeZone)
    : ""
  const hasVisitContext = Boolean(visitAddress || visitPhone || plannedVisitTime || visitNavigationUrls.length)
  const completedDraftIssue = activeRequirement && activeRequirement.actionKey !== "PHOTO"
    ? visitActionDraftIssue({
      actionKey: activeRequirement.actionKey,
      status: "COMPLETED",
      draft: actionDraft,
      afterDateKey: tenantToday,
      timeZone: tenantTimeZone,
    })
    : null
  const waiverDraftIssue = activeRequirement?.allowWaiver
    ? visitActionDraftIssue({
      actionKey: activeRequirement.actionKey,
      status: "WAIVED",
      draft: actionDraft,
    })
    : null
  const checkoutDisabled = saving || missing.length > 0 || rescheduleFollowUpMissing
  const checkoutButtonText = missing.length
    ? t("fieldVisitMissingActions", { actions: String(missing.length) })
    : rescheduleFollowUpMissing
      ? t("fieldVisitAddFollowUp")
      : t("fieldVisitCheckout")
  const checkoutHint = missing.length
    ? t("fieldVisitMissingActions", { actions: missing.map(actionLabel).join(", ") })
    : rescheduleFollowUpMissing
      ? t("fieldVisitRescheduleFollowUpRequired")
      : undefined

  async function openVisitNavigation() {
    if (!visitNavigationUrls.length) {
      Alert.alert(t("routeNoCoordinates"))
      return
    }
    try {
      for (const url of visitNavigationUrls) {
        if (await Linking.canOpenURL(url)) {
          await Linking.openURL(url)
          return
        }
      }
      Alert.alert(t("routeNavigationUnavailable"))
    } catch {
      Alert.alert(t("routeNavigationUnavailable"))
    }
  }

  async function openVisitPhone() {
    if (!visitPhone) return
    const phoneUrl = `tel:${visitPhone}`
    try {
      if (await Linking.canOpenURL(phoneUrl)) {
        await Linking.openURL(phoneUrl)
        return
      }
    } catch {
      // The device can reject an otherwise valid phone link (for example, without a dialler).
    }
    Alert.alert(t("fieldVisitCallUnavailable"))
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView ref={visitScroll} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("back")}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <TabIcon name="chevronLeft" color={colors.text} size={21} />
          </Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("fieldVisitTitle").toUpperCase()}</Text>
            <Text style={styles.title}>{customerName}</Text>
            {workspace.visit.contact ? <Text style={styles.subtitle}>{workspace.visit.customer.name}</Text> : null}
          </View>
          <View style={[styles.livePill, isCompleted && styles.donePill]}>
            <Text style={[styles.liveText, isCompleted && styles.doneText]}>{isCompleted ? t("fieldVisitDone") : t("visitInProgress")}</Text>
          </View>
        </View>

        <View style={styles.summaryCard}>
          <View><Text style={styles.summaryLabel}>{t("checkIn")}</Text><Text style={styles.summaryValue}>{formatTime(workspace.visit.checkInAt, tenantTimeZone)}</Text></View>
          <View style={styles.summaryDivider} />
          <View><Text style={styles.summaryLabel}>{t("fieldVisitPolicy")}</Text><Text style={styles.summaryValue}>{requirements.length}</Text></View>
          <View style={styles.summaryDivider} />
          <View><Text style={styles.summaryLabel}>{t("fieldVisitDone")}</Text><Text style={styles.summaryValue}>{requirements.filter((item) => visitRequirementProgress(workspace, item).satisfied).length}</Text></View>
        </View>

        {hasVisitContext ? (
          <View style={styles.contextCard}>
            <Text style={styles.contextTitle}>{t("fieldVisitContext")}</Text>
            <View style={styles.contextGrid}>
              {plannedVisitTime ? (
                <View style={styles.contextItem}>
                  <View style={styles.contextIcon}><TabIcon name="week" color={colors.primary} size={17} /></View>
                  <View style={styles.contextBody}>
                    <Text style={styles.contextLabel}>{t("plannedTime")}</Text>
                    <Text style={styles.contextValue}>{plannedVisitTime}</Text>
                  </View>
                </View>
              ) : null}
              {visitAddress ? (
                <View style={styles.contextItem}>
                  <View style={styles.contextIcon}><TabIcon name="location" color={colors.primary} size={17} /></View>
                  <View style={styles.contextBody}>
                    <Text style={styles.contextLabel}>{t("fieldVisitAddress")}</Text>
                    <Text numberOfLines={2} style={styles.contextValue}>{visitAddress}</Text>
                  </View>
                </View>
              ) : null}
              {visitPhone ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("fieldVisitCallContact")}
                  onPress={() => void openVisitPhone()}
                  style={({ pressed }) => [styles.contextItem, pressed && styles.pressed]}
                >
                  <View style={styles.contextIcon}><TabIcon name="contacts" color={colors.primary} size={17} /></View>
                  <View style={styles.contextBody}>
                    <Text style={styles.contextLabel}>{t("fieldVisitContactPhone")}</Text>
                    <Text numberOfLines={1} style={[styles.contextValue, styles.contextActionValue]}>{visitPhone}</Text>
                  </View>
                </Pressable>
              ) : null}
            </View>
            {visitNavigationUrls.length ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("routeOpenNavigation")}
                onPress={() => void openVisitNavigation()}
                style={({ pressed }) => [styles.contextNavigation, pressed && styles.pressed]}
              >
                <TabIcon name="route" color={colors.primary} size={17} />
                <Text style={styles.contextNavigationText}>{t("routeOpenNavigation")}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <View><Text style={styles.sectionTitle}>{t("fieldVisitActions")}</Text><Text style={styles.sectionHint}>{workspace.visit.requirementSnapshot?.sourcePolicy?.name ?? t("fieldVisitPolicy")}</Text></View>
          {missing.length ? <View style={styles.requiredCount}><Text style={styles.requiredCountText}>{missing.length}</Text></View> : null}
        </View>

        {visibleRequirements.map((requirement) => {
          const requirementProgress = visitRequirementProgress(workspace, requirement)
          const progress = outcome === "RESCHEDULE" && requirement.actionKey === "NEXT_ACTION"
            ? { completed: hasRescheduleFollowUp ? 1 : 0, required: 1, satisfied: hasRescheduleFollowUp }
            : requirementProgress
          const actionStatus = outcome === "RESCHEDULE" && requirement.actionKey === "NEXT_ACTION"
            ? t(progress.satisfied ? "fieldVisitFollowUpReady" : "fieldVisitFollowUpNeeded")
            : requirement.mode === "REQUIRED"
              ? t("fieldVisitRequired")
              : t("fieldVisitOptional")
          const actionMeta = `${actionStatus} · ${progress.completed}/${progress.required}`
          return (
            <Pressable
              key={requirement.actionKey}
              disabled={isCompleted}
              accessibilityRole="button"
              accessibilityLabel={`${actionLabel(requirement)}. ${actionMeta}`}
              accessibilityState={{
                disabled: isCompleted,
                selected: activeRequirement?.actionKey === requirement.actionKey,
              }}
              onPress={() => openActionEditor(requirement)}
              style={({ pressed }) => [
                styles.actionCard,
                progress.satisfied && styles.actionCardDone,
                isCompleted && styles.actionCardDisabled,
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.actionMark, progress.satisfied && styles.actionMarkDone]}>
                <TabIcon
                  name={progress.satisfied ? "check" : requirement.mode === "REQUIRED" ? "alert" : "add"}
                  color={progress.satisfied ? colors.successDark : colors.warning}
                  size={20}
                />
              </View>
              <View style={styles.actionBody}>
                <Text style={styles.actionTitle}>{actionLabel(requirement)}</Text>
                <Text style={styles.actionMeta}>{actionMeta}</Text>
              </View>
              <TabIcon name="chevronRight" color={colors.faint} size={20} />
            </Pressable>
          )
        })}

        {activeRequirement ? (
          <View onLayout={(event) => { editorOffset.current = event.nativeEvent.layout.y }} style={styles.editorCard}>
            <Text style={styles.editorTitle}>{actionLabel(activeRequirement)}</Text>
            {activeRequirement.actionKey === "PHOTO" ? (
              <>
                <Text style={styles.editorHint}>{t("fieldVisitPhotoCaptureHint")}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("takePhoto")}
                  accessibilityHint={t("fieldVisitPhotoCaptureHint")}
                  accessibilityState={{ disabled: saving, busy: saving }}
                  disabled={saving}
                  onPress={() => void openPhotoCamera()}
                  style={({ pressed }) => [styles.photoButton, pressed && !saving && styles.pressed]}
                >
                  <TabIcon name="camera" color={colors.headerText} size={18} />
                  <Text style={styles.photoButtonText}>{t("takePhoto")}</Text>
                </Pressable>
              </>
            ) : (
              <>
                {activeRequirement.actionKey === "PRESENTATION" ? (
                  <>
                    <Text style={styles.label}>{t("fieldVisitPresentationMaterial")}</Text>
                    <TextInput accessibilityLabel={t("fieldVisitPresentationMaterial")} value={actionDraft.presentationMaterial} onChangeText={(value) => updateActionDraft("presentationMaterial", value)} style={styles.input} />
                    <Text style={styles.label}>{t("fieldVisitPresentationVersion")}</Text>
                    <TextInput accessibilityLabel={t("fieldVisitPresentationVersion")} value={actionDraft.presentationVersion} onChangeText={(value) => updateActionDraft("presentationVersion", value)} style={styles.input} />
                    <Text style={styles.label}>{t("fieldVisitPresentationTopic")}</Text>
                    <TextInput accessibilityLabel={t("fieldVisitPresentationTopic")} value={actionDraft.presentationTopic} onChangeText={(value) => updateActionDraft("presentationTopic", value)} style={styles.input} />
                  </>
                ) : null}
                {activeRequirement.actionKey === "STOCK_CHECK" ? (
                  <>
                    <Text style={styles.label}>{t("fieldVisitStockProduct")}</Text>
                    <TextInput accessibilityLabel={t("fieldVisitStockProduct")} value={actionDraft.stockProduct} onChangeText={(value) => updateActionDraft("stockProduct", value)} style={styles.input} />
                    <Text style={styles.label}>{t("fieldVisitStockState")}</Text>
                    <View style={styles.chips}>
                      {stockStates.map((state) => (
                        <Pressable
                          key={state}
                          accessibilityRole="button"
                          accessibilityLabel={t(`fieldVisitStockState_${state}` as MessageKey)}
                          accessibilityState={{ selected: actionDraft.stockState === state }}
                          onPress={() => updateActionDraft("stockState", state)}
                          style={({ pressed }) => [styles.chip, actionDraft.stockState === state && styles.chipSelected, pressed && styles.pressed]}
                        >
                          <Text style={[styles.chipText, actionDraft.stockState === state && styles.chipTextSelected]}>{t(`fieldVisitStockState_${state}` as MessageKey)}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={styles.label}>{t("fieldVisitStockQuantity")}</Text>
                    <TextInput accessibilityLabel={t("fieldVisitStockQuantity")} value={actionDraft.stockQuantity} onChangeText={(value) => updateActionDraft("stockQuantity", value)} keyboardType="decimal-pad" style={styles.input} />
                  </>
                ) : null}
                {activeRequirement.actionKey === "CHECKLIST" ? (
                  <>
                    <Text style={styles.label}>{t("fieldVisitChecklistResult")}</Text>
                    <TextInput accessibilityLabel={t("fieldVisitChecklistResult")} value={actionDraft.checklistResult} onChangeText={(value) => updateActionDraft("checklistResult", value)} multiline textAlignVertical="top" style={styles.textarea} />
                  </>
                ) : null}
                {activeRequirement.actionKey === "VISIT_NOTE" ? (
                  <>
                    <Text style={styles.label}>{t("fieldVisitDiscussedTopics")}</Text>
                    <TextInput accessibilityLabel={t("fieldVisitDiscussedTopics")} accessibilityHint={t("fieldVisitDiscussedTopicsHint")} value={actionDraft.discussedTopics} onChangeText={(value) => updateActionDraft("discussedTopics", value)} placeholder={t("fieldVisitDiscussedTopicsHint")} style={styles.input} />
                    <Text style={styles.label}>{t("fieldVisitFinalNote")}</Text>
                    <TextInput accessibilityLabel={t("fieldVisitFinalNote")} value={actionDraft.finalNote} onChangeText={(value) => updateActionDraft("finalNote", value)} multiline textAlignVertical="top" style={styles.textarea} />
                  </>
                ) : null}
                {activeRequirement.actionKey === "FEEDBACK" ? (
                  <>
                    <Text style={styles.label}>{t("fieldVisitFeedback")}</Text>
                    <TextInput accessibilityLabel={t("fieldVisitFeedback")} value={actionDraft.feedback} onChangeText={(value) => updateActionDraft("feedback", value)} multiline textAlignVertical="top" style={styles.textarea} />
                  </>
                ) : null}
                {activeRequirement.actionKey === "NEXT_ACTION" ? (
                  <>
                    <Text style={styles.editorHint}>{t("fieldVisitNextActionHint")}</Text>
                    <Text style={styles.label}>{t("fieldVisitNextActionTitle")}</Text>
                    <TextInput accessibilityLabel={t("fieldVisitNextActionTitle")} accessibilityHint={t("fieldVisitNextActionHint")} value={actionDraft.nextActionTitle} onChangeText={(value) => updateActionDraft("nextActionTitle", value)} style={styles.input} />
                    <Text style={styles.label}>{t("due")}</Text>
                    <TextInput accessibilityLabel={t("due")} accessibilityHint={t("dateInputHint")} value={actionDraft.nextDueDate} onChangeText={(value) => updateActionDraft("nextDueDate", value)} placeholder={t("dateInputHint")} style={styles.input} />
                    <Text style={styles.label}>{t("fieldVisitNextActionTime")}</Text>
                    <TextInput accessibilityLabel={t("fieldVisitNextActionTime")} value={actionDraft.nextDueTime} onChangeText={(value) => updateActionDraft("nextDueTime", value)} placeholder="09:00" keyboardType="numbers-and-punctuation" style={styles.input} />
                    <Text style={styles.label}>{t("fieldVisitPriority")}</Text>
                    <View style={styles.chips}>
                      {nextPriorities.map((priority) => (
                        <Pressable
                          key={priority}
                          accessibilityRole="button"
                          accessibilityLabel={t(`agentTaskPriority_${priority}` as MessageKey)}
                          accessibilityState={{ selected: actionDraft.nextPriority === priority }}
                          onPress={() => updateActionDraft("nextPriority", priority)}
                          style={({ pressed }) => [styles.chip, actionDraft.nextPriority === priority && styles.chipSelected, pressed && styles.pressed]}
                        >
                          <Text style={[styles.chipText, actionDraft.nextPriority === priority && styles.chipTextSelected]}>{t(`agentTaskPriority_${priority}` as MessageKey)}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : null}
                {activeRequirement.allowWaiver ? (
                  <>
                    <Text style={styles.label}>{t("fieldVisitWaiverReason")}</Text>
                    <TextInput accessibilityLabel={t("fieldVisitWaiverReason")} value={actionDraft.waiverReason} onChangeText={(value) => updateActionDraft("waiverReason", value)} multiline textAlignVertical="top" style={styles.textarea} />
                  </>
                ) : null}
              </>
            )}
            <View style={styles.editorActions}>
              <Pressable accessibilityRole="button" accessibilityLabel={t("cancel")} onPress={() => setActiveRequirement(null)} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryText}>{t("cancel")}</Text></Pressable>
              {activeRequirement.actionKey !== "PHOTO" && activeRequirement.allowWaiver ? <Pressable accessibilityRole="button" accessibilityLabel={t("fieldVisitWaiveAction")} accessibilityState={{ disabled: saving || Boolean(waiverDraftIssue), busy: saving }} disabled={saving || Boolean(waiverDraftIssue)} onPress={() => void saveAction("WAIVED")} style={({ pressed }) => [styles.waiveButton, (saving || Boolean(waiverDraftIssue)) && styles.disabled, pressed && !saving && !waiverDraftIssue && styles.pressed]}><Text style={styles.waiveText}>{t("fieldVisitWaiveAction")}</Text></Pressable> : null}
              {activeRequirement.actionKey !== "PHOTO" ? <Pressable accessibilityRole="button" accessibilityLabel={t("fieldVisitSaveAction")} accessibilityState={{ disabled: saving || Boolean(completedDraftIssue), busy: saving }} disabled={saving || Boolean(completedDraftIssue)} onPress={() => void saveAction("COMPLETED")} style={({ pressed }) => [styles.primaryButton, (saving || Boolean(completedDraftIssue)) && styles.disabled, pressed && !saving && !completedDraftIssue && styles.pressed]}><Text style={styles.primaryText}>{t("fieldVisitSaveAction")}</Text></Pressable> : null}
            </View>
          </View>
        ) : null}

        <View style={styles.evidenceSection}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>{t("fieldVisitEvidenceHistory")}</Text>
              <Text style={styles.sectionHint}>{t("fieldVisitEvidenceHistoryHint")}</Text>
            </View>
          </View>

          <View style={styles.evidenceGroup}>
            <View style={styles.evidenceGroupHeader}>
              <View style={styles.evidenceGroupIcon}><TabIcon name="camera" color={colors.primary} size={18} /></View>
              <Text style={styles.evidenceGroupTitle}>{t("fieldVisitPhotoEvidence")}</Text>
            </View>
            {workspace.visit.photos.length ? workspace.visit.photos.map((photo) => {
              const needsRetake = visitPhotoNeedsRetake(photo.status, photo.syncState)
              return (
                <View key={photo.id} style={[styles.evidenceRow, needsRetake && styles.evidenceRowAttention]}>
                  <View style={[styles.evidenceMark, needsRetake && styles.evidenceMarkAttention]}>
                    <TabIcon name="camera" color={needsRetake ? colors.missed : colors.primary} size={17} />
                  </View>
                  <View style={styles.evidenceBody}>
                    <Text style={[styles.evidenceState, needsRetake && styles.evidenceStateAttention]}>
                      {visitPhotoStateLabel(photo.status, photo.syncState)}
                    </Text>
                    <Text style={styles.evidenceMeta}>{formatShortDateTime(photo.createdAt, locale, tenantTimeZone)}</Text>
                  </View>
                  {needsRetake && !isCompleted ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("retakeShot")}
                      accessibilityHint={t("fieldVisitPhotoCaptureHint")}
                      onPress={() => void openPhotoCamera()}
                      style={({ pressed }) => [styles.retakeButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.retakeText}>{t("retakeShot")}</Text>
                    </Pressable>
                  ) : null}
                </View>
              )
            }) : (
              <View style={styles.evidenceEmpty}>
                <Text style={styles.evidenceEmptyTitle}>{t("fieldVisitNoPhotoEvidence")}</Text>
                <Text style={styles.evidenceEmptyHint}>{t("fieldVisitNoPhotoEvidenceHint")}</Text>
                {!isCompleted ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("takePhoto")}
                    accessibilityHint={t("fieldVisitPhotoCaptureHint")}
                    onPress={() => void openPhotoCamera()}
                    style={({ pressed }) => [styles.photoProofButton, pressed && styles.pressed]}
                  >
                    <TabIcon name="camera" color={colors.headerText} size={17} />
                    <Text style={styles.photoProofText}>{t("takePhoto")}</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>

          <View style={styles.evidenceGroup}>
            <View style={styles.evidenceGroupHeader}>
              <View style={styles.evidenceGroupIcon}><TabIcon name="tasks" color={colors.primary} size={18} /></View>
              <Text style={styles.evidenceGroupTitle}>{t("fieldVisitLinkedWork")}</Text>
            </View>
            {relatedWork.length ? relatedWork.map((task) => (
              <Pressable
                key={task.id}
                accessibilityRole="button"
                accessibilityLabel={`${t("fieldVisitOpenTask")}: ${task.title}`}
                onPress={() => router.push(`/(app)/field-tasks/${task.id}` as never)}
                style={({ pressed }) => [styles.workRow, pressed && styles.pressed]}
              >
                <View style={styles.workMark}><TabIcon name="tasks" color={colors.info} size={17} /></View>
                <View style={styles.evidenceBody}>
                  <Text numberOfLines={1} style={styles.workTitle}>{task.title}</Text>
                  <Text numberOfLines={1} style={styles.evidenceMeta}>
                    {agentTaskStatusLabel(task.status) + (task.dueDate ? ` · ${t("due")} ${formatShortDateTime(task.dueDate, locale, tenantTimeZone)}` : "")}
                  </Text>
                </View>
                <TabIcon name="chevronRight" color={colors.faint} size={20} />
              </Pressable>
            )) : (
              <View style={styles.evidenceEmpty}>
                <Text style={styles.evidenceEmptyTitle}>{t("fieldVisitNoLinkedWork")}</Text>
              </View>
            )}
          </View>
        </View>

        {!isCompleted ? (
          <View style={styles.resultCard}>
            <Text style={styles.sectionTitle}>{t("fieldVisitCheckout")}</Text>
            <Text style={styles.label}>{t("fieldVisitOutcome")}</Text>
            <View style={styles.chips}>{outcomes.map((item) => <Pressable key={item} accessibilityRole="button" accessibilityLabel={t(`visitOutcome_${item}` as MessageKey)} accessibilityState={{ selected: outcome === item }} onPress={() => { setOutcome(item); if (item === "RESCHEDULE" && !hasRescheduleFollowUp) openRescheduleFollowUp() }} style={({ pressed }) => [styles.chip, outcome === item && styles.chipSelected, pressed && styles.pressed]}><Text style={[styles.chipText, outcome === item && styles.chipTextSelected]}>{t(`visitOutcome_${item}` as MessageKey)}</Text></Pressable>)}</View>
            {outcome === "RESCHEDULE" ? <View style={[styles.followUpNotice, hasRescheduleFollowUp && styles.followUpNoticeReady]}><Text style={[styles.followUpNoticeText, hasRescheduleFollowUp && styles.followUpNoticeTextReady]}>{t(hasRescheduleFollowUp ? "fieldVisitFollowUpReady" : "fieldVisitRescheduleFollowUpRequired")}</Text></View> : null}
            <Text style={styles.label}>{t("fieldVisitPotential")}</Text>
            <View style={styles.chips}>{potentials.map((item) => <Pressable key={item} accessibilityRole="button" accessibilityLabel={t(`visitPotential_${item}` as MessageKey)} accessibilityState={{ selected: potential === item }} onPress={() => setPotential(item)} style={({ pressed }) => [styles.chip, potential === item && styles.chipSelected, pressed && styles.pressed]}><Text style={[styles.chipText, potential === item && styles.chipTextSelected]}>{t(`visitPotential_${item}` as MessageKey)}</Text></Pressable>)}</View>
            <Text style={styles.label}>{t("fieldVisitResultNote")}</Text>
            <TextInput accessibilityLabel={t("fieldVisitResultNote")} value={resultNote} onChangeText={setResultNote} multiline textAlignVertical="top" style={styles.textarea} />
            <Pressable accessibilityRole="button" accessibilityLabel={checkoutButtonText} accessibilityHint={checkoutHint} accessibilityState={{ disabled: checkoutDisabled, busy: saving }} disabled={checkoutDisabled} onPress={checkout} style={({ pressed }) => [styles.checkoutButton, checkoutDisabled && styles.disabled, pressed && !checkoutDisabled && styles.pressed]}><Text style={styles.checkoutText}>{checkoutButtonText}</Text></Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 34 },
  header: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 10, marginTop: 2 },
  livePill: { maxWidth: 92, borderRadius: radii.pill, backgroundColor: colors.warningBg, paddingHorizontal: 9, paddingVertical: 7 },
  liveText: { color: colors.warning, fontSize: 8, fontWeight: "900", textAlign: "center" },
  donePill: { backgroundColor: colors.successBg }, doneText: { color: colors.successDark },
  summaryCard: { marginHorizontal: 14, marginTop: 10, minHeight: 76, borderRadius: radii.card, padding: 14, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "space-around", ...cardShadow },
  summaryLabel: { color: colors.headerSubtext, fontSize: 8, fontWeight: "900", textTransform: "uppercase", textAlign: "center" },
  summaryValue: { color: colors.headerText, fontSize: 18, fontWeight: "900", textAlign: "center", marginTop: 4 },
  summaryDivider: { width: 1, height: 34, backgroundColor: "rgba(255,255,255,0.2)" },
  contextCard: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  contextTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  contextGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  contextItem: { minHeight: 50, flexGrow: 1, flexBasis: "44%", flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radii.inner, padding: 9, backgroundColor: colors.bg },
  contextIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  contextBody: { flex: 1, minWidth: 0 },
  contextLabel: { color: colors.muted, fontSize: 8, fontWeight: "800", textTransform: "uppercase" },
  contextValue: { color: colors.text, fontSize: 11, fontWeight: "800", marginTop: 2 },
  contextActionValue: { color: colors.primary },
  contextNavigation: { minHeight: 44, marginTop: 10, borderRadius: radii.inner, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  contextNavigationText: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  sectionHeader: { marginHorizontal: 16, marginTop: 22, marginBottom: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  sectionHint: { color: colors.muted, fontSize: 9, marginTop: 3 },
  requiredCount: { minWidth: 28, height: 28, borderRadius: 14, backgroundColor: colors.missedBg, alignItems: "center", justifyContent: "center" },
  requiredCountText: { color: colors.missed, fontSize: 11, fontWeight: "900" },
  actionCard: { marginHorizontal: 14, marginTop: 8, minHeight: 70, borderRadius: radii.card, padding: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 11 },
  actionCardDone: { borderColor: colors.successBorder, backgroundColor: colors.successBg },
  actionCardDisabled: { opacity: 0.76 },
  actionMark: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.warningBg, alignItems: "center", justifyContent: "center" },
  actionMarkDone: { backgroundColor: colors.card },
  actionBody: { flex: 1 }, actionTitle: { color: colors.text, fontSize: 13, fontWeight: "900" }, actionMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },
  editorCard: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary, ...cardShadow },
  editorTitle: { color: colors.text, fontSize: 15, fontWeight: "900" }, editorHint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  label: { color: colors.text, fontSize: 11, fontWeight: "800", marginTop: 13, marginBottom: 6 },
  input: { minHeight: 46, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, color: colors.text, backgroundColor: colors.bg },
  textarea: { minHeight: 88, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, padding: 12, color: colors.text, backgroundColor: colors.bg },
  editorActions: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 7, marginTop: 12 },
  secondaryButton: { minHeight: 44, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" }, secondaryText: { color: colors.text, fontSize: 10, fontWeight: "800" },
  waiveButton: { minHeight: 44, borderRadius: radii.inner, backgroundColor: colors.warningBg, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" }, waiveText: { color: colors.warning, fontSize: 10, fontWeight: "900" },
  primaryButton: { minHeight: 44, borderRadius: radii.inner, backgroundColor: colors.primary, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" }, primaryText: { color: colors.headerText, fontSize: 10, fontWeight: "900" },
  resultCard: { marginHorizontal: 14, marginTop: 20, borderRadius: radii.card, padding: 15, backgroundColor: colors.card, ...cardShadow },
  evidenceSection: { marginTop: 20 },
  evidenceGroup: { marginHorizontal: 14, marginTop: 9, borderRadius: radii.card, padding: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  evidenceGroupHeader: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 7 },
  evidenceGroupIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  evidenceGroupTitle: { flex: 1, color: colors.text, fontSize: 12, fontWeight: "900" },
  evidenceRow: { minHeight: 54, paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 9, borderTopWidth: 1, borderTopColor: colors.border },
  evidenceRowAttention: { borderTopColor: colors.dangerBorder },
  evidenceMark: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  evidenceMarkAttention: { backgroundColor: colors.dangerBg },
  evidenceBody: { flex: 1, minWidth: 0 },
  evidenceState: { color: colors.text, fontSize: 11, fontWeight: "900" },
  evidenceStateAttention: { color: colors.missed },
  evidenceMeta: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 2 },
  retakeButton: { minHeight: 44, borderRadius: radii.inner, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: colors.dangerBorder },
  retakeText: { color: colors.missed, fontSize: 9, fontWeight: "900" },
  evidenceEmpty: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, paddingBottom: 2 },
  evidenceEmptyTitle: { color: colors.text, fontSize: 11, fontWeight: "900" },
  evidenceEmptyHint: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 3 },
  photoProofButton: { alignSelf: "flex-start", minHeight: 44, marginTop: 10, borderRadius: radii.inner, paddingHorizontal: 12, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", gap: 7 },
  photoProofText: { color: colors.headerText, fontSize: 10, fontWeight: "900" },
  workRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 9, borderTopWidth: 1, borderTopColor: colors.border },
  workMark: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.infoBg },
  workTitle: { color: colors.text, fontSize: 11, fontWeight: "900" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, chip: { minHeight: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }, chipSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary }, chipText: { color: colors.muted, fontSize: 9, fontWeight: "800" }, chipTextSelected: { color: colors.primary },
  followUpNotice: { marginTop: 11, borderRadius: radii.inner, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: colors.warningBg }, followUpNoticeReady: { backgroundColor: colors.successBg }, followUpNoticeText: { color: colors.warning, fontSize: 9, lineHeight: 14, fontWeight: "800" }, followUpNoticeTextReady: { color: colors.successDark },
  checkoutButton: { minHeight: 52, borderRadius: radii.inner, backgroundColor: colors.success, alignItems: "center", justifyContent: "center", marginTop: 15, paddingHorizontal: 12 }, checkoutText: { color: colors.headerText, fontSize: 13, fontWeight: "900", textAlign: "center" },
  pressed: { opacity: 0.72 }, disabled: { opacity: 0.38 },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  photoButton: { minHeight: 50, marginTop: 13, borderRadius: radii.inner, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  photoButtonText: { color: colors.headerText, fontSize: 13, fontWeight: "900" },
  cameraRoot: { flex: 1, backgroundColor: "#08111E" },
  camera: { flex: 1 },
  cameraTop: { position: "absolute", top: 24, left: 18, right: 18, borderRadius: radii.card, padding: 14, backgroundColor: "rgba(8,17,30,0.78)" },
  cameraTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
  cameraHint: { color: "rgba(255,255,255,0.74)", fontSize: 11, lineHeight: 16, marginTop: 4 },
  cameraActions: { position: "absolute", left: 20, right: 20, bottom: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cameraCancel: { width: 76, minHeight: 46, borderRadius: radii.pill, backgroundColor: "rgba(8,17,30,0.78)", alignItems: "center", justifyContent: "center" },
  cameraCancelText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#FFFFFF" },
  cameraSpacer: { width: 76 },
})
