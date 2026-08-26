import { useCallback, useEffect, useState } from "react"
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { router, useFocusEffect } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  CommercialHeader,
  CommercialPill,
  commercialCardStyle,
} from "../../src/commercial/ui"
import { FieldScreenChrome } from "../../src/components/FieldScreenChrome"
import { SyncBar } from "../../src/components/SyncBar"
import { TabIcon } from "../../src/components/TabIcon"
import {
  discardFieldRouteVersionConflict,
  detachFieldCommitmentEvidence,
  detachFieldMessageAttachment,
  listFieldSyncRecoveryQueue,
  returnFieldRoutePublishToDraft,
  retryFieldSyncOperation,
  type FieldSyncRecoveryRow,
} from "../../src/db/local-store"
import { discardFieldVisitPhotoFile } from "../../src/field/visit-photo-store"
import { formatShortDateTime } from "../../src/i18n/date-format"
import { t, useLocale, type MessageKey } from "../../src/i18n"
import { useSync } from "../../src/sync/sync-context"
import { useField } from "../../src/field/field-context"
import type { FieldVisitActionKey } from "../../src/field/contracts"
import { colors, radii } from "../../src/theme"
import { EncryptedMediaImage } from "../../src/components/EncryptedMediaImage"
import { IS_LEADDRIVE_FIELD } from "../../src/config/mobile-variant"
import {
  fieldErrorMessage,
  fieldErrorMessageForCode,
  fieldRouteConflictMessage,
  FIELD_TASK_ERROR_OVERRIDES,
} from "../../src/field/error-message"

function kindKey(kind: string): MessageKey {
  if (kind === "field.route.create") return "syncKindRouteCreate"
  if (kind === "field.route.update") return "syncKindRouteUpdate"
  if (kind === "field.route.publish") return "syncKindRoutePublish"
  if (kind === "field.route.change-request") return "syncKindRouteRequest"
  if (kind === "field.visit.photo") return "syncKindVisitPhoto"
  if (kind.startsWith("field.visit.")) return "syncKindVisit"
  if (kind === "field.workday.event") return "syncKindWorkday"
  if (kind === "field.location") return "syncKindLocation"
  if (kind.startsWith("field.task.")) return "syncKindTask"
  if (kind === "field.commitment.create") return "syncKindCommitment"
  if (kind === "field.commitment.fulfill") return "syncKindCommitmentFact"
  return "syncKindOther"
}

function kindLabel(kind: string, locale: "az" | "ru"): string {
  if (kind === "field.message.send") return locale === "az" ? "Mesajın göndərilməsi" : "Отправка сообщения"
  if (kind === "field.message.receipt") return locale === "az" ? "Mesajın təsdiqi" : "Подтверждение сообщения"
  if (kind === "field.document.upload") return locale === "az" ? "Sənədin göndərilməsi" : "Отправка документа"
  if (kind === "field.document.state") return locale === "az" ? "Sənəd statusu" : "Статус документа"
  if (kind === "field.hrm.create") return locale === "az" ? "HRM müraciəti" : "HRM-заявка"
  if (kind === "field.hrm.cancel") return locale === "az" ? "HRM müraciətinin ləğvi" : "Отмена HRM-заявки"
  return t(kindKey(kind))
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

const fieldVisitActionKeys = new Set<FieldVisitActionKey>([
  "PHOTO",
  "PRESENTATION",
  "STOCK_CHECK",
  "VISIT_NOTE",
  "CHECKLIST",
  "FEEDBACK",
  "NEXT_ACTION",
])

function visitActionContext(value: unknown): string | null {
  const actionKey = string(value)
  if (!actionKey) return null
  if (!fieldVisitActionKeys.has(actionKey as FieldVisitActionKey)) return t("syncKindVisit")
  return t(`visitAction_${actionKey}` as MessageKey)
}

function rowContext(row: FieldSyncRecoveryRow): string | null {
  const visitAction = row.kind.startsWith("field.visit.")
    ? visitActionContext(row.payload.actionKey)
    : null
  return string(row.payload.productName) ??
    string(row.payload.customerName) ??
    string(row.payload.title) ??
    string(row.payload.fileName) ??
    string(row.payload.body) ??
    string(row.payload.reason) ??
    visitAction ??
    string(row.payload.visitId) ??
    string(row.payload.routeId) ??
    string(row.payload.workdayId)
}

function rowErrorFallback(row: FieldSyncRecoveryRow): MessageKey {
  if (row.kind.startsWith("field.task.")) return "agentTaskSyncRejected"
  if (row.kind === "field.commitment.create" || row.kind === "field.commitment.fulfill") {
    return row.status === "conflict" ? "commitmentsSyncConflict" : "commitmentsSyncRejected"
  }
  if (row.kind.startsWith("field.visit.")) return "fieldVisitConflict"
  if (row.kind === "field.workday.event" || row.kind === "field.location") return "workdayActionConflict"
  if (row.kind.startsWith("field.route.")) return "syncNeedsAttention"
  return "fieldDataError"
}

function rowError(row: FieldSyncRecoveryRow, timeZone: string): string | null {
  const detail = record(row.detail)
  if (!detail && typeof row.detail !== "string") return null
  if (row.kind.startsWith("field.route.")) {
    return fieldRouteConflictMessage(row.detail, rowErrorFallback(row), timeZone)
  }
  return fieldErrorMessageForCode(
    detail?.code,
    rowErrorFallback(row),
    row.kind.startsWith("field.task.")
      ? FIELD_TASK_ERROR_OVERRIDES
      : {},
  )
}

function rowPhoto(row: FieldSyncRecoveryRow): string | null {
  if (row.evidence?.fileUri && row.evidence.status !== "applied") return row.evidence.fileUri
  return row.kind === "field.visit.photo" ? string(row.payload.fileUri) : null
}

type RecoveryAction = "retry" | "openRoute" | "discardRoute" | "returnDraft" | "withoutPhoto" | "withoutAttachment"

function RecoveryEmpty() {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${t("syncCenterEmpty")}. ${t("syncCenterEmptyHint")}`}
      style={[commercialCardStyle, styles.empty]}
    >
      <View accessible={false} style={styles.emptyMark}><TabIcon name="check" color={colors.success} size={26} /></View>
      <Text style={styles.emptyTitle}>{t("syncCenterEmpty")}</Text>
      <Text style={styles.emptyHint}>{t("syncCenterEmptyHint")}</Text>
    </View>
  )
}

function RecoveryButton({
  label,
  hint,
  busy,
  disabled,
  onPress,
  tone = "primary",
}: {
  label: string
  hint: string
  busy: boolean
  disabled: boolean
  onPress: () => void
  tone?: "primary" | "secondary"
}) {
  const secondary = tone === "secondary"
  const foreground = secondary ? colors.primary : colors.headerText
  const visibleLabel = busy ? `${label}…` : label
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={visibleLabel}
      accessibilityHint={hint}
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.recoveryButton,
        { backgroundColor: secondary ? colors.primarySoft : colors.primary },
        disabled && styles.recoveryButtonDisabled,
        pressed && !disabled && styles.recoveryButtonPressed,
      ]}
    >
      {busy ? <TabIcon name="refresh" color={foreground} size={17} /> : null}
      <Text numberOfLines={2} style={[styles.recoveryButtonText, { color: foreground }]}>{visibleLabel}</Text>
    </Pressable>
  )
}

export default function SyncCenterScreen() {
  const locale = useLocale()
  const { status, sync } = useSync()
  const field = useField()
  const [rows, setRows] = useState<FieldSyncRecoveryRow[]>(listFieldSyncRecoveryQueue)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<RecoveryAction | null>(null)
  const [expandedActionsId, setExpandedActionsId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const reload = useCallback(() => setRows(listFieldSyncRecoveryQueue()), [])

  useFocusEffect(reload)
  useEffect(() => {
    if (status.phase === "idle" || status.phase === "offline" || status.phase === "error") reload()
  }, [reload, status.lastSyncAt, status.phase])

  const syncBusy = !["idle", "offline", "error", "authLost", "upgradeRequired"].includes(status.phase)

  async function flush() {
    reload()
    await sync().catch(() => {})
    reload()
  }

  async function retry(row: FieldSyncRecoveryRow) {
    if (busyId || syncBusy) return
    setBusyId(row.clientOpId)
    setBusyAction("retry")
    try {
      const next = retryFieldSyncOperation(row.clientOpId)
      if (!next) return
      Alert.alert(t("syncCenterRetryQueued"))
      await flush()
    } catch (error) {
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "syncNeedsAttention"))
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  async function discardOutdatedRouteChange(row: FieldSyncRecoveryRow) {
    if (busyId || syncBusy) return
    setBusyId(row.clientOpId)
    setBusyAction("discardRoute")
    try {
      const discarded = discardFieldRouteVersionConflict(row.clientOpId)
      if (!discarded) return
      Alert.alert(t("syncCenterRouteChangeDiscarded"))
      await flush()
    } catch (error) {
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "syncNeedsAttention"))
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  async function returnRouteToDraft(row: FieldSyncRecoveryRow) {
    if (busyId || syncBusy) return
    setBusyId(row.clientOpId)
    setBusyAction("returnDraft")
    try {
      const recovered = returnFieldRoutePublishToDraft(row.clientOpId)
      if (!recovered) return
      reload()
      Alert.alert(t("routeReturnToDraftDone"), undefined, [{
        text: t("openRoute"),
        onPress: () => router.push(`/(app)/routes/${recovered.routeId}` as never),
      }])
    } catch (error) {
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "syncNeedsAttention"))
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  function openRouteRecovery(row: FieldSyncRecoveryRow) {
    const routeId = string(row.payload.routeId)
    if (routeId) router.push(`/(app)/routes/${routeId}` as never)
  }

  async function continueWithoutPhoto(row: FieldSyncRecoveryRow) {
    if (busyId || syncBusy) return
    setBusyId(row.clientOpId)
    setBusyAction("withoutPhoto")
    try {
      const result = detachFieldCommitmentEvidence(row.clientOpId)
      if (!result) return
      if (result.fileUri) await discardFieldVisitPhotoFile(result.fileUri)
      Alert.alert(t("syncCenterPhotoRemoved"))
      await flush()
    } catch (error) {
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "syncNeedsAttention"))
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  async function continueWithoutAttachment(row: FieldSyncRecoveryRow) {
    if (busyId || syncBusy) return
    setBusyId(row.clientOpId)
    setBusyAction("withoutAttachment")
    try {
      const result = detachFieldMessageAttachment(row.clientOpId)
      if (!result) return
      if (result.fileUri) await discardFieldVisitPhotoFile(result.fileUri)
      Alert.alert(locale === "az" ? "Fayl ayrıldı" : "Файл откреплён")
      await flush()
    } catch (error) {
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "syncNeedsAttention"))
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  function confirmWithoutPhoto(row: FieldSyncRecoveryRow) {
    Alert.alert(t("syncCenterWithoutPhotoTitle"), t("syncCenterWithoutPhotoBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("syncCenterWithoutPhotoConfirm"), style: "destructive", onPress: () => void continueWithoutPhoto(row) },
    ])
  }

  function confirmWithoutAttachment(row: FieldSyncRecoveryRow) {
    Alert.alert(
      locale === "az" ? "Mesajı faylsız göndərək?" : "Отправить сообщение без файла?",
      locale === "az" ? "Lokal fayl silinəcək, mesaj mətni isə növbədə qalacaq." : "Локальная копия файла будет удалена, а текст сообщения останется в очереди.",
      [
        { text: t("cancel"), style: "cancel" },
        { text: locale === "az" ? "Faylsız davam et" : "Продолжить без файла", style: "destructive", onPress: () => void continueWithoutAttachment(row) },
      ],
    )
  }

  function confirmDiscardOutdatedRouteChange(row: FieldSyncRecoveryRow) {
    Alert.alert(t("syncCenterDiscardRouteTitle"), t("syncCenterDiscardRouteBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("syncCenterDiscardRouteConfirm"),
        style: "destructive",
        onPress: () => void discardOutdatedRouteChange(row),
      },
    ])
  }

  function confirmReturnRouteToDraft(row: FieldSyncRecoveryRow) {
    Alert.alert(t("routeReturnToDraftTitle"), t("routeReturnToDraftBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("routeReturnToDraftConfirm"), style: "destructive", onPress: () => void returnRouteToDraft(row) },
    ])
  }

  async function refresh() {
    setRefreshing(true)
    try {
      await flush()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <FieldScreenChrome />
      <CommercialHeader title={t("syncCenterTitle")} subtitle={t("syncCenterSubtitle")} backFallback="/(app)/(tabs)/profile" />
      <SyncBar />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
      >
        {rows.length > 0 ? (
          <View
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${t("syncCenterSummary", { count: rows.length })}. ${t("syncCenterSummaryHint")}`}
            style={styles.summary}
          >
            <View accessible={false} style={styles.summaryMark}><TabIcon name="alert" color={colors.dangerPressed} size={24} /></View>
            <View style={styles.summaryBody}>
              <Text style={styles.summaryTitle}>{t("syncCenterSummary", { count: rows.length })}</Text>
              <Text style={styles.summaryHint}>{t("syncCenterSummaryHint")}</Text>
            </View>
          </View>
        ) : (
          <RecoveryEmpty />
        )}

        {rows.length > 0 ? <View style={styles.list}>{rows.map((row) => {
          const photoUri = rowPhoto(row)
          const error = rowError(row, field.week?.timezone ?? "UTC")
          const context = rowContext(row)
          const statusLabel = row.status === "conflict" ? t("syncCenterConflict") : t("syncCenterRejected")
          const actionHint = `${kindLabel(row.kind, locale)} · ${statusLabel}`
          const rowBusy = busyId === row.clientOpId
          const actionBusy = (action: RecoveryAction) => rowBusy && busyAction === action
          const actionsDisabled = busyId !== null || syncBusy
          const canOpenRoute = row.canDiscard && Boolean(string(row.payload.routeId))
          const primaryAction: RecoveryAction | null = row.canRetry
            ? "retry"
            : canOpenRoute
              ? "openRoute"
              : row.canReturnToDraft
                ? "returnDraft"
                : row.canContinueWithoutEvidence
                  ? "withoutPhoto"
                  : row.canDetachAttachment
                    ? "withoutAttachment"
                    : row.canDiscard
                      ? "discardRoute"
                      : null
          const actionCount = [
            row.canRetry,
            canOpenRoute,
            row.canDiscard,
            row.canReturnToDraft,
            row.canContinueWithoutEvidence,
            row.canDetachAttachment,
          ].filter(Boolean).length
          const hasSecondaryActions = actionCount > 1
          const secondaryActionsOpen = expandedActionsId === row.clientOpId
          return (
            <View key={row.clientOpId} style={styles.card}>
              <View style={styles.cardTop}>
                {photoUri ? <View accessible accessibilityRole="image" accessibilityLabel={t("syncCenterEvidenceReady")}><EncryptedMediaImage uri={photoUri} style={styles.preview} /></View> : <View accessible={false} style={styles.kindMark}><TabIcon name="refresh" color={colors.warning} size={25} /></View>}
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{kindLabel(row.kind, locale)}</Text>
                  {context ? <Text style={styles.cardContext} numberOfLines={2}>{context}</Text> : null}
                  <View accessible accessibilityRole="text" accessibilityLabel={`${statusLabel}. ${formatShortDateTime(row.clientCreatedAt, locale)}`} style={styles.metaRow}>
                    <CommercialPill label={statusLabel} tone="danger" />
                    <Text style={styles.date}>{formatShortDateTime(row.clientCreatedAt, locale)}</Text>
                  </View>
                </View>
              </View>
              {row.evidence ? <View accessible accessibilityRole="text" accessibilityLabel={t(row.evidence.status === "applied" ? "syncCenterEvidenceUploaded" : "syncCenterEvidenceReady")} style={styles.evidence}><TabIcon name="camera" color={colors.holiday} size={15} /><Text style={styles.evidenceText}>{t(row.evidence.status === "applied" ? "syncCenterEvidenceUploaded" : "syncCenterEvidenceReady")}</Text></View> : null}
              {error ? <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityLabel={error} style={styles.error}><TabIcon name="alert" color={colors.dangerPressed} size={17} /><Text style={styles.errorText} numberOfLines={4}>{error}</Text></View> : null}
              <Text accessibilityRole="text" accessibilityLabel={t("syncCenterAttempts", { count: row.attempts })} style={styles.attempts}>{t("syncCenterAttempts", { count: row.attempts })}</Text>
              <View style={styles.actions}>
                {primaryAction === "retry" ? <View style={styles.action}><RecoveryButton label={t("syncCenterRetry")} hint={actionHint} busy={actionBusy("retry")} disabled={actionsDisabled} onPress={() => void retry(row)} /></View> : null}
                {primaryAction === "openRoute" ? <View style={styles.action}><RecoveryButton label={t("syncCenterOpenRoute")} hint={actionHint} busy={false} disabled={actionsDisabled} onPress={() => openRouteRecovery(row)} /></View> : null}
                {primaryAction === "discardRoute" ? <View style={styles.action}><RecoveryButton label={t("syncCenterDiscardRoute")} hint={actionHint} busy={actionBusy("discardRoute")} disabled={actionsDisabled} onPress={() => confirmDiscardOutdatedRouteChange(row)} /></View> : null}
                {primaryAction === "returnDraft" ? <View style={styles.action}><RecoveryButton label={t("routeReturnToDraft")} hint={actionHint} busy={actionBusy("returnDraft")} disabled={actionsDisabled} onPress={() => confirmReturnRouteToDraft(row)} /></View> : null}
                {primaryAction === "withoutPhoto" ? <View style={styles.action}><RecoveryButton label={t("syncCenterWithoutPhoto")} hint={actionHint} busy={actionBusy("withoutPhoto")} disabled={actionsDisabled} onPress={() => confirmWithoutPhoto(row)} /></View> : null}
                {primaryAction === "withoutAttachment" ? <View style={styles.action}><RecoveryButton label={locale === "az" ? "Faylsız" : "Без файла"} hint={actionHint} busy={actionBusy("withoutAttachment")} disabled={actionsDisabled} onPress={() => confirmWithoutAttachment(row)} /></View> : null}
                {hasSecondaryActions ? <Pressable accessibilityRole="button" accessibilityLabel={secondaryActionsOpen ? t("syncCenterHideActions") : t("syncCenterMoreActions")} accessibilityHint={actionHint} accessibilityState={{ expanded: secondaryActionsOpen }} onPress={() => setExpandedActionsId((current) => current === row.clientOpId ? null : row.clientOpId)} style={({ pressed }) => [styles.moreActions, pressed && styles.recoveryButtonPressed]}><Text style={styles.moreActionsText}>{secondaryActionsOpen ? t("syncCenterHideActions") : t("syncCenterMoreActions")}</Text><TabIcon name={secondaryActionsOpen ? "chevronUp" : "chevronDown"} color={colors.primary} size={18} /></Pressable> : null}
                {secondaryActionsOpen ? <View style={styles.secondaryActions}>
                  {primaryAction !== "retry" && row.canRetry ? <View style={styles.action}><RecoveryButton label={t("syncCenterRetry")} hint={actionHint} busy={actionBusy("retry")} disabled={actionsDisabled} onPress={() => void retry(row)} /></View> : null}
                  {primaryAction !== "openRoute" && canOpenRoute ? <View style={styles.action}><RecoveryButton label={t("syncCenterOpenRoute")} hint={actionHint} busy={false} tone="secondary" disabled={actionsDisabled} onPress={() => openRouteRecovery(row)} /></View> : null}
                  {primaryAction !== "discardRoute" && row.canDiscard ? <View style={styles.action}><RecoveryButton label={t("syncCenterDiscardRoute")} hint={actionHint} busy={actionBusy("discardRoute")} tone="secondary" disabled={actionsDisabled} onPress={() => confirmDiscardOutdatedRouteChange(row)} /></View> : null}
                  {primaryAction !== "returnDraft" && row.canReturnToDraft ? <View style={styles.action}><RecoveryButton label={t("routeReturnToDraft")} hint={actionHint} busy={actionBusy("returnDraft")} tone="secondary" disabled={actionsDisabled} onPress={() => confirmReturnRouteToDraft(row)} /></View> : null}
                  {primaryAction !== "withoutPhoto" && row.canContinueWithoutEvidence ? <View style={styles.action}><RecoveryButton label={t("syncCenterWithoutPhoto")} hint={actionHint} busy={actionBusy("withoutPhoto")} tone="secondary" disabled={actionsDisabled} onPress={() => confirmWithoutPhoto(row)} /></View> : null}
                  {primaryAction !== "withoutAttachment" && row.canDetachAttachment ? <View style={styles.action}><RecoveryButton label={locale === "az" ? "Faylsız" : "Без файла"} hint={actionHint} busy={actionBusy("withoutAttachment")} tone="secondary" disabled={actionsDisabled} onPress={() => confirmWithoutAttachment(row)} /></View> : null}
                </View> : null}
              </View>
            </View>
          )
        })}</View> : null}

        {!IS_LEADDRIVE_FIELD ? (
          <Pressable onPress={() => router.push("/(app)/commercial/media-queue" as never)} style={styles.commercialLink}>
            <View style={styles.commercialMark}><Text style={styles.commercialMarkText}>⌾</Text></View>
            <View style={styles.commercialBody}><Text style={styles.commercialTitle}>{t("syncCenterCommercialMedia")}</Text><Text style={styles.commercialHint}>{t("syncCenterCommercialMediaHint")}</Text></View>
            <Text style={styles.arrow}>›</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: 34 },
  empty: { marginHorizontal: 14, paddingHorizontal: 24, paddingVertical: 30, alignItems: "center" },
  emptyMark: { width: 50, height: 50, borderRadius: 16, backgroundColor: colors.successBg, alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "900", marginTop: 12, textAlign: "center" },
  emptyHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4, textAlign: "center" },
  summary: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, padding: 14, backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: colors.dangerBorder, flexDirection: "row", alignItems: "center", gap: 11 },
  summaryMark: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  summaryBody: { flex: 1, minWidth: 0 },
  summaryTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  summaryHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  list: { paddingHorizontal: 14, marginTop: 12, gap: 11 },
  card: { ...commercialCardStyle, borderWidth: 1, borderColor: colors.dangerBorder },
  cardTop: { flexDirection: "row", gap: 11 },
  preview: { width: 72, height: 72, borderRadius: 14, backgroundColor: colors.skeleton },
  kindMark: { width: 58, height: 58, borderRadius: 17, backgroundColor: colors.warningBg, alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  cardContext: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" },
  date: { color: colors.faint, fontSize: 9, fontWeight: "700" },
  evidence: { alignSelf: "flex-start", borderRadius: radii.pill, backgroundColor: colors.holidayBg, paddingHorizontal: 9, paddingVertical: 6, marginTop: 10, flexDirection: "row", alignItems: "center", gap: 5 },
  evidenceText: { color: colors.holiday, fontSize: 8, fontWeight: "900" },
  error: { marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.dangerBg, flexDirection: "row", alignItems: "flex-start", gap: 7 },
  errorText: { flex: 1, color: colors.dangerPressed, fontSize: 10, lineHeight: 15 },
  attempts: { color: colors.faint, fontSize: 8, fontWeight: "800", marginTop: 8 },
  actions: { gap: 8, marginTop: 12 },
  action: { width: "100%" },
  moreActions: { minHeight: 44, borderRadius: 14, paddingHorizontal: 14, backgroundColor: colors.primarySoft, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  moreActionsText: { flex: 1, color: colors.primary, fontSize: 12, fontWeight: "900" },
  secondaryActions: { gap: 8, paddingTop: 1 },
  recoveryButton: { minHeight: 46, borderRadius: 15, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  recoveryButtonText: { fontSize: 13, fontWeight: "900", textAlign: "center" },
  recoveryButtonDisabled: { opacity: 0.42 },
  recoveryButtonPressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  commercialLink: { ...commercialCardStyle, marginHorizontal: 14, marginTop: 14, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: colors.border },
  commercialMark: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  commercialMarkText: { color: colors.primary, fontSize: 20, fontWeight: "900" },
  commercialBody: { flex: 1, minWidth: 0 },
  commercialTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  commercialHint: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 3 },
  arrow: { color: colors.primary, fontSize: 27 },
})
