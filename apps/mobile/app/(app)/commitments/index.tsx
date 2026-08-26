import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { router, useFocusEffect } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { captureCommercialPhoto, type CommercialPhotoCapture } from "../../../src/commercial/capture-photo"
import {
  CommercialButton,
  CommercialEmpty,
  CommercialHeader,
  CommercialPill,
  CommercialVisitContext,
  commercialCardStyle,
} from "../../../src/commercial/ui"
import {
  enqueueFieldCommitmentCreate,
  enqueueFieldCommitmentFulfill,
  listLocalCatalogProducts,
  readFieldCache,
  readFieldCommitments,
  writeFieldCache,
  type LocalCatalogProductRow,
} from "../../../src/db/local-store"
import { FIELD_COMMITMENTS_CACHE_KEY } from "../../../src/field/commitment-cache"
import { fieldErrorMessage } from "../../../src/field/error-message"
import { resolveFieldTodayPrimaryAction } from "../../../src/field/today-primary-action"
import type {
  FieldCommitment,
  FieldCommitmentsData,
  FieldCommitmentOutcome,
  FieldCommitmentStatus,
  FieldWeekVisit,
} from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import {
  discardFieldVisitPhotoFile,
  persistFieldVisitPhoto,
} from "../../../src/field/visit-photo-store"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { t, useLocale, type MessageKey } from "../../../src/i18n"
import { resolveFieldTaskToday } from "../../../src/field/task-time"
import { shiftDateKey } from "../../../src/field/route-time"
import { tenantDateTimeToIso } from "../../../src/field/tenant-time"
import { useResponsiveLayout } from "../../../src/layout/responsive"
import { getCurrentDeviceLocation } from "../../../src/location/device-location"
import { FieldScreenChrome } from "../../../src/components/FieldScreenChrome"
import { TabIcon, type TabIconName } from "../../../src/components/TabIcon"
import { useSync } from "../../../src/sync/sync-context"
import { colors, radii } from "../../../src/theme"
import { IS_LEADDRIVE_FIELD } from "../../../src/config/mobile-variant"

type ListFilter = "OPEN" | "HISTORY"

function futureDateKey(today: string, days: number): string {
  return shiftDateKey(today, days)
}

function dueAtFromDateKey(value: string, timeZone: string): string | null {
  const dueAt = tenantDateTimeToIso(value.trim(), "23:59", timeZone)
  return dueAt && new Date(dueAt).getTime() > Date.now() ? dueAt : null
}

function decimal(value: string, allowZero: boolean): number | null {
  const normalized = value.trim().replace(",", ".")
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null
  const quantity = Number(normalized)
  if (!Number.isFinite(quantity) || (allowZero ? quantity < 0 : quantity <= 0)) return null
  return quantity
}

function commitmentOutcome(actual: number, promised: number): FieldCommitmentOutcome {
  if (actual === 0) return "NOT_FULFILLED"
  if (actual < promised) return "PARTIAL"
  return "FULFILLED"
}

function statusLabel(status: FieldCommitmentStatus): string {
  return t(`commitmentStatus_${status}` as MessageKey)
}

function statusTone(status: FieldCommitmentStatus): "success" | "warning" | "danger" | "info" {
  if (status === "FULFILLED") return "success"
  if (status === "OPEN") return "info"
  if (status === "PARTIAL") return "warning"
  return "danger"
}

function activeFieldVisit(fieldWeek: ReturnType<typeof useField>["week"]): FieldWeekVisit | null {
  return fieldWeek?.days
    .flatMap((day) => day.visits.items)
    .find((visit) => visit.status === "CHECKED_IN") ?? null
}

export default function CommitmentsScreen() {
  const locale = useLocale()
  const field = useField()
  const layout = useResponsiveLayout()
  const { sync, status: syncStatus } = useSync()
  const [data, setData] = useState(readFieldCommitments)
  const [capabilitiesKnown, setCapabilitiesKnown] = useState(() => Boolean(readFieldCache<FieldCommitmentsData>(FIELD_COMMITMENTS_CACHE_KEY)))
  const [filter, setFilter] = useState<ListFilter>("OPEN")
  const [createOpen, setCreateOpen] = useState(false)
  const [factTarget, setFactTarget] = useState<FieldCommitment | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [productName, setProductName] = useState("")
  const [selectedProduct, setSelectedProduct] = useState<LocalCatalogProductRow | null>(null)
  const [brandName, setBrandName] = useState("")
  const [quantity, setQuantity] = useState("")
  const [unit, setUnit] = useState(t("commitmentsUnitDefault"))
  const tenantTimeZone = field.week?.timezone ?? field.workday?.timezone ?? field.profile?.todaySummary.timezone ?? "UTC"
  const tenantToday = resolveFieldTaskToday(field.week?.today ?? field.workday?.today ?? field.profile?.todaySummary.date, tenantTimeZone)
  const [dueDate, setDueDate] = useState(() => futureDateKey(tenantToday, 3))
  const [promiseNote, setPromiseNote] = useState("")
  const [promisePhoto, setPromisePhoto] = useState<CommercialPhotoCapture | null>(null)
  const [promiseDetailsOpen, setPromiseDetailsOpen] = useState(false)
  const [actualQuantity, setActualQuantity] = useState("")
  const [factNote, setFactNote] = useState("")
  const [factPhoto, setFactPhoto] = useState<CommercialPhotoCapture | null>(null)
  const [factDetailsOpen, setFactDetailsOpen] = useState(false)
  const catalog = useMemo(listLocalCatalogProducts, [])
  const activeVisit = activeFieldVisit(field.week)
  const canCreateCommitment = capabilitiesKnown && data.capabilities.create
  const canFulfillCommitment = capabilitiesKnown && data.capabilities.fulfillOwn
  const createCapabilityHint = capabilitiesKnown ? t("commitmentsCreateUnavailable") : t("commitmentsCapabilitiesLoading")
  const fulfillCapabilityHint = capabilitiesKnown ? t("commitmentsFulfillUnavailable") : t("commitmentsCapabilitiesLoading")
  const recoveryAction = !activeVisit ? resolveFieldTodayPrimaryAction({
    isField: IS_LEADDRIVE_FIELD,
    activeVisit: null,
    today: field.week?.days.find((day) => day.isToday) ?? null,
    canCreateOwnDraft: field.week?.capabilities.createOwnDraft === true,
    hasLoadedWorkday: Boolean(field.workday),
    availableWorkdayActions: field.workday?.availableActions,
  }) : null
  const recoveryLabel = recoveryAction?.kind === "LOAD_WORKDAY"
    ? t("workdayLoading")
    : recoveryAction?.kind === "START_WORKDAY"
    ? t("workdayStart")
    : recoveryAction?.kind === "RESUME_WORKDAY"
      ? t("workdayResume")
      : recoveryAction?.kind === "OPEN_NEXT_ROUTE" && recoveryAction.nextStopName
        ? `${t("routeNextStop")}: ${recoveryAction.nextStopName}`
        : recoveryAction?.kind === "OPEN_NEXT_ROUTE"
          ? t("openRoute")
          : recoveryAction?.kind === "CREATE_ROUTE"
            ? t("createRoute")
            : t("weekSchedule")
  const recoveryDestination = recoveryAction?.kind === "LOAD_WORKDAY"
    ? t("workdayLoadingHint")
    : recoveryAction?.kind === "START_WORKDAY" || recoveryAction?.kind === "RESUME_WORKDAY"
    ? t("workdayTitle")
    : recoveryAction?.kind === "OPEN_NEXT_ROUTE"
      ? t("routeDetails")
      : recoveryAction?.kind === "CREATE_ROUTE"
        ? t("routeHubTitle")
        : t("weekSchedule")
  const recoveryIcon: TabIconName = recoveryAction?.kind === "LOAD_WORKDAY"
    ? "refresh"
    : recoveryAction?.kind === "START_WORKDAY" || recoveryAction?.kind === "RESUME_WORKDAY"
    ? "today"
    : recoveryAction?.kind === "OPEN_NEXT_ROUTE"
      ? "route"
      : recoveryAction?.kind === "CREATE_ROUTE"
        ? "add"
        : "week"

  const reload = useCallback(() => {
    setData(readFieldCommitments())
    setCapabilitiesKnown(Boolean(readFieldCache<FieldCommitmentsData>(FIELD_COMMITMENTS_CACHE_KEY)))
  }, [])

  const refreshServer = useCallback(async (showWarning: boolean) => {
    try {
      const next = await fieldApi.commitments("all")
      writeFieldCache(FIELD_COMMITMENTS_CACHE_KEY, next)
      setWarning(null)
    } catch {
      if (showWarning) setWarning(t("commitmentsRefreshError"))
    } finally {
      reload()
    }
  }, [reload])

  useFocusEffect(useCallback(() => {
    reload()
    void refreshServer(false)
  }, [refreshServer, reload]))

  useEffect(() => {
    if (syncStatus.phase === "idle" || syncStatus.phase === "offline" || syncStatus.phase === "error") reload()
  }, [reload, syncStatus.lastSyncAt, syncStatus.phase])

  useEffect(() => {
    if (!createOpen) setDueDate(futureDateKey(tenantToday, 3))
  }, [createOpen, tenantToday])

  const counts = useMemo(() => ({
    open: data.commitments.filter((item) => !item.fulfillment).length,
    overdue: data.commitments.filter((item) => item.status === "OVERDUE").length,
    closed: data.commitments.filter((item) => Boolean(item.fulfillment)).length,
  }), [data.commitments])

  const visible = useMemo(
    () => data.commitments.filter((item) => filter === "OPEN" ? !item.fulfillment : Boolean(item.fulfillment)),
    [data.commitments, filter],
  )

  const suggestions = useMemo(() => {
    const query = productName.trim().toLocaleLowerCase()
    if (!createOpen || selectedProduct || query.length < 1) return []
    return catalog.filter((product) => (
      product.name.toLocaleLowerCase().includes(query) ||
      product.sku.toLocaleLowerCase().includes(query) ||
      product.barcode?.toLocaleLowerCase().includes(query)
    )).slice(0, 5)
  }, [catalog, createOpen, productName, selectedProduct])

  function resetPromiseForm() {
    setProductName("")
    setSelectedProduct(null)
    setBrandName("")
    setQuantity("")
    setUnit(t("commitmentsUnitDefault"))
    setDueDate(futureDateKey(tenantToday, 3))
    setPromiseNote("")
    setPromisePhoto(null)
    setPromiseDetailsOpen(false)
  }

  function closePromiseForm() {
    resetPromiseForm()
    setCreateOpen(false)
  }

  function selectProduct(product: LocalCatalogProductRow) {
    setSelectedProduct(product)
    setProductName(product.name)
    setBrandName(product.brandName ?? "")
    if (product.unit) setUnit(product.unit)
  }

  async function takePhoto(target: "promise" | "fact") {
    const result = await captureCommercialPhoto()
    if (result === "denied") {
      Alert.alert(t("cameraPermissionDenied"))
      return
    }
    if (!result) return
    if (target === "promise") setPromisePhoto(result)
    else setFactPhoto(result)
  }

  async function syncQuietly() {
    reload()
    await sync().catch(() => {})
    await refreshServer(false)
  }

  async function savePromise() {
    if (!canCreateCommitment) {
      setWarning(createCapabilityHint)
      return
    }
    const promisedQuantity = decimal(quantity, false)
    const dueAt = dueAtFromDateKey(dueDate, tenantTimeZone)
    const name = productName.trim()
    const normalizedUnit = unit.trim()
    if (!activeVisit || !field.profile || !name || !promisedQuantity || !normalizedUnit || !dueAt || busy) {
      Alert.alert(t("commitmentsValidation"))
      return
    }
    setBusy(true)
    let persistedPhoto: Awaited<ReturnType<typeof persistFieldVisitPhoto>> | null = null
    try {
      if (promisePhoto) {
        const location = await getCurrentDeviceLocation().catch(() => null)
        persistedPhoto = await persistFieldVisitPhoto({
          visitId: activeVisit.id,
          agentId: field.profile.agent.id,
          sourceUri: promisePhoto.uri,
          category: "commitment-promise",
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
          takenAt: promisePhoto.takenAt,
        })
      }
      enqueueFieldCommitmentCreate({
        visitId: activeVisit.id,
        customerId: activeVisit.customerId,
        customerName: activeVisit.customer.name,
        customerType: activeVisit.customer.objectType,
        contactId: activeVisit.contactId,
        contactName: activeVisit.contact?.displayName ?? null,
        productExternalId: selectedProduct?.id ?? null,
        productName: name,
        brandExternalId: null,
        brandName: brandName.trim() || null,
        promisedQuantity,
        unit: normalizedUnit,
        dueAt,
        note: promiseNote.trim() || null,
      }, persistedPhoto)
      closePromiseForm()
      reload()
      Alert.alert(t("commitmentsPromiseSaved"))
      await syncQuietly()
    } catch (error) {
      if (persistedPhoto) await discardFieldVisitPhotoFile(persistedPhoto.fileUri)
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "commitmentsSyncRejected"))
    } finally {
      setBusy(false)
    }
  }

  function openFact(commitment: FieldCommitment) {
    setActualQuantity(String(commitment.promisedQuantity))
    setFactNote("")
    setFactPhoto(null)
    setFactDetailsOpen(false)
    setFactTarget(commitment)
  }

  function closeFact() {
    setFactTarget(null)
    setActualQuantity("")
    setFactNote("")
    setFactPhoto(null)
    setFactDetailsOpen(false)
  }

  async function saveFact() {
    if (!canFulfillCommitment) {
      setWarning(fulfillCapabilityHint)
      return
    }
    if (!factTarget || busy) return
    const actual = decimal(actualQuantity, true)
    if (actual == null || factTarget.id.startsWith("local:")) {
      Alert.alert(t("commitmentsValidation"))
      return
    }
    setBusy(true)
    let persistedPhoto: Awaited<ReturnType<typeof persistFieldVisitPhoto>> | null = null
    try {
      if (factPhoto && activeVisit && field.profile && activeVisit.customerId === factTarget.customerId) {
        const location = await getCurrentDeviceLocation().catch(() => null)
        persistedPhoto = await persistFieldVisitPhoto({
          visitId: activeVisit.id,
          agentId: field.profile.agent.id,
          sourceUri: factPhoto.uri,
          category: "commitment-fulfillment",
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null,
          takenAt: factPhoto.takenAt,
        })
      }
      enqueueFieldCommitmentFulfill({
        commitmentId: factTarget.id,
        outcome: commitmentOutcome(actual, factTarget.promisedQuantity),
        actualQuantity: actual,
        note: factNote.trim() || null,
      }, persistedPhoto)
      closeFact()
      reload()
      Alert.alert(t("commitmentsFactSaved"))
      await syncQuietly()
    } catch (error) {
      if (persistedPhoto) await discardFieldVisitPhotoFile(persistedPhoto.fileUri)
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "commitmentsSyncRejected"))
    } finally {
      setBusy(false)
    }
  }

  async function refresh() {
    setRefreshing(true)
    try {
      await sync().catch(() => {})
      await refreshServer(true)
    } finally {
      setRefreshing(false)
    }
  }

  const factActual = decimal(actualQuantity, true)
  const factOutcome = factTarget && factActual != null
    ? commitmentOutcome(factActual, factTarget.promisedQuantity)
    : null
  const canAttachFactPhoto = Boolean(
    factTarget && activeVisit && field.profile && activeVisit.customerId === factTarget.customerId,
  )

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <FieldScreenChrome />
      <CommercialHeader title={t("commitmentsTitle")} subtitle={t("commitmentsSubtitle")} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
      >
        <View style={[styles.content, layout.isTablet && styles.contentTablet]}>
        <CommercialVisitContext
          active={Boolean(activeVisit)}
          storeName={activeVisit?.customer.name ?? null}
          activeLabel={t("commitmentsActiveVisit")}
          missingLabel={t("commitmentsNeedsVisit")}
        />

        {recoveryAction?.kind === "LOAD_WORKDAY" ? (
          <View accessible accessibilityRole="status" accessibilityLiveRegion="polite" accessibilityLabel={`${t("commitmentsNeedsVisit")}. ${recoveryDestination}`} style={[styles.recoveryAction, styles.recoveryLoading]}>
            <View accessible={false} style={[styles.recoveryIcon, styles.recoveryLoadingIcon]}><TabIcon name={recoveryIcon} color={colors.info} size={20} /></View>
            <View style={styles.recoveryBody}><Text style={[styles.recoveryLabel, styles.recoveryLoadingLabel]} numberOfLines={1}>{recoveryLabel}</Text><Text style={[styles.recoveryHint, styles.recoveryLoadingHint]} numberOfLines={2}>{recoveryDestination}</Text></View>
          </View>
        ) : recoveryAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recoveryLabel}
            accessibilityHint={`${t("commitmentsNeedsVisit")}. ${recoveryDestination}`}
            onPress={() => router.push(recoveryAction.href as never)}
            style={({ pressed }) => [styles.recoveryAction, pressed && styles.pressed]}
          >
            <View accessible={false} style={styles.recoveryIcon}><TabIcon name={recoveryIcon} color={colors.headerText} size={20} /></View>
            <View style={styles.recoveryBody}><Text style={styles.recoveryLabel} numberOfLines={1}>{recoveryLabel}</Text><Text style={styles.recoveryHint} numberOfLines={2}>{recoveryDestination}</Text></View>
            <TabIcon name="chevronRight" color={colors.headerText} size={21} />
          </Pressable>
        ) : null}

        <View style={styles.summary}>
          <Summary value={counts.open} label={t("commitmentsSummaryOpen")} color={colors.info} />
          <View style={styles.summaryDivider} />
          <Summary value={counts.overdue} label={t("commitmentsSummaryOverdue")} color={colors.missed} />
          <View style={styles.summaryDivider} />
          <Summary value={counts.closed} label={t("commitmentsSummaryClosed")} color={colors.successDark} />
        </View>

        <View style={styles.toolbar}>
          <View style={styles.filters}>
            <FilterChip selected={filter === "OPEN"} label={t("commitmentsFilterOpen")} onPress={() => setFilter("OPEN")} />
            <FilterChip selected={filter === "HISTORY"} label={t("commitmentsFilterHistory")} onPress={() => setFilter("HISTORY")} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={busy ? t("saving") : t("commitmentsNew")}
            accessibilityHint={!canCreateCommitment ? createCapabilityHint : activeVisit ? t("commitmentsNewHint") : t("commitmentsNeedsVisit")}
            accessibilityState={{ busy, disabled: !activeVisit || busy || !canCreateCommitment, expanded: createOpen }}
            disabled={!activeVisit || busy || !canCreateCommitment}
            onPress={() => { setFactTarget(null); setCreateOpen((current) => !current) }}
            style={[styles.addButton, (!activeVisit || busy || !canCreateCommitment) && styles.disabled]}
          >
            <TabIcon name="add" color={colors.headerText} size={19} /><Text style={styles.addLabel}>{t("commitmentsNew")}</Text>
          </Pressable>
        </View>

        {!canCreateCommitment ? <View accessibilityRole={capabilitiesKnown ? "alert" : "status"} accessibilityLiveRegion="polite" style={[styles.capabilityNotice, !capabilitiesKnown && styles.capabilityNoticeLoading]}><TabIcon name={capabilitiesKnown ? "alert" : "refresh"} color={capabilitiesKnown ? colors.warning : colors.info} size={17} /><Text style={[styles.capabilityNoticeText, !capabilitiesKnown && styles.capabilityNoticeLoadingText]}>{createCapabilityHint}</Text></View> : null}

        {warning ? <View accessibilityRole="alert" style={styles.warning}><View style={styles.warningBody}><Text style={styles.warningText}>{warning}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} accessibilityState={{ busy: refreshing, disabled: refreshing }} disabled={refreshing} onPress={() => void refresh()} style={[styles.warningRetry, refreshing && styles.disabled]}><TabIcon name="refresh" color={colors.warning} size={17} /><Text style={styles.warningRetryText}>{refreshing ? "…" : t("refresh")}</Text></Pressable></View></View> : null}
        {busy ? <View accessibilityRole="alert" style={styles.busyNotice}><TabIcon name="refresh" color={colors.primary} size={17} /><Text style={styles.busyNoticeText}>{t("saving")}</Text></View> : null}

        {createOpen && activeVisit ? (
          <View style={[styles.composer, layout.isTablet && styles.composerTablet]}>
            <View style={styles.composerHeader}>
              <View style={styles.stepMark}><Text style={styles.stepMarkText}>1</Text></View>
              <View style={styles.composerTitleBody}><Text style={styles.composerTitle}>{t("commitmentsNewTitle")}</Text><Text style={styles.composerHint}>{t("commitmentsNewHint")}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={t("cancel")} accessibilityHint={t("commitmentsNewTitle")} onPress={closePromiseForm} style={styles.closeButton}><TabIcon name="close" color={colors.faint} size={20} /></Pressable>
            </View>
            <FieldLabel label={t("commitmentsProduct")} />
            <TextInput
              accessibilityLabel={t("commitmentsProduct")}
              accessibilityHint={t("commitmentsCatalogHint")}
              value={productName}
              onChangeText={(value) => { setProductName(value); setSelectedProduct(null) }}
              placeholder={t("commitmentsProductPlaceholder")}
              placeholderTextColor={colors.faint}
              maxLength={200}
              style={styles.input}
            />
            <Text style={styles.inputHint}>{t("commitmentsCatalogHint")}</Text>
            {suggestions.length > 0 ? <View style={styles.suggestions}>{suggestions.map((product) => (
              <Pressable key={product.id} accessibilityRole="button" accessibilityLabel={`${t("commitmentsProduct")}: ${product.name}`} accessibilityHint={product.brandName ? `${product.sku} · ${product.brandName}` : product.sku} onPress={() => selectProduct(product)} style={styles.suggestion}>
                <View style={styles.suggestionBody}><Text style={styles.suggestionName}>{product.name}</Text><Text style={styles.suggestionMeta}>{product.sku}{product.brandName ? ` · ${product.brandName}` : ""}</Text></View><TabIcon name="chevronRight" color={colors.primary} size={19} />
              </Pressable>
            ))}</View> : null}
            <View style={styles.fieldRow}>
              <View style={styles.fieldWide}><FieldLabel label={t("commitmentsQuantity")} /><TextInput accessibilityLabel={t("commitmentsQuantity")} value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" maxLength={14} style={styles.input} /></View>
              <View style={styles.fieldNarrow}><FieldLabel label={t("commitmentsUnit")} /><TextInput accessibilityLabel={t("commitmentsUnit")} value={unit} onChangeText={setUnit} maxLength={40} style={styles.input} /></View>
            </View>
            <FieldLabel label={t("commitmentsDueDate")} />
            <TextInput accessibilityLabel={t("commitmentsDueDate")} accessibilityHint={t("dateInputHint")} value={dueDate} onChangeText={setDueDate} keyboardType="numbers-and-punctuation" maxLength={10} placeholder={t("dateInputHint")} placeholderTextColor={colors.faint} style={styles.input} />
            <View style={styles.quickDates}>
              <QuickDate selected={dueDate === futureDateKey(tenantToday, 1)} label={t("commitmentsDue1")} onPress={() => setDueDate(futureDateKey(tenantToday, 1))} />
              <QuickDate selected={dueDate === futureDateKey(tenantToday, 3)} label={t("commitmentsDue3")} onPress={() => setDueDate(futureDateKey(tenantToday, 3))} />
              <QuickDate selected={dueDate === futureDateKey(tenantToday, 7)} label={t("commitmentsDue7")} onPress={() => setDueDate(futureDateKey(tenantToday, 7))} />
            </View>
            <View style={styles.formActions}>
              <View style={styles.secondaryAction}><CommercialButton label={t("cancel")} tone="secondary" disabled={busy} onPress={closePromiseForm} /></View>
              <View style={styles.primaryAction}><CommercialButton label={t("commitmentsSavePromise")} disabled={busy || !canCreateCommitment} onPress={() => void savePromise()} /></View>
            </View>
            <CommitmentDisclosure title={t("commitmentsExtraDetails")} hint={t("commitmentsExtraDetailsHint")} open={promiseDetailsOpen} onPress={() => setPromiseDetailsOpen((open) => !open)}>
              <FieldLabel label={t("commitmentsBrand")} />
              <TextInput accessibilityLabel={t("commitmentsBrand")} value={brandName} onChangeText={setBrandName} maxLength={200} style={styles.input} />
              <FieldLabel label={t("commitmentsNote")} />
              <TextInput accessibilityLabel={t("commitmentsNote")} accessibilityHint={t("commitmentsNotePlaceholder")} value={promiseNote} onChangeText={setPromiseNote} maxLength={2000} multiline textAlignVertical="top" placeholder={t("commitmentsNotePlaceholder")} placeholderTextColor={colors.faint} style={[styles.input, styles.textarea]} />
              <PhotoPicker photo={promisePhoto} onPress={() => void takePhoto("promise")} />
            </CommitmentDisclosure>
          </View>
        ) : null}

        {factTarget ? (
          <View style={[styles.composer, styles.factComposer, layout.isTablet && styles.composerTablet]}>
            <View style={styles.composerHeader}>
              <View style={[styles.stepMark, styles.factMark]}><Text style={styles.stepMarkText}>✓</Text></View>
              <View style={styles.composerTitleBody}><Text style={styles.composerTitle}>{t("commitmentsFactTitle")}</Text><Text style={styles.composerHint}>{factTarget.productName} · {factTarget.customer.name}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={t("cancel")} accessibilityHint={t("commitmentsFactTitle")} onPress={closeFact} style={styles.closeButton}><TabIcon name="close" color={colors.faint} size={20} /></Pressable>
            </View>
            <Text style={styles.factInstruction}>{t("commitmentsFactHint")}</Text>
            {!canFulfillCommitment ? <View accessibilityRole={capabilitiesKnown ? "alert" : "status"} style={[styles.inlineCapabilityNotice, !capabilitiesKnown && styles.inlineCapabilityNoticeLoading]}><Text style={[styles.inlineCapabilityNoticeText, !capabilitiesKnown && styles.inlineCapabilityNoticeLoadingText]}>{fulfillCapabilityHint}</Text></View> : null}
            <FieldLabel label={t("commitmentsActualQuantity")} />
            <View style={styles.actualRow}>
              <TextInput accessibilityLabel={`${t("commitmentsActualQuantity")}: ${factTarget.productName}`} value={actualQuantity} onChangeText={setActualQuantity} keyboardType="decimal-pad" maxLength={14} style={[styles.input, styles.actualInput]} />
              <Text style={styles.actualUnit}>{factTarget.unit}</Text>
            </View>
            {factOutcome ? (
              <View style={styles.outcomePreview}>
                <Text style={styles.outcomeLabel}>{t("commitmentsOutcome")}</Text>
                <CommercialPill label={statusLabel(factOutcome)} tone={statusTone(factOutcome)} />
                <Text style={styles.outcomeVariance}>{t("commitmentsVariance")}: {formatQuantity((factActual ?? 0) - factTarget.promisedQuantity)} {factTarget.unit}</Text>
              </View>
            ) : null}
            <View style={styles.formActions}>
              <View style={styles.secondaryAction}><CommercialButton label={t("cancel")} tone="secondary" disabled={busy} onPress={closeFact} /></View>
              <View style={styles.primaryAction}><CommercialButton label={t("commitmentsSaveFact")} disabled={busy || factActual == null || !canFulfillCommitment} onPress={() => void saveFact()} /></View>
            </View>
            <CommitmentDisclosure title={t("commitmentsExtraDetails")} hint={t("commitmentsExtraDetailsHint")} open={factDetailsOpen} onPress={() => setFactDetailsOpen((open) => !open)}>
              <FieldLabel label={t("commitmentsNote")} />
              <TextInput accessibilityLabel={t("commitmentsNote")} accessibilityHint={t("commitmentsNotePlaceholder")} value={factNote} onChangeText={setFactNote} maxLength={2000} multiline textAlignVertical="top" placeholder={t("commitmentsNotePlaceholder")} placeholderTextColor={colors.faint} style={[styles.input, styles.textarea]} />
              {canAttachFactPhoto ? <PhotoPicker photo={factPhoto} onPress={() => void takePhoto("fact")} /> : <View accessibilityRole="alert" style={styles.photoUnavailable}><Text style={styles.photoUnavailableText}>{t("commitmentsFactPhotoUnavailable")}</Text></View>}
            </CommitmentDisclosure>
          </View>
        ) : null}

        <View style={[styles.list, layout.isTablet && styles.listTablet]}>
          {visible.map((commitment) => (
            <View key={commitment.id} style={layout.isTablet ? styles.cardSlotTablet : undefined}>
              <CommitmentCard
                commitment={commitment}
                locale={locale}
                timeZone={tenantTimeZone}
                busy={busy}
                fulfillAllowed={canFulfillCommitment}
                fulfillHint={fulfillCapabilityHint}
                onFact={() => { setCreateOpen(false); openFact(commitment) }}
              />
            </View>
          ))}
        </View>

        {visible.length === 0 ? (
          <CommercialEmpty
            glyph={filter === "OPEN" ? "◎" : "✓"}
            title={filter === "OPEN" ? t("commitmentsEmptyOpen") : t("commitmentsEmptyHistory")}
            hint={filter === "OPEN" ? t("commitmentsEmptyOpenHint") : t("commitmentsEmptyHistoryHint")}
          />
        ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function Summary({ value, label, color }: { value: number; label: string; color: string }) {
  return <View style={styles.summaryItem}><Text style={[styles.summaryValue, { color }]}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>
}

function FilterChip({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.filter, selected && styles.filterSelected]}><Text style={[styles.filterText, selected && styles.filterTextSelected]}>{label}</Text></Pressable>
}

function FieldLabel({ label }: { label: string }) {
  return <Text style={styles.label}>{label}</Text>
}

function QuickDate({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${t("commitmentsDueDate")}: ${label}`} accessibilityState={{ selected }} onPress={onPress} style={[styles.quickDate, selected && styles.quickDateSelected]}><Text style={[styles.quickDateText, selected && styles.quickDateTextSelected]}>{label}</Text></Pressable>
}

function CommitmentDisclosure({ title, hint, open, onPress, children }: { title: string; hint: string; open: boolean; onPress: () => void; children: ReactNode }) {
  return <View style={styles.detailsDisclosure}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={hint} accessibilityState={{ expanded: open }} onPress={onPress} style={({ pressed }) => [styles.detailsToggle, pressed && styles.pressed]}>
      <View accessible={false} style={styles.detailsIcon}><TabIcon name="document" color={colors.primary} size={18} /></View>
      <View style={styles.detailsBody}><Text style={styles.detailsTitle}>{title}</Text><Text style={styles.detailsHint} numberOfLines={1}>{hint}</Text></View>
      <TabIcon name={open ? "chevronUp" : "chevronDown"} color={colors.primary} size={20} />
    </Pressable>
    {open ? <View style={styles.detailsContent}>{children}</View> : null}
  </View>
}

function PhotoPicker({ photo, onPress }: { photo: CommercialPhotoCapture | null; onPress: () => void }) {
  return (
    <View style={styles.photoPicker}>
      {photo ? <Image accessibilityLabel={t("commitmentsPhotoReady")} source={{ uri: photo.uri }} style={styles.photoPreview} /> : <View style={styles.photoPlaceholder}><TabIcon name="camera" color={colors.primary} size={23} /></View>}
      <View style={styles.photoBody}>
        <Text style={styles.photoTitle}>{photo ? t("commitmentsPhotoReady") : t("commitmentsPhoto")}</Text>
        <Text style={styles.photoHint}>{t("commitmentsPhotoHint")}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={photo ? t("commitmentsRetakePhoto") : t("commitmentsAddPhoto")} accessibilityHint={t("commitmentsPhotoHint")} onPress={onPress} style={styles.photoButton}><Text style={styles.photoButtonText}>{photo ? t("commitmentsRetakePhoto") : t("commitmentsAddPhoto")}</Text></Pressable>
    </View>
  )
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

function CommitmentCard({ commitment, locale, timeZone, busy, fulfillAllowed, fulfillHint, onFact }: {
  commitment: FieldCommitment
  locale: ReturnType<typeof useLocale>
  timeZone: string
  busy: boolean
  fulfillAllowed: boolean
  fulfillHint: string
  onFact: () => void
}) {
  const pendingServerId = commitment.id.startsWith("local:")
  const hasEvidence = Boolean(commitment.evidencePhoto || commitment.evidenceClientPhotoId)
  const factEvidence = Boolean(commitment.fulfillment?.evidencePhoto || commitment.fulfillment?.evidenceClientPhotoId)
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.productMark}><TabIcon name="document" color={colors.primary} size={19} /></View>
        <View style={styles.cardTitleBody}>
          <Text style={styles.cardTitle}>{commitment.productName}</Text>
          <Text style={styles.cardBrand}>{commitment.brandName || commitment.productExternalId || t("commitmentsProduct")}</Text>
        </View>
        <CommercialPill label={statusLabel(commitment.status)} tone={statusTone(commitment.status)} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t("openCustomerCard")}: ${commitment.customer.name}`} onPress={() => router.push(`/(app)/organizations/${commitment.customer.id}` as never)} style={({ pressed }) => [styles.customerRow, pressed && styles.pressed]}><TabIcon name="organizations" color={colors.primary} size={16} /><View style={styles.customerBody}><Text style={styles.customerName}>{commitment.customer.name}</Text>{commitment.contact ? <Text style={styles.customerContact}>{commitment.contact.displayName}</Text> : null}</View><TabIcon name="chevronRight" color={colors.faint} size={19} /></Pressable>
      <View style={styles.planRow}>
        <Metric label={t("commitmentsPromise")} value={`${formatQuantity(commitment.promisedQuantity)} ${commitment.unit}`} accent={colors.primary} />
        <Metric label={t("commitmentsFact")} value={commitment.fulfillment ? `${formatQuantity(commitment.fulfillment.actualQuantity)} ${commitment.unit}` : "—"} accent={commitment.fulfillment ? colors.successDark : colors.faint} />
        <Metric label={t("commitmentsVariance")} value={commitment.fulfillment ? `${formatQuantity(commitment.fulfillment.varianceQuantity)} ${commitment.unit}` : "—"} accent={commitment.fulfillment && commitment.fulfillment.varianceQuantity < 0 ? colors.missed : colors.successDark} />
      </View>
      <View style={styles.dueRow}><TabIcon name="week" color={colors.faint} size={14} /><Text style={styles.dueLabel}>{t("commitmentsDue")}</Text><Text style={[styles.dueValue, commitment.status === "OVERDUE" && styles.dueOverdue]}>{formatShortDateTime(commitment.dueAt, locale, timeZone)}</Text></View>
      {commitment.note ? <Text style={styles.note}>{commitment.note}</Text> : null}
      {(hasEvidence || factEvidence) ? <View style={styles.evidence}><TabIcon name="camera" color={colors.holiday} size={14} /><Text style={styles.evidenceText}>{t("commitmentsPhotoAttached")}</Text></View> : null}
      {commitment.syncState ? <SyncNotice state={commitment.syncState} /> : null}
      {!commitment.fulfillment ? (
        <View style={styles.cardFooter}>
          {pendingServerId ? <Text style={styles.pendingHint}>{t("commitmentsWaitingForSync")}</Text> : !fulfillAllowed ? <Text style={styles.capabilityHint}>{fulfillHint}</Text> : <View style={styles.factButtonWrap}><CommercialButton label={t("commitmentsRecordFact")} disabled={busy || Boolean(commitment.syncState)} onPress={onFact} /></View>}
        </View>
      ) : commitment.fulfillment.note ? <View style={styles.factNote}><Text style={styles.factNoteLabel}>{t("commitmentsFact")}</Text><Text style={styles.factNoteText}>{commitment.fulfillment.note}</Text></View> : null}
    </View>
  )
}

function Metric({ label, value, accent }: { label: string; value: string; accent: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, { color: accent }]} numberOfLines={1}>{value}</Text></View>
}

function SyncNotice({ state }: { state: "PENDING" | "CONFLICT" | "REJECTED" }) {
  const error = state !== "PENDING"
  const text = state === "PENDING" ? t("commitmentsSyncPending") : state === "CONFLICT" ? t("commitmentsSyncConflict") : t("commitmentsSyncRejected")
  return <Pressable accessibilityRole="button" accessibilityLabel={text} accessibilityHint={error ? t("syncCenterOpen") : undefined} accessibilityState={{ disabled: !error }} disabled={!error} onPress={() => router.push("/(app)/sync-center" as never)} style={[styles.syncNotice, error && styles.syncNoticeError]}><View style={styles.syncNoticeBody}><TabIcon name={error ? "alert" : "info"} color={error ? colors.missed : colors.primary} size={16} /><Text style={[styles.syncNoticeText, error && styles.syncNoticeTextError]}>{text}</Text>{error ? <TabIcon name="chevronRight" color={colors.missed} size={17} /> : null}</View></Pressable>
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: 36 },
  content: { width: "100%" },
  contentTablet: { maxWidth: 1_060, alignSelf: "center" },
  summary: { ...commercialCardStyle, marginHorizontal: 14, marginTop: 10, paddingVertical: 11, flexDirection: "row", alignItems: "stretch" },
  summaryItem: { flex: 1, minHeight: 60, alignItems: "center", justifyContent: "center" },
  summaryDivider: { width: 1, backgroundColor: colors.border },
  summaryValue: { fontSize: 22, fontWeight: "900" },
  summaryLabel: { color: colors.muted, fontSize: 11, lineHeight: 14, fontWeight: "800", marginTop: 2, textAlign: "center" },
  toolbar: { marginHorizontal: 14, marginTop: 13, gap: 10 },
  filters: { flexDirection: "row", gap: 8 },
  filter: { minHeight: 44, borderRadius: radii.pill, paddingHorizontal: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  filterSelected: { backgroundColor: colors.text, borderColor: colors.text },
  filterText: { color: colors.muted, fontSize: 11, fontWeight: "900" },
  filterTextSelected: { color: colors.headerText },
  addButton: { minHeight: 48, borderRadius: 16, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  addLabel: { color: colors.headerText, fontSize: 12, fontWeight: "900" },
  disabled: { opacity: 0.42 },
  warning: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 11, backgroundColor: colors.warningBg },
  warningBody: { flexDirection: "row", alignItems: "center", gap: 10 },
  warningText: { flex: 1, color: colors.warning, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  warningRetry: { minHeight: 44, borderRadius: 12, paddingHorizontal: 8, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", gap: 2 },
  warningRetryText: { color: colors.warning, fontSize: 11, fontWeight: "900" },
  capabilityNotice: { minHeight: 44, marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, paddingHorizontal: 11, backgroundColor: colors.warningBg, flexDirection: "row", alignItems: "center", gap: 8 },
  capabilityNoticeText: { flex: 1, color: colors.warning, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  capabilityNoticeLoading: { backgroundColor: colors.infoBg },
  capabilityNoticeLoadingText: { color: colors.info },
  recoveryAction: { minHeight: 62, marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, paddingHorizontal: 12, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", gap: 10 },
  recoveryLoading: { backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder },
  recoveryIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  recoveryLoadingIcon: { backgroundColor: colors.card },
  recoveryBody: { flex: 1, minWidth: 0 },
  recoveryLabel: { color: colors.headerText, fontSize: 13, fontWeight: "900" },
  recoveryLoadingLabel: { color: colors.info },
  recoveryHint: { color: colors.headerText, opacity: 0.82, fontSize: 11, lineHeight: 15, marginTop: 2 },
  recoveryLoadingHint: { color: colors.muted, opacity: 1 },
  busyNotice: { marginHorizontal: 14, marginTop: 10, minHeight: 44, borderRadius: radii.inner, paddingHorizontal: 11, backgroundColor: colors.primarySoft, flexDirection: "row", alignItems: "center", gap: 8 },
  busyNoticeText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  composer: { ...commercialCardStyle, marginHorizontal: 14, marginTop: 14, borderWidth: 1, borderColor: colors.infoBorder },
  composerTablet: { width: "100%", maxWidth: 720, alignSelf: "center", marginHorizontal: 0 },
  factComposer: { borderColor: colors.successBorder },
  composerHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  stepMark: { width: 35, height: 35, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  factMark: { backgroundColor: colors.success },
  stepMarkText: { color: colors.headerText, fontSize: 14, fontWeight: "900" },
  composerTitleBody: { flex: 1, minWidth: 0 },
  composerTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  composerHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  closeButton: { width: 44, height: 44, marginTop: -5, marginRight: -5, alignItems: "center", justifyContent: "center" },
  label: { color: colors.text, fontSize: 12, fontWeight: "900", marginTop: 14, marginBottom: 6 },
  input: { minHeight: 47, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, borderRadius: 14, paddingHorizontal: 12, color: colors.text, fontSize: 13, fontWeight: "700" },
  textarea: { minHeight: 84, paddingTop: 11, lineHeight: 18 },
  inputHint: { color: colors.faint, fontSize: 11, lineHeight: 15, marginTop: 5 },
  suggestions: { marginTop: 7, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: "hidden" },
  suggestion: { minHeight: 52, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center" },
  suggestionBody: { flex: 1, minWidth: 0 },
  suggestionName: { color: colors.text, fontSize: 11, fontWeight: "900" },
  suggestionMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  fieldRow: { flexDirection: "row", gap: 9 },
  fieldWide: { flex: 1.2 },
  fieldNarrow: { flex: 0.8 },
  quickDates: { flexDirection: "row", gap: 7, marginTop: 8 },
  quickDate: { minHeight: 44, borderRadius: radii.pill, paddingHorizontal: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  quickDateSelected: { backgroundColor: colors.primary },
  quickDateText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  quickDateTextSelected: { color: colors.headerText },
  photoPicker: { minHeight: 78, borderRadius: 15, backgroundColor: colors.bg, marginTop: 14, padding: 9, flexDirection: "row", alignItems: "center", gap: 9 },
  photoPreview: { width: 58, height: 58, borderRadius: 13, backgroundColor: colors.skeleton },
  photoPlaceholder: { width: 58, height: 58, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  photoBody: { flex: 1, minWidth: 0 },
  photoTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  photoHint: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  photoButton: { minHeight: 44, borderRadius: 11, backgroundColor: colors.primarySoft, paddingHorizontal: 9, alignItems: "center", justifyContent: "center" },
  photoButtonText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  formActions: { flexDirection: "row", gap: 9, marginTop: 15 },
  secondaryAction: { flex: 0.75 },
  primaryAction: { flex: 1.25 },
  detailsDisclosure: { marginTop: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.bg, overflow: "hidden" },
  detailsToggle: { minHeight: 54, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 9 },
  detailsIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  detailsBody: { flex: 1, minWidth: 0 },
  detailsTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  detailsHint: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  detailsContent: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 12, paddingBottom: 14 },
  factInstruction: { marginTop: 12, borderRadius: radii.inner, backgroundColor: colors.successBg, padding: 10, color: colors.successDark, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  inlineCapabilityNotice: { marginTop: 10, borderRadius: radii.inner, backgroundColor: colors.warningBg, padding: 10 },
  inlineCapabilityNoticeText: { color: colors.warning, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  inlineCapabilityNoticeLoading: { backgroundColor: colors.infoBg },
  inlineCapabilityNoticeLoadingText: { color: colors.info },
  actualRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  actualInput: { flex: 1 },
  actualUnit: { minWidth: 45, color: colors.text, fontSize: 12, fontWeight: "900" },
  outcomePreview: { marginTop: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 10, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  outcomeLabel: { color: colors.muted, fontSize: 11, fontWeight: "900" },
  outcomeVariance: { marginLeft: "auto", color: colors.text, fontSize: 11, fontWeight: "900" },
  photoUnavailable: { marginTop: 14, borderRadius: radii.inner, padding: 11, backgroundColor: colors.warningBg },
  photoUnavailableText: { color: colors.warning, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  list: { gap: 11, paddingHorizontal: 14, marginTop: 16, marginBottom: 12 },
  listTablet: { flexDirection: "row", flexWrap: "wrap" },
  cardSlotTablet: { flexBasis: "48%", flexGrow: 1 },
  card: { ...commercialCardStyle },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  productMark: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  cardTitleBody: { flex: 1, minWidth: 0 },
  cardTitle: { color: colors.text, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  cardBrand: { color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 3 },
  customerRow: { marginTop: 12, borderRadius: radii.inner, backgroundColor: colors.bg, padding: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  customerBody: { flex: 1, minWidth: 0 },
  customerName: { color: colors.text, fontSize: 11, fontWeight: "900" },
  customerContact: { color: colors.muted, fontSize: 11, marginTop: 2 },
  planRow: { flexDirection: "row", gap: 7, marginTop: 12 },
  metric: { flex: 1, minWidth: 0, borderRadius: 12, backgroundColor: colors.bg, paddingHorizontal: 8, paddingVertical: 9 },
  metricLabel: { color: colors.faint, fontSize: 11, lineHeight: 14, fontWeight: "900", textTransform: "uppercase" },
  metricValue: { fontSize: 11, fontWeight: "900", marginTop: 4 },
  dueRow: { flexDirection: "row", alignItems: "center", marginTop: 11, gap: 6 },
  dueLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  dueValue: { color: colors.text, fontSize: 11, fontWeight: "900" },
  dueOverdue: { color: colors.missed },
  note: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 10 },
  evidence: { alignSelf: "flex-start", marginTop: 10, borderRadius: radii.pill, backgroundColor: colors.holidayBg, paddingHorizontal: 9, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  evidenceText: { color: colors.holiday, fontSize: 11, fontWeight: "900" },
  syncNotice: { minHeight: 44, marginTop: 10, borderRadius: 11, padding: 9, backgroundColor: colors.primarySoft, justifyContent: "center" },
  syncNoticeError: { backgroundColor: colors.dangerBg },
  syncNoticeBody: { flexDirection: "row", alignItems: "center", gap: 7 },
  syncNoticeText: { flex: 1, color: colors.primary, fontSize: 11, lineHeight: 15, fontWeight: "800" },
  syncNoticeTextError: { color: colors.missed },
  cardFooter: { marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  factButtonWrap: { alignSelf: "stretch" },
  pendingHint: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center" },
  capabilityHint: { color: colors.warning, fontSize: 11, lineHeight: 16, textAlign: "center" },
  factNote: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  factNoteLabel: { color: colors.faint, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  factNoteText: { color: colors.text, fontSize: 11, lineHeight: 16, marginTop: 4 },
  pressed: { opacity: 0.72 },
})
