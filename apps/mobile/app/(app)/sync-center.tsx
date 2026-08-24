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
  CommercialButton,
  CommercialEmpty,
  CommercialHeader,
  CommercialPill,
  commercialCardStyle,
} from "../../src/commercial/ui"
import { SyncBar } from "../../src/components/SyncBar"
import {
  detachFieldCommitmentEvidence,
  detachFieldMessageAttachment,
  listFieldSyncRecoveryQueue,
  retryFieldSyncOperation,
  type FieldSyncRecoveryRow,
} from "../../src/db/local-store"
import { discardFieldVisitPhotoFile } from "../../src/field/visit-photo-store"
import { formatShortDateTime } from "../../src/i18n/date-format"
import { t, useLocale, type MessageKey } from "../../src/i18n"
import { useSync } from "../../src/sync/sync-context"
import { colors, radii } from "../../src/theme"
import { EncryptedMediaImage } from "../../src/components/EncryptedMediaImage"
import { IS_LEADDRIVE_FIELD } from "../../src/config/mobile-variant"
import { fieldErrorMessage, fieldErrorMessageForCode, FIELD_TASK_ERROR_OVERRIDES } from "../../src/field/error-message"

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

function rowContext(row: FieldSyncRecoveryRow): string | null {
  return string(row.payload.productName) ??
    string(row.payload.customerName) ??
    string(row.payload.title) ??
    string(row.payload.fileName) ??
    string(row.payload.body) ??
    string(row.payload.reason) ??
    string(row.payload.actionKey) ??
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

function rowError(row: FieldSyncRecoveryRow): string | null {
  const detail = record(row.detail)
  if (!detail && typeof row.detail !== "string") return null
  return fieldErrorMessageForCode(
    detail?.code,
    rowErrorFallback(row),
    row.kind.startsWith("field.task.") ? FIELD_TASK_ERROR_OVERRIDES : {},
  )
}

function rowPhoto(row: FieldSyncRecoveryRow): string | null {
  if (row.evidence?.fileUri && row.evidence.status !== "applied") return row.evidence.fileUri
  return row.kind === "field.visit.photo" ? string(row.payload.fileUri) : null
}

export default function SyncCenterScreen() {
  const locale = useLocale()
  const { status, sync } = useSync()
  const [rows, setRows] = useState<FieldSyncRecoveryRow[]>(listFieldSyncRecoveryQueue)
  const [busyId, setBusyId] = useState<string | null>(null)
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
    try {
      const next = retryFieldSyncOperation(row.clientOpId)
      if (!next) return
      Alert.alert(t("syncCenterRetryQueued"))
      await flush()
    } catch (error) {
      Alert.alert(t("fieldDataError"), fieldErrorMessage(error, "syncNeedsAttention"))
    } finally {
      setBusyId(null)
    }
  }

  async function continueWithoutPhoto(row: FieldSyncRecoveryRow) {
    if (busyId || syncBusy) return
    setBusyId(row.clientOpId)
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
    }
  }

  async function continueWithoutAttachment(row: FieldSyncRecoveryRow) {
    if (busyId || syncBusy) return
    setBusyId(row.clientOpId)
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
      <CommercialHeader title={t("syncCenterTitle")} subtitle={t("syncCenterSubtitle")} />
      <SyncBar />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
      >
        {rows.length > 0 ? (
          <View style={styles.summary}>
            <View style={styles.summaryMark}><Text style={styles.summaryMarkText}>!</Text></View>
            <View style={styles.summaryBody}>
              <Text style={styles.summaryTitle}>{t("syncCenterSummary", { count: rows.length })}</Text>
              <Text style={styles.summaryHint}>{t("syncCenterSummaryHint")}</Text>
            </View>
          </View>
        ) : (
          <CommercialEmpty glyph="✓" title={t("syncCenterEmpty")} hint={t("syncCenterEmptyHint")} />
        )}

        {rows.length > 0 ? <View style={styles.list}>{rows.map((row) => {
          const photoUri = rowPhoto(row)
          const error = rowError(row)
          return (
            <View key={row.clientOpId} style={styles.card}>
              <View style={styles.cardTop}>
                {photoUri ? <EncryptedMediaImage uri={photoUri} style={styles.preview} /> : <View style={styles.kindMark}><Text style={styles.kindMarkText}>↻</Text></View>}
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{kindLabel(row.kind, locale)}</Text>
                  {rowContext(row) ? <Text style={styles.cardContext} numberOfLines={2}>{rowContext(row)}</Text> : null}
                  <View style={styles.metaRow}>
                    <CommercialPill label={row.status === "conflict" ? t("syncCenterConflict") : t("syncCenterRejected")} tone="danger" />
                    <Text style={styles.date}>{formatShortDateTime(row.clientCreatedAt, locale)}</Text>
                  </View>
                </View>
              </View>
              {row.evidence ? <View style={styles.evidence}><Text style={styles.evidenceText}>⌾ {t(row.evidence.status === "applied" ? "syncCenterEvidenceUploaded" : "syncCenterEvidenceReady")}</Text></View> : null}
              {error ? <View style={styles.error}><Text style={styles.errorText} numberOfLines={4}>{error}</Text></View> : null}
              <Text style={styles.attempts}>{t("syncCenterAttempts", { count: row.attempts })}</Text>
              <View style={styles.actions}>
                <View style={styles.action}><CommercialButton label={busyId === row.clientOpId ? "…" : t("syncCenterRetry")} disabled={busyId !== null || syncBusy} onPress={() => void retry(row)} /></View>
                {row.canContinueWithoutEvidence ? <View style={styles.action}><CommercialButton label={t("syncCenterWithoutPhoto")} tone="secondary" disabled={busyId !== null || syncBusy} onPress={() => confirmWithoutPhoto(row)} /></View> : null}
                {row.canDetachAttachment ? <View style={styles.action}><CommercialButton label={locale === "az" ? "Faylsız" : "Без файла"} tone="secondary" disabled={busyId !== null || syncBusy} onPress={() => confirmWithoutAttachment(row)} /></View> : null}
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
  summary: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, padding: 14, backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: colors.dangerBorder, flexDirection: "row", alignItems: "center", gap: 11 },
  summaryMark: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  summaryMarkText: { color: colors.dangerPressed, fontSize: 20, fontWeight: "900" },
  summaryBody: { flex: 1, minWidth: 0 },
  summaryTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  summaryHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  list: { paddingHorizontal: 14, marginTop: 12, gap: 11 },
  card: { ...commercialCardStyle, borderWidth: 1, borderColor: colors.dangerBorder },
  cardTop: { flexDirection: "row", gap: 11 },
  preview: { width: 72, height: 72, borderRadius: 14, backgroundColor: colors.skeleton },
  kindMark: { width: 58, height: 58, borderRadius: 17, backgroundColor: colors.warningBg, alignItems: "center", justifyContent: "center" },
  kindMarkText: { color: colors.warning, fontSize: 23, fontWeight: "900" },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  cardContext: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" },
  date: { color: colors.faint, fontSize: 9, fontWeight: "700" },
  evidence: { alignSelf: "flex-start", borderRadius: radii.pill, backgroundColor: colors.holidayBg, paddingHorizontal: 9, paddingVertical: 6, marginTop: 10 },
  evidenceText: { color: colors.holiday, fontSize: 8, fontWeight: "900" },
  error: { marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.dangerBg },
  errorText: { color: colors.dangerPressed, fontSize: 10, lineHeight: 15 },
  attempts: { color: colors.faint, fontSize: 8, fontWeight: "800", marginTop: 8 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  action: { flex: 1 },
  commercialLink: { ...commercialCardStyle, marginHorizontal: 14, marginTop: 14, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: colors.border },
  commercialMark: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  commercialMarkText: { color: colors.primary, fontSize: 20, fontWeight: "900" },
  commercialBody: { flex: 1, minWidth: 0 },
  commercialTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  commercialHint: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 3 },
  arrow: { color: colors.primary, fontSize: 27 },
})
