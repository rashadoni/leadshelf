import { useEffect, useMemo, useState } from "react"
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import * as Crypto from "expo-crypto"
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"
import type { FieldRoutePoint } from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import { RouteTargetPicker, routeTargetKey, type RouteTarget } from "../../../src/field/route-target-picker"
import { addMinutesToRouteTime, findRouteTimeConflicts, formatRouteTime, isValidRouteTime, routePlannedTime } from "../../../src/field/route-time"
import { setOptimisticRouteSyncState, updateOptimisticRoute } from "../../../src/field/route-cache"
import {
  enqueueFieldVisitCheckIn,
  enqueueFieldRouteChangeRequest,
  enqueueFieldRoutePublish,
  enqueueFieldRouteUpdate,
  fieldRouteConflictRecovery,
  fieldRouteOutboxResult,
  fieldRouteServerId,
  fieldOutboxResult,
  returnFieldRoutePublishToDraft,
} from "../../../src/db/local-store"
import { useSync } from "../../../src/sync/sync-context"
import { routeStatusMeta, type RouteStatusTone } from "../../../src/field/week-status"
import { t, useLocale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"
import { getCurrentDeviceLocation } from "../../../src/location/device-location"
import { resolveFieldRouteFlow, type FieldRouteStepState } from "../../../src/field/route-flow"
import { fieldErrorMessage, fieldRouteConflictMessage, fieldRouteMutationErrorMessage } from "../../../src/field/error-message"
import { parseFieldRouteMutationConflict, routeConflictPointIndexes } from "../../../src/field/route-conflict"
import { routeNavigationUrls, type RouteNavigationPlatform } from "../../../src/field/route-navigation"
import { TabIcon } from "../../../src/components/TabIcon"
import { contactTypeLabel, objectTypeLabel } from "../../../src/field/labels"
import {
  setOptimisticFieldVisitSyncState,
  startOptimisticFieldVisit,
} from "../../../src/field/visit-cache"

const tones: Record<RouteStatusTone, { bg: string; border: string; text: string }> = {
  draft: { bg: colors.draftBg, border: colors.draftBorder, text: colors.draft },
  planned: { bg: colors.infoBg, border: colors.infoBorder, text: colors.info },
  inProgress: { bg: colors.warningBg, border: "#F6D788", text: colors.warning },
  completed: { bg: colors.successBg, border: colors.successBorder, text: colors.successDark },
  cancelled: { bg: colors.draftBg, border: colors.draftBorder, text: colors.draft },
  missed: { bg: colors.missedBg, border: colors.missedBorder, text: colors.missed },
}

function reorder(points: FieldRoutePoint[], from: number, to: number): FieldRoutePoint[] {
  if (to < 0 || to >= points.length) return points
  const next = [...points]
  const [moved] = next.splice(from, 1)
  if (!moved) return points
  next.splice(to, 0, moved)
  return next.map((point, index) => ({ ...point, orderIndex: index + 1 }))
}

function routeStepLabel(state: FieldRouteStepState): string {
  if (state === "completed") return t("routeCompletedStop")
  if (state === "active") return t("routeCurrentVisit")
  if (state === "next") return t("routeNextStop")
  if (state === "missed") return t("routeMissedStop")
  return t("routeUpcomingStop")
}

function routePointSubject(point: FieldRoutePoint): string | null {
  if (!point.contact) return null
  return (point.contact.specialtyName ?? contactTypeLabel(point.contact.type)) + " · " + point.customer.name
}

function routePointMeta(point: FieldRoutePoint): string {
  return point.customer.address ?? point.customer.city ?? objectTypeLabel(point.customer.objectType)
}

export default function FieldRouteDetailScreen() {
  useLocale()
  const { routeId } = useLocalSearchParams<{ routeId: string }>()
  const field = useField()
  const { sync, status: syncStatus } = useSync()
  const insets = useSafeAreaInsets()
  const routeData = useMemo(
    () => field.week?.days.flatMap((day) => day.routes).find((route) => route.id === routeId) ?? null,
    [field.week, routeId],
  )
  const [name, setName] = useState("")
  const [notes, setNotes] = useState("")
  const [points, setPoints] = useState<FieldRoutePoint[]>([])
  const [timeInputs, setTimeInputs] = useState<Record<string, string>>({})
  const [routeConflictDetail, setRouteConflictDetail] = useState<unknown>(null)
  const [routeConflictClientOpId, setRouteConflictClientOpId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [requestPoint, setRequestPoint] = useState<FieldRoutePoint | null>(null)
  const [reason, setReason] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [addRequestTarget, setAddRequestTarget] = useState<RouteTarget | null>(null)
  const [addReason, setAddReason] = useState("")
  const [checkingInPointId, setCheckingInPointId] = useState<string | null>(null)
  const durableRouteConflict = useMemo(
    () => routeData?.syncState ? fieldRouteConflictRecovery(routeData.id) : null,
    [routeData?.id, routeData?.syncState],
  )
  const activeRouteConflictDetail = routeConflictDetail ?? durableRouteConflict?.detail ?? null
  const routeConflict = useMemo(
    () => parseFieldRouteMutationConflict(activeRouteConflictDetail),
    [activeRouteConflictDetail],
  )
  const localTimeConflicts = useMemo(
    () => findRouteTimeConflicts(points.map((point) => timeInputs[point.id] ?? "")),
    [points, timeInputs],
  )
  const conflictingPointIndexes = useMemo(
    () => new Set([
      ...localTimeConflicts.flatMap((conflict) => conflict.indexes),
      ...routeConflictPointIndexes(routeConflict),
    ]),
    [localTimeConflicts, routeConflict],
  )

  useEffect(() => {
    if (!routeData) return
    setName(routeData.name ?? "")
    setNotes(routeData.notes ?? "")
    setPoints(routeData.points)
    setTimeInputs(Object.fromEntries(routeData.points.map((point) => [
      point.id,
      formatRouteTime(point.plannedTime, field.week?.timezone ?? "UTC"),
    ])))
  }, [field.week?.timezone, routeData])

  useEffect(() => {
    if (!routeId?.startsWith("local-route-") || !syncStatus.lastSyncAt || !field.week) return
    const serverRouteId = fieldRouteServerId(routeId)
    if (!serverRouteId) return
    void field.loadWeek(field.week.weekStart).then(() => {
      router.replace(`/(app)/routes/${serverRouteId}` as never)
    })
  // Server-id reconciliation is keyed by the completed sync timestamp.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, syncStatus.lastSyncAt])

  if (!routeData) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>{t("fieldDataError")}</Text>
          <Pressable onPress={() => router.back()} style={styles.primaryButton}><Text style={styles.primaryText}>{t("back")}</Text></Pressable>
        </View>
      </SafeAreaView>
    )
  }

  const meta = routeStatusMeta(routeData.effectiveStatus)
  const tone = tones[meta.tone]
  const canRequestStopRemoval = ["PLANNED", "IN_PROGRESS"].includes(routeData.persistedStatus)
  const canRequestStopAddition = canRequestStopRemoval
  const excludedTargets = new Set(points.map((point) => routeTargetKey(point.customerId, point.contactId)))
  const activeVisit = field.week?.days
    .flatMap((day) => day.visits.items)
    .find((visit) => visit.status === "CHECKED_IN") ?? null
  const routePoints = routeData.canEdit ? points : routeData.points
  const routeFlow = resolveFieldRouteFlow({ id: routeData.id, points: routePoints }, activeVisit)
  const activeVisitForRoute = activeVisit?.routeId === routeData.id ? activeVisit : null
  const primaryRoutePoint = activeVisit
    ? activeVisitForRoute
      ? routeFlow.activePoint
      : null
    : routeFlow.primaryPoint
  const canStartVisits = routeData.canExecute && routeData.date === field.week?.today
  const canSaveRoute = routeData.canEdit && !routeData.syncState && (
    routeData.id.startsWith("local-route-") || routeData.version > 0
  )
  const canPublishRoute = routeData.canPublish && !routeData.syncState && routeData.version > 0 && !routeData.id.startsWith("local-route-")
  const needsRouteReload = routeData.syncState === "CONFLICT" && routeConflict?.kind === "version"
  const routeConflictClientOp = routeConflictClientOpId ?? durableRouteConflict?.clientOpId ?? null
  const canReturnRouteToDraft = Boolean(
    routeConflictClientOp && (routeConflict?.kind === "point_time" || routeConflict?.kind === "schedule"),
  )
  const navigationPlatform: RouteNavigationPlatform = Platform.OS === "android"
    ? "android"
    : Platform.OS === "ios"
      ? "ios"
      : "other"
  const canNavigatePrimaryPoint = primaryRoutePoint
    ? routeNavigationUrls(primaryRoutePoint, navigationPlatform).length > 0
    : false

  async function startVisit(point: FieldRoutePoint) {
    if (activeVisit) {
      router.push(`/(app)/field-visits/${activeVisit.id}` as never)
      return
    }
    setCheckingInPointId(point.id)
    try {
      // Visit coordinates are optional until a tenant visit policy explicitly
      // requires them. Never request a surprise permission or block the route
      // because the device has no GPS fix.
      const location = await getCurrentDeviceLocation({ requestPermission: false }).catch(() => null)
      const visitId = `field-visit-${Crypto.randomUUID()}`
      const checkInAt = new Date().toISOString()
      const queued = enqueueFieldVisitCheckIn({
        visitId,
        customerId: point.customerId,
        contactId: point.contactId,
        routeId: routeData!.id,
        routePointId: point.id,
        checkInAt,
        checkInLat: location?.latitude ?? null,
        checkInLng: location?.longitude ?? null,
        accuracyM: location?.accuracyM ?? null,
      })
      const week = field.week!
      field.applyLocalWeek(startOptimisticFieldVisit(week, {
        visitId,
        routeId: routeData!.id,
        routePoint: point,
        routeDate: routeData!.date,
        checkInAt,
      }))
      await sync()
      const result = fieldOutboxResult(queued.clientOpId)
      if (result?.status === "conflict" || result?.status === "rejected") {
        field.applyLocalWeek(setOptimisticFieldVisitSyncState(
          startOptimisticFieldVisit(week, { visitId, routeId: routeData!.id, routePoint: point, routeDate: routeData!.date, checkInAt }),
          visitId,
          result.status === "conflict" ? "CONFLICT" : "REJECTED",
        ))
        Alert.alert(t("fieldVisitConflict"))
        return
      }
      if (result?.status !== "applied") Alert.alert(t("fieldVisitQueued"))
      router.push(`/(app)/field-visits/${visitId}` as never)
    } catch (error) {
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "fieldVisitConflict"))
    } finally {
      setCheckingInPointId(null)
    }
  }

  async function openNavigation(point: FieldRoutePoint) {
    const urls = routeNavigationUrls(point, navigationPlatform)
    if (urls.length === 0) {
      Alert.alert(t("routeNoCoordinates"))
      return
    }
    try {
      for (const url of urls) {
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

  async function save() {
    if (!canSaveRoute) return
    const dateKey = routeData!.date.slice(0, 10)
    const timezone = field.week?.timezone ?? "UTC"
    const mappedPoints = points.map((point) => {
      const time = (timeInputs[point.id] ?? "").trim()
      return {
        customerId: point.customerId,
        contactId: point.contactId,
        plannedTime: time ? routePlannedTime(dateKey, time, timezone) : null,
        time,
      }
    })
    if (mappedPoints.some((point) => !isValidRouteTime(point.time) || (point.time && !point.plannedTime))) {
      Alert.alert(t("invalidRouteTime"))
      return
    }
    const localTimeConflict = localTimeConflicts[0]
    if (localTimeConflict) {
      Alert.alert(t("routeConflictTitle"), t("routeConflictTime", {
        points: localTimeConflict.indexes.map((index) => index + 1).join(", "),
        time: localTimeConflict.time,
      }))
      return
    }
    setSaving(true)
    try {
      const input = {
        routeId: routeData!.id,
        expectedVersion: routeData!.version,
        name: name.trim() || null,
        notes: notes.trim() || null,
        points: mappedPoints.map((point) => ({
          customerId: point.customerId,
          contactId: point.contactId,
          plannedTime: point.plannedTime,
        })),
      }
      const queued = enqueueFieldRouteUpdate(input)
      const week = field.week!
      field.applyLocalWeek(updateOptimisticRoute(week, routeData!.id, {
        name: input.name,
        notes: input.notes,
        points: points.map((point, index) => ({
          ...point,
          orderIndex: index,
          plannedTime: mappedPoints[index]?.plannedTime ?? null,
        })),
      }))
      await sync()
      const result = fieldRouteOutboxResult(queued.clientOpId)
      if (result?.status === "applied") {
        await field.loadWeek(week.weekStart)
        Alert.alert(t("changesSaved"))
        if (routeData!.id.startsWith("local-route-") && result.routeId) {
          router.replace(`/(app)/routes/${result.routeId}` as never)
        }
      } else if (result?.status === "conflict" || result?.status === "rejected") {
        setRouteConflictDetail(result.detail)
        setRouteConflictClientOpId(queued.clientOpId)
        Alert.alert(t("routeConflictTitle"), fieldRouteConflictMessage(result.detail, "syncNeedsAttention", timezone))
      } else {
        Alert.alert(t("routeQueued"))
      }
    } catch (error) {
      const detail = error && typeof error === "object" && "detail" in error
        ? (error as { detail?: unknown }).detail
        : null
      setRouteConflictDetail(detail)
      setRouteConflictClientOpId(null)
      Alert.alert(t("fieldDataError"), fieldRouteMutationErrorMessage(error, "syncNeedsAttention", timezone))
    } finally {
      setSaving(false)
    }
  }

  async function reloadRoute() {
    setSaving(true)
    try {
      await field.loadWeek(field.week!.weekStart)
    } catch (error) {
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "syncNeedsAttention"))
    } finally {
      setSaving(false)
    }
  }

  function removeDraftPoint(index: number) {
    Alert.alert(t("removeStop"), points[index]?.customer.name, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("removeStop"),
        style: "destructive",
        onPress: () => setPoints((current) => current.filter((_, itemIndex) => itemIndex !== index).map((point, nextIndex) => ({ ...point, orderIndex: nextIndex + 1 }))),
      },
    ])
  }

  function autoSchedule() {
    setTimeInputs(Object.fromEntries(points.map((point, index) => [
      point.id,
      addMinutesToRouteTime("09:00", index * 30),
    ])))
  }

  async function submitRemovalRequest() {
    if (!requestPoint || reason.trim().length < 3) return
    setSaving(true)
    try {
      const queued = enqueueFieldRouteChangeRequest({
        routeId: routeData!.id,
        changeType: "REMOVE_STOP",
        routePointId: requestPoint.id,
        reason: reason.trim(),
      })
      const week = field.week!
      field.applyLocalWeek(setOptimisticRouteSyncState(week, routeData!.id, "PENDING"))
      setRequestPoint(null)
      setReason("")
      await sync()
      const result = fieldRouteOutboxResult(queued.clientOpId)
      if (result?.status === "applied") {
        Alert.alert(t("requestSent"))
        await field.refresh()
      } else if (result?.status === "conflict" || result?.status === "rejected") {
        field.applyLocalWeek(setOptimisticRouteSyncState(week, routeData!.id, result.status === "conflict" ? "CONFLICT" : "REJECTED"))
        Alert.alert(t("syncNeedsAttention"))
      } else {
        Alert.alert(t("requestQueued"))
      }
    } catch (error) {
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "syncNeedsAttention"))
    } finally {
      setSaving(false)
    }
  }

  function selectTarget(target: RouteTarget) {
    if (routeData!.canEdit) {
      const pointId = `draft-${target.key}-${Date.now()}`
      setPoints((current) => [...current, {
        id: pointId,
        customerId: target.customer.id,
        contactId: target.contact?.id ?? null,
        orderIndex: current.length + 1,
        status: "PENDING",
        effectiveStatus: "PENDING",
        plannedTime: null,
        visitedAt: null,
        notes: null,
        customer: target.customer,
        contact: target.contact,
        visitPolicy: null,
      }])
      setTimeInputs((current) => ({ ...current, [pointId]: "" }))
      setPickerOpen(false)
      return
    }
    setAddRequestTarget(target)
    setPickerOpen(false)
  }

  async function submitAdditionRequest() {
    if (!addRequestTarget || addReason.trim().length < 3) return
    setSaving(true)
    try {
      const queued = enqueueFieldRouteChangeRequest({
        routeId: routeData!.id,
        changeType: "ADD_STOP",
        reason: addReason.trim(),
        payload: {
          customerId: addRequestTarget.customer.id,
          contactId: addRequestTarget.contact?.id ?? null,
        },
      })
      const week = field.week!
      field.applyLocalWeek(setOptimisticRouteSyncState(week, routeData!.id, "PENDING"))
      setAddRequestTarget(null)
      setAddReason("")
      await sync()
      const result = fieldRouteOutboxResult(queued.clientOpId)
      if (result?.status === "applied") {
        Alert.alert(t("requestSent"))
        await field.refresh()
      } else if (result?.status === "conflict" || result?.status === "rejected") {
        field.applyLocalWeek(setOptimisticRouteSyncState(week, routeData!.id, result.status === "conflict" ? "CONFLICT" : "REJECTED"))
        Alert.alert(t("syncNeedsAttention"))
      } else {
        Alert.alert(t("requestQueued"))
      }
    } catch (error) {
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "syncNeedsAttention"))
    } finally {
      setSaving(false)
    }
  }

  function publish() {
    if (!canPublishRoute) return
    const localTimeConflict = localTimeConflicts[0]
    if (localTimeConflict) {
      Alert.alert(t("routeConflictTitle"), t("routeConflictTime", {
        points: localTimeConflict.indexes.map((index) => index + 1).join(", "),
        time: localTimeConflict.time,
      }))
      return
    }
    Alert.alert(t("publishConfirmTitle"), t("publishConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("publishRoute"),
        onPress: () => void (async () => {
          setSaving(true)
          try {
            const queued = enqueueFieldRoutePublish(routeData!.id, routeData!.version)
            const week = field.week!
            field.applyLocalWeek(setOptimisticRouteSyncState(week, routeData!.id, "PENDING"))
            await sync()
            const result = fieldRouteOutboxResult(queued.clientOpId)
            if (result?.status === "applied") {
              await field.loadWeek(week.weekStart)
            } else if (result?.status === "conflict" || result?.status === "rejected") {
              field.applyLocalWeek(setOptimisticRouteSyncState(week, routeData!.id, result.status === "conflict" ? "CONFLICT" : "REJECTED"))
              setRouteConflictDetail(result.detail)
              setRouteConflictClientOpId(queued.clientOpId)
              Alert.alert(t("routeConflictTitle"), fieldRouteConflictMessage(result.detail, "syncNeedsAttention", field.week?.timezone ?? "UTC"))
            } else {
              Alert.alert(t("publishQueued"))
            }
          } catch (error) {
            const detail = error && typeof error === "object" && "detail" in error
              ? (error as { detail?: unknown }).detail
              : null
            setRouteConflictDetail(detail)
            setRouteConflictClientOpId(null)
            Alert.alert(t("fieldDataError"), fieldRouteMutationErrorMessage(error, "syncNeedsAttention", field.week?.timezone ?? "UTC"))
          } finally {
            setSaving(false)
          }
        })(),
      },
    ])
  }

  function confirmReturnToDraft() {
    if (!routeConflictClientOp || !field.week) return
    Alert.alert(t("routeReturnToDraftTitle"), t("routeReturnToDraftBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("routeReturnToDraftConfirm"),
        style: "destructive",
        onPress: () => {
          const recovered = returnFieldRoutePublishToDraft(routeConflictClientOp)
          if (!recovered) return
          field.applyLocalWeek(setOptimisticRouteSyncState(field.week!, recovered.routeId, undefined))
          setRouteConflictDetail(null)
          setRouteConflictClientOpId(null)
          Alert.alert(t("routeReturnToDraftDone"))
        },
      },
    ])
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} hitSlop={10} style={styles.backButton}><TabIcon name="chevronLeft" color={colors.text} size={23} /></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("routeDetails").toUpperCase()}</Text>
            <Text style={styles.title}>{routeData.name ?? t("tabRoute")}</Text>
          </View>
          <View style={[styles.status, { backgroundColor: tone.bg, borderColor: tone.border }]}>
            <Text style={[styles.statusText, { color: tone.text }]}>{t(meta.labelKey)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          {routeData.canEdit ? (
            <>
              <Text style={styles.hint}>{t("routeDraftHint")}</Text>
              <Text style={styles.label}>{t("routeName")}</Text>
              <TextInput style={styles.input} value={name} onChangeText={setName} />
              <Text style={styles.label}>{t("routeNotes")}</Text>
              <TextInput style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} multiline textAlignVertical="top" />
            </>
          ) : (
            <Text style={styles.readOnly}>{t("routeReadOnly")}</Text>
          )}
        </View>

        {!routeData.canEdit && (activeVisit || routeFlow.primaryPoint) ? (
          <View style={[styles.missionCard, activeVisit && styles.missionCardActive]}>
            <View style={styles.missionTop}>
              <View style={[styles.missionIcon, activeVisit ? styles.missionIconActive : styles.missionIconNext]}>
                <TabIcon name="visit" color={activeVisit ? colors.successDark : colors.primary} size={22} />
              </View>
              <View style={styles.missionBody}>
                <View style={styles.missionEyebrowRow}>
                  <Text style={styles.missionEyebrow}>{activeVisit ? t("routeCurrentVisit").toUpperCase() : t("routeNextStop").toUpperCase()}</Text>
                  <Text style={styles.missionProgress}>{routeFlow.completed}/{routeData.totalPoints}</Text>
                </View>
                <Text style={styles.missionName} numberOfLines={2}>
                  {activeVisit
                    ? activeVisit.contact?.displayName ?? activeVisit.customer.name
                    : primaryRoutePoint?.contact?.displayName ?? primaryRoutePoint?.customer.name}
                </Text>
                {activeVisit?.contact ? <Text style={styles.missionMeta}>{activeVisit.customer.name}</Text> : null}
                {!activeVisit && primaryRoutePoint?.plannedTime ? <Text style={styles.missionMeta}>{formatRouteTime(primaryRoutePoint.plannedTime, field.week?.timezone ?? "UTC")}</Text> : null}
              </View>
            </View>
            <View style={styles.missionTrack}><View style={[styles.missionFill, { width: routeFlow.progressPercent + "%" }]} /></View>
            <View style={styles.missionActions}>
              {!activeVisit && primaryRoutePoint && canNavigatePrimaryPoint ? (
                <Pressable onPress={() => void openNavigation(primaryRoutePoint)} style={styles.navigationButton}>
                  <Text style={styles.navigationButtonText}>{t("routeOpenNavigation")}</Text>
                </Pressable>
              ) : null}
              {activeVisit || canStartVisits ? (
                <Pressable
                  disabled={saving || (!activeVisit && checkingInPointId !== null)}
                  onPress={() => {
                    if (activeVisit) {
                      router.push(("/(app)/field-visits/" + activeVisit.id) as never)
                    } else if (primaryRoutePoint) {
                      void startVisit(primaryRoutePoint)
                    }
                  }}
                  style={[styles.missionActionButton, (saving || (!activeVisit && checkingInPointId !== null)) && styles.disabled]}
                >
                  <Text style={styles.missionActionText}>
                    {activeVisit ? t("continueFieldVisit") : checkingInPointId === primaryRoutePoint?.id ? t("locationLoading") : t("startFieldVisit")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={styles.pointsHeader}>
          <View>
            <Text style={styles.sectionTitle}>{routeData.canEdit ? t("routePointsLabel") : t("routeRoadmap")}</Text>
            {!routeData.canEdit ? <Text style={styles.roadmapSummary}>{routeFlow.completed}/{routeData.totalPoints} {t("routeVisitedLabel")}</Text> : null}
          </View>
          <Text style={styles.pointsCount}>{routePoints.length}</Text>
        </View>
        {routeData.canEdit && points.length > 0 ? (
          <Pressable onPress={autoSchedule} style={styles.autoSchedule}><Text style={styles.autoScheduleText}>{t("autoSchedule")}</Text></Pressable>
        ) : null}
        {routeData.canEdit || canRequestStopAddition ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("addStop")} onPress={() => { setPickerOpen((current) => !current); setRequestPoint(null); setAddRequestTarget(null) }} style={styles.addButton}>
            <View style={styles.addButtonIcon}><TabIcon name="add" color={colors.headerText} size={22} /></View>
            <View style={styles.addButtonBody}>
              <Text style={styles.addButtonTitle}>{t("addStop")}</Text>
              <Text style={styles.addButtonHint}>{routeData.canEdit ? t("chooseStop") : t("addStopRequestHint")}</Text>
            </View>
          </Pressable>
        ) : null}
        {pickerOpen ? (
          <RouteTargetPicker
            excluded={excludedTargets}
            agentId={routeData.agentId}
            agentName={routeData.agentId === field.profile?.agent.id ? field.profile.agent.name : null}
            date={routeData.date}
            onSelect={selectTarget}
            onCancel={() => setPickerOpen(false)}
          />
        ) : null}
        {routePoints.length === 0 ? <View style={styles.card}><Text style={styles.noPoints}>{t("noRoutePoints")}</Text></View> : null}
        {routeFlow.steps.map((step) => {
          const point = step.point
          const index = points.findIndex((item) => item.id === point.id)
          const isPrimaryPoint = !activeVisit && primaryRoutePoint?.id === point.id
          const canNavigatePoint = routeNavigationUrls(point, navigationPlatform).length > 0
          return (
            <View key={point.id} style={styles.roadmapRow}>
              {!routeData.canEdit ? (
                <View style={styles.roadmapRail}>
                  <View style={[
                    styles.roadmapMarker,
                    step.state === "completed" && styles.roadmapMarkerCompleted,
                    step.state === "active" && styles.roadmapMarkerActive,
                    step.state === "next" && styles.roadmapMarkerNext,
                    step.state === "missed" && styles.roadmapMarkerMissed,
                  ]}>
                    <Text style={[
                      styles.roadmapMarkerText,
                      (step.state === "completed" || step.state === "active" || step.state === "next") && styles.roadmapMarkerTextInverted,
                    ]}>{step.state === "completed" ? null : step.position}</Text>
                    {step.state === "completed" ? <TabIcon name="check" color={colors.headerText} size={17} /> : null}
                  </View>
                  {step.position < routeFlow.steps.length ? <View style={[styles.roadmapLine, step.state === "completed" && styles.roadmapLineCompleted]} /> : null}
                </View>
              ) : null}
              <View style={[
                styles.pointCard,
                !routeData.canEdit && styles.roadmapCard,
                step.state === "active" && styles.roadmapCardActive,
                step.state === "next" && styles.roadmapCardNext,
                step.state === "completed" && styles.roadmapCardCompleted,
                step.state === "missed" && styles.roadmapCardMissed,
              ]}>
                <View style={styles.pointTop}>
                  {routeData.canEdit ? <View style={styles.indexBadge}><Text style={styles.indexText}>{step.position}</Text></View> : null}
                  <View style={styles.pointBody}>
                    {!routeData.canEdit ? <View style={[
                      styles.stepState,
                      step.state === "completed" && styles.stepStateCompleted,
                      step.state === "active" && styles.stepStateActive,
                      step.state === "next" && styles.stepStateNext,
                      step.state === "missed" && styles.stepStateMissed,
                    ]}><Text style={[
                      styles.stepStateText,
                      (step.state === "completed" || step.state === "active" || step.state === "next") && styles.stepStateTextInverted,
                    ]}>{routeStepLabel(step.state)}</Text></View> : null}
                    <Text style={styles.pointName}>{point.contact?.displayName ?? point.customer.name}</Text>
                    {routePointSubject(point) ? <Text style={styles.pointSubject}>{routePointSubject(point)}</Text> : null}
                    <Text style={styles.pointMeta}>{routePointMeta(point)}</Text>
                    {routeData.canEdit ? (
                      <View style={styles.timeRow}>
                        <Text style={styles.timeLabel}>{t("plannedTime")}</Text>
                        <TextInput
                          value={timeInputs[point.id] ?? ""}
                          onChangeText={(value) => {
                            setTimeInputs((current) => ({ ...current, [point.id]: value }))
                            setRouteConflictDetail(null)
                            setRouteConflictClientOpId(null)
                          }}
                          placeholder="09:30"
                          placeholderTextColor={colors.faint}
                          keyboardType="numbers-and-punctuation"
                          maxLength={5}
                          style={[
                            styles.timeInput,
                            !isValidRouteTime(timeInputs[point.id] ?? "") && styles.timeInputInvalid,
                            conflictingPointIndexes.has(index) && styles.timeInputConflict,
                          ]}
                        />
                      </View>
                    ) : point.plannedTime ? <Text style={styles.pointTime}>{formatRouteTime(point.plannedTime, field.week?.timezone ?? "UTC")}</Text> : null}
                  </View>
                </View>
                {routeData.canEdit ? (
                  <View style={styles.pointActions}>
                    <Pressable accessibilityRole="button" accessibilityLabel={t("moveUp")} disabled={index <= 0} onPress={() => setPoints((current) => reorder(current, index, index - 1))} style={[styles.smallButton, index <= 0 && styles.disabled]}>
                      <TabIcon name="chevronUp" color={colors.primary} size={16} />
                      <Text style={styles.smallButtonText}>{t("moveUp")}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={t("moveDown")} disabled={index === points.length - 1} onPress={() => setPoints((current) => reorder(current, index, index + 1))} style={[styles.smallButton, index === points.length - 1 && styles.disabled]}>
                      <TabIcon name="chevronDown" color={colors.primary} size={16} />
                      <Text style={styles.smallButtonText}>{t("moveDown")}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={t("removeStop")} onPress={() => removeDraftPoint(index)} style={[styles.smallButton, styles.removeButton]}>
                      <TabIcon name="close" color={colors.missed} size={16} />
                      <Text style={styles.removeText}>{t("removeStop")}</Text>
                    </Pressable>
                  </View>
                ) : point.effectiveStatus === "PENDING" ? (
                  <View style={styles.executionActions}>
                    {isPrimaryPoint ? null : canStartVisits && !activeVisit ? (
                      <Pressable
                        disabled={checkingInPointId !== null}
                        onPress={() => void startVisit(point)}
                        style={[styles.secondaryVisitButton, checkingInPointId !== null && styles.disabled]}
                      >
                        <Text style={styles.secondaryVisitText}>{checkingInPointId === point.id ? t("locationLoading") : t("routeStartOutOfOrder")}</Text>
                      </Pressable>
                    ) : null}
                    {canNavigatePoint ? (
                      <Pressable onPress={() => void openNavigation(point)} style={styles.pointNavigationButton}>
                        <Text style={styles.pointNavigationText}>{t("routeOpenNavigation")}</Text>
                      </Pressable>
                    ) : null}
                    {canRequestStopRemoval ? (
                      <Pressable onPress={() => setRequestPoint(point)} style={styles.requestButton}>
                        <Text style={styles.requestText}>{t("requestRouteChange")}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          )
        })}

        {requestPoint ? (
          <View style={[styles.card, styles.requestCard]}>
            <Text style={styles.sectionTitle}>{t("removeStop")}: {requestPoint.customer.name}</Text>
            <Text style={styles.label}>{t("removalReason")}</Text>
            <TextInput style={[styles.input, styles.notes]} value={reason} onChangeText={setReason} multiline textAlignVertical="top" />
            {reason.length > 0 && reason.trim().length < 3 ? <Text style={styles.validation}>{t("minimumReason")}</Text> : null}
            <View style={styles.requestActions}>
              <Pressable onPress={() => { setRequestPoint(null); setReason("") }} style={styles.secondaryButton}><Text style={styles.secondaryText}>{t("cancel")}</Text></Pressable>
              <Pressable disabled={saving || reason.trim().length < 3} onPress={() => void submitRemovalRequest()} style={[styles.primaryButton, (saving || reason.trim().length < 3) && styles.disabled]}><Text style={styles.primaryText}>{t("submitRequest")}</Text></Pressable>
            </View>
          </View>
        ) : null}

        {addRequestTarget ? (
          <View style={[styles.card, styles.requestCard]}>
            <Text style={styles.sectionTitle}>{t("addStop")}: {addRequestTarget.contact?.displayName ?? addRequestTarget.customer.name}</Text>
            {addRequestTarget.contact ? <Text style={styles.requestTargetMeta}>{addRequestTarget.customer.name}</Text> : null}
            <Text style={styles.hint}>{t("addStopRequestHint")}</Text>
            <Text style={styles.label}>{t("addStopReason")}</Text>
            <TextInput style={[styles.input, styles.notes]} value={addReason} onChangeText={setAddReason} multiline textAlignVertical="top" />
            {addReason.length > 0 && addReason.trim().length < 3 ? <Text style={styles.validation}>{t("minimumReason")}</Text> : null}
            <View style={styles.requestActions}>
              <Pressable onPress={() => { setAddRequestTarget(null); setAddReason("") }} style={styles.secondaryButton}><Text style={styles.secondaryText}>{t("cancel")}</Text></Pressable>
              <Pressable disabled={saving || addReason.trim().length < 3} onPress={() => void submitAdditionRequest()} style={[styles.primaryButton, (saving || addReason.trim().length < 3) && styles.disabled]}><Text style={styles.primaryText}>{t("submitRequest")}</Text></Pressable>
            </View>
          </View>
        ) : null}

        {routeData.canEdit ? (
          <View style={styles.footerActions}>
            {routeConflict ? <View style={styles.conflictCard}>
              <Text style={styles.conflictTitle}>{t("routeConflictTitle")}</Text>
              <Text style={styles.conflictText}>{fieldRouteConflictMessage(activeRouteConflictDetail, "syncNeedsAttention", field.week?.timezone ?? "UTC")}</Text>
              {canReturnRouteToDraft ? <Pressable disabled={saving} onPress={confirmReturnToDraft} style={[styles.conflictAction, saving && styles.disabled]}><Text style={styles.conflictActionText}>{t("routeReturnToDraft")}</Text></Pressable> : null}
              {routeConflict.kind === "version" ? <Pressable disabled={saving} onPress={() => router.push("/(app)/sync-center" as never)} style={[styles.conflictAction, saving && styles.disabled]}><Text style={styles.conflictActionText}>{t("syncCenterTitle")}</Text></Pressable> : null}
            </View> : null}
            {!canSaveRoute ? <Text style={styles.syncHint}>{routeConflict ? fieldRouteConflictMessage(activeRouteConflictDetail, needsRouteReload ? "routeRefreshRequired" : "routeSyncBeforeChange", field.week?.timezone ?? "UTC") : needsRouteReload ? t("routeRefreshRequired") : t("routeSyncBeforeChange")}</Text> : null}
            {needsRouteReload ? <Pressable disabled={saving} onPress={() => void reloadRoute()} style={[styles.reloadButton, saving && styles.disabled]}><Text style={styles.reloadText}>{t("reloadRoute")}</Text></Pressable> : null}
            <Pressable disabled={saving || !canSaveRoute} onPress={() => void save()} style={[styles.saveButton, (saving || !canSaveRoute) && styles.disabled]}><Text style={styles.saveText}>{saving ? t("saving") : t("saveChanges")}</Text></Pressable>
            {routeData.canPublish ? (
              <>
                {!canPublishRoute ? <Text style={styles.syncHint}>{t("routeSyncBeforePublish")}</Text> : null}
                <Pressable disabled={saving || !canPublishRoute} onPress={publish} style={[styles.publishButton, (saving || !canPublishRoute) && styles.disabled]}><Text style={styles.publishText}>{t("publishRoute")}</Text></Pressable>
              </>
            ) : null}
          </View>
        ) : null}
        <Pressable
          onPress={() => router.push({ pathname: "/(app)/routes/new", params: { copyFrom: routeData.id } } as never)}
          style={styles.copyButton}
        >
          <Text style={styles.copyTitle}>{t("copyRoute")}</Text>
          <Text style={styles.copyHint}>{t("copyRouteHint")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 34 },
  header: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  backButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: 2 },
  status: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 6 },
  statusText: { fontSize: 9, fontWeight: "900" },
  card: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.card, padding: 15, backgroundColor: colors.card, ...cardShadow },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 13 },
  readOnly: { color: colors.info, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  label: { color: colors.text, fontSize: 12, fontWeight: "800", marginTop: 9, marginBottom: 6 },
  input: { minHeight: 48, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, backgroundColor: "#FAFAFB", paddingHorizontal: 12, color: colors.text, fontSize: 14 },
  notes: { minHeight: 86, paddingTop: 12 },
  missionCard: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.card, padding: 15, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  missionCardActive: { backgroundColor: colors.successBg, borderColor: colors.successBorder },
  missionTop: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  missionIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  missionIconNext: { backgroundColor: colors.card },
  missionIconActive: { backgroundColor: colors.card },
  missionBody: { flex: 1, minWidth: 0 },
  missionEyebrowRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  missionEyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  missionProgress: { color: colors.text, fontSize: 11, fontWeight: "900" },
  missionName: { color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 3 },
  missionMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  missionTrack: { height: 6, borderRadius: radii.pill, backgroundColor: colors.card, overflow: "hidden", marginTop: 14 },
  missionFill: { height: "100%", borderRadius: radii.pill, backgroundColor: colors.primary },
  missionActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  navigationButton: { flex: 1, minHeight: 44, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", paddingHorizontal: 9 },
  navigationButtonText: { color: colors.primary, fontSize: 10, fontWeight: "900", textAlign: "center" },
  missionActionButton: { flex: 1.25, minHeight: 44, borderRadius: radii.inner, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 9 },
  missionActionText: { color: colors.headerText, fontSize: 11, fontWeight: "900", textAlign: "center" },
  pointsHeader: { marginHorizontal: 16, marginTop: 20, marginBottom: 4, flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  roadmapSummary: { color: colors.muted, fontSize: 10, marginTop: 3 },
  pointsCount: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: colors.primarySoft, color: colors.primary, textAlign: "center", lineHeight: 24, fontSize: 11, fontWeight: "900" },
  noPoints: { color: colors.muted, textAlign: "center", paddingVertical: 18 },
  roadmapRow: { marginHorizontal: 14, marginTop: 9, flexDirection: "row", alignItems: "stretch" },
  roadmapRail: { width: 38, alignItems: "center" },
  roadmapMarker: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary, alignItems: "center", justifyContent: "center", zIndex: 1 },
  roadmapMarkerCompleted: { backgroundColor: colors.success, borderColor: colors.success },
  roadmapMarkerActive: { backgroundColor: colors.success, borderColor: colors.success },
  roadmapMarkerNext: { backgroundColor: colors.primary, borderColor: colors.primary },
  roadmapMarkerMissed: { backgroundColor: colors.missedBg, borderColor: colors.missedBorder },
  roadmapMarkerText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  roadmapMarkerTextInverted: { color: colors.headerText },
  roadmapLine: { flex: 1, width: 2, minHeight: 18, backgroundColor: colors.border },
  roadmapLineCompleted: { backgroundColor: colors.success },
  pointCard: { marginHorizontal: 14, marginTop: 9, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  roadmapCard: { flex: 1, minWidth: 0, marginHorizontal: 0, marginTop: 0 },
  roadmapCardActive: { borderColor: colors.success, backgroundColor: colors.successBg },
  roadmapCardNext: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  roadmapCardCompleted: { borderColor: colors.successBorder },
  roadmapCardMissed: { borderColor: colors.missedBorder, backgroundColor: colors.missedBg },
  pointTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  indexBadge: { width: 31, height: 31, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  indexText: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  pointBody: { flex: 1 },
  stepState: { alignSelf: "flex-start", borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.draftBg, marginBottom: 7 },
  stepStateCompleted: { backgroundColor: colors.successBg },
  stepStateActive: { backgroundColor: colors.success },
  stepStateNext: { backgroundColor: colors.primary },
  stepStateMissed: { backgroundColor: colors.missedBg },
  stepStateText: { color: colors.muted, fontSize: 8, fontWeight: "900", textTransform: "uppercase" },
  stepStateTextInverted: { color: colors.headerText },
  pointName: { color: colors.text, fontSize: 14, fontWeight: "900" },
  pointSubject: { color: colors.primary, fontSize: 10, fontWeight: "800", marginTop: 3 },
  pointMeta: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  pointTime: { color: colors.primary, fontSize: 11, fontWeight: "800", marginTop: 4 },
  timeRow: { marginTop: 9, flexDirection: "row", alignItems: "center", gap: 8 },
  timeLabel: { color: colors.muted, fontSize: 9, fontWeight: "800" },
  timeInput: { width: 72, height: 38, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, color: colors.text, fontSize: 12, fontWeight: "900", textAlign: "center" },
  timeInputInvalid: { borderColor: colors.missed, backgroundColor: colors.missedBg },
  timeInputConflict: { borderColor: colors.warning, backgroundColor: colors.warningBg },
  pointActions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 11, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  smallButton: { minHeight: 44, borderRadius: 10, paddingHorizontal: 10, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 },
  smallButtonText: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  removeButton: { backgroundColor: colors.missedBg },
  removeText: { color: colors.missed, fontSize: 10, fontWeight: "900" },
  executionActions: { gap: 8, marginTop: 10 },
  secondaryVisitButton: { minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  secondaryVisitText: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  pointNavigationButton: { minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  pointNavigationText: { color: colors.text, fontSize: 10, fontWeight: "800" },
  requestButton: { marginTop: 10, minHeight: 44, borderRadius: 10, backgroundColor: colors.warningBg, alignItems: "center", justifyContent: "center" },
  requestText: { color: colors.warning, fontSize: 11, fontWeight: "900" },
  requestCard: { borderWidth: 1, borderColor: colors.warning },
  requestTargetMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  validation: { color: colors.missed, fontSize: 10, marginTop: 5 },
  requestActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  secondaryButton: { minHeight: 43, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  primaryButton: { minHeight: 43, borderRadius: radii.inner, backgroundColor: colors.primary, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  primaryText: { color: colors.headerText, fontSize: 12, fontWeight: "900" },
  footerActions: { marginHorizontal: 14, marginTop: 18, gap: 9 },
  addButton: { marginHorizontal: 14, marginTop: 7, minHeight: 62, borderRadius: radii.card, borderWidth: 1, borderStyle: "dashed", borderColor: colors.primary, backgroundColor: colors.primarySoft, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  addButtonIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  addButtonBody: { flex: 1 }, addButtonTitle: { color: colors.primary, fontSize: 13, fontWeight: "900" }, addButtonHint: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 3 },
  autoSchedule: { alignSelf: "flex-start", marginHorizontal: 14, marginTop: 5, minHeight: 38, borderRadius: 11, paddingHorizontal: 12, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" },
  autoScheduleText: { color: colors.info, fontSize: 10, fontWeight: "900" },
  saveButton: { minHeight: 52, borderRadius: radii.inner, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  saveText: { color: colors.headerText, fontSize: 14, fontWeight: "900" },
  syncHint: { color: colors.warning, fontSize: 10, lineHeight: 15, fontWeight: "800", textAlign: "center" },
  conflictCard: { borderRadius: radii.inner, padding: 11, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.warning },
  conflictTitle: { color: colors.warning, fontSize: 12, fontWeight: "900" },
  conflictText: { color: colors.text, fontSize: 10, lineHeight: 15, marginTop: 4 },
  conflictAction: { minHeight: 42, marginTop: 10, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.warning, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  conflictActionText: { color: colors.warning, fontSize: 11, fontWeight: "900", textAlign: "center" },
  reloadButton: { minHeight: 44, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.infoBorder, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" },
  reloadText: { color: colors.info, fontSize: 13, fontWeight: "900" },
  publishButton: { minHeight: 50, borderRadius: radii.inner, backgroundColor: colors.successBg, borderWidth: 1, borderColor: colors.successBorder, alignItems: "center", justifyContent: "center" },
  publishText: { color: colors.successDark, fontSize: 14, fontWeight: "900" },
  copyButton: { marginHorizontal: 14, marginTop: 10, minHeight: 62, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  copyTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  copyHint: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  disabled: { opacity: 0.38 },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  missingTitle: { color: colors.text, fontSize: 16, fontWeight: "900", textAlign: "center", marginBottom: 14 },
})
