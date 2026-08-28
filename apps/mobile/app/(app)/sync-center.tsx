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
import { useField } from "../../src/field/field-context"
import type { FieldWorkdayAction, FieldWorkdayStatus } from "../../src/field/contracts"
import { workdayRecoveryDetail } from "../../src/field/workday-recovery"
import { IS_LEADDRIVE_FIELD } from "../../src/config/mobile-variant"

const workdayStatusKeys: Record<FieldWorkdayStatus, MessageKey> = {
  STARTED: "workdayStatus_STARTED",
  PAUSED: "workdayStatus_PAUSED",
  COMPLETED: "workdayStatus_COMPLETED",
}

const workdayActionKeys: Record<FieldWorkdayAction, MessageKey> = {
  START: "workdayStart",
  PAUSE: "workdayPause",
  RESUME: "workdayResume",
  FINISH: "workdayFinish",
}

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

function rowError(row: FieldSyncRecoveryRow): string | null {
  const detail = record(row.detail)
  return string(detail?.error) ?? string(detail?.message) ?? string(detail?.code) ??
    (typeof row.detail === "string" ? row.detail : null)
}

function rowPhoto(row: FieldSyncRecoveryRow): string | null {
  if (row.evidence?.fileUri && row.evidence.status !== "applied") return row.evidence.fileUri
  return row.kind === "field.visit.photo" ? string(row.payload.fileUri) : null
}

function isWorkforceRow(row: FieldSyncRecoveryRow): boolean {
  return row.kind === "field.workday.event" || row.kind === "field.hrm.create" || row.kind === "field.hrm.cancel"
}

function workforceRecoveryPath(row: FieldSyncRecoveryRow): "/workday" | "/hrm" {
  return row.kind === "field.workday.event" ? "/workday" : "/hrm"
}

function WorkdayRecoveryFact({ detail }: { detail: unknown }) {
  const recovery = workdayRecoveryDetail(detail)
  if (!recovery.serverStatus) return null
  return (
    <View style={styles.workdayRecovery} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.workdayRecoveryLabel}>{t("syncCenterWorkforceServerState")}</Text>
      <Text style={styles.workdayRecoveryState}>{t(workdayStatusKeys[recovery.serverStatus])}</Text>
      {recovery.allowedActions === null ? (
        <Text style={styles.workdayRecoveryHint}>{t("syncCenterWorkforceActionsUnknown")}</Text>
      ) : recovery.allowedActions.length === 0 ? (
        <Text style={styles.workdayRecoveryHint}>{t("syncCenterWorkforceNoActions")}</Text>
      ) : (
        <>
          <Text style={styles.workdayRecoveryLabel}>{t("syncCenterWorkforceAllowedActions")}</Text>
          <View style={styles.workdayRecoveryActions}>
            {recovery.allowedActions.map((action) => (
              <CommercialPill key={action} label={t(workdayActionKeys[action])} tone="warning" />
            ))}
          </View>
        </>
      )}
    </View>
  )
}

export default function SyncCenterScreen() {
  const locale = useLocale()
  const field = useField()
  const { status, sync, syncWorkforce, workforceStatus } = useSync()
  const [rows, setRows] = useState<FieldSyncRecoveryRow[]>(listFieldSyncRecoveryQueue)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const reload = useCallback(() => setRows(listFieldSyncRecoveryQueue()), [])

  useFocusEffect(reload)
  useEffect(() => {
    if (status.phase === "idle" || status.phase === "offline" || status.phase === "error") reload()
  }, [reload, status.lastSyncAt, status.phase])

  const syncBusy = !["idle", "offline", "error", "authLost", "upgradeRequired"].includes(status.phase)
  const workforceBusy = !["idle", "offline", "error", "authLost", "upgradeRequired"].includes(workforceStatus.phase)
  const workforceActive = IS_LEADDRIVE_FIELD && field.workforceEnabled
  const workforceAttention = workforceStatus.conflictOps + workforceStatus.rejectedOps

  async function flush() {
    reload()
    await sync().catch(() => {})
    reload()
  }

  async function flushWorkforce() {
    await syncWorkforce().catch(() => {})
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
      Alert.alert(t("fieldDataError"), error instanceof Error ? error.message : String(error))
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
      Alert.alert(t("fieldDataError"), error instanceof Error ? error.message : String(error))
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
      Alert.alert(t("fieldDataError"), error instanceof Error ? error.message : String(error))
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

        {workforceActive ? (
          <View style={styles.workforceCard}>
            <View style={styles.workforceTop}>
              <View style={styles.workforceMark}><Text style={styles.workforceMarkText}>◷</Text></View>
              <View style={styles.workforceBody}>
                <Text style={styles.workforceTitle}>{t("syncCenterWorkforceTitle")}</Text>
                <Text style={styles.workforceHint}>{t("syncCenterWorkforceHint")}</Text>
              </View>
            </View>
            <View style={styles.workforceMeta}>
              <CommercialPill label={t("syncCenterWorkforcePending", { count: workforceStatus.pendingOps })} tone={workforceStatus.pendingOps > 0 ? "warning" : "success"} />
              {workforceAttention > 0 ? <CommercialPill label={t("syncCenterWorkforceAttention", { count: workforceAttention })} tone="danger" /> : null}
            </View>
            {workforceStatus.error ? <View style={styles.error}><Text style={styles.errorText} numberOfLines={3}>{workforceStatus.error}</Text></View> : null}
            <Text style={styles.workforceSaved}>{t("syncCenterWorkforceSaved")}</Text>
            <CommercialButton
              label={t("syncCenterWorkforceRetry")}
              tone="secondary"
              disabled={workforceBusy || workforceStatus.phase === "authLost" || workforceStatus.phase === "upgradeRequired"}
              onPress={() => void flushWorkforce()}
            />
          </View>
        ) : null}

        {rows.length > 0 ? <View style={styles.list}>{rows.map((row) => {
          const photoUri = rowPhoto(row)
          const error = rowError(row)
          const workforceRecovery = workforceActive && isWorkforceRow(row)
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
              {workforceRecovery && row.kind === "field.workday.event" ? <WorkdayRecoveryFact detail={row.detail} /> : null}
              {workforceRecovery ? <Text style={styles.workforceSaved}>{t("syncCenterWorkforceSaved")}</Text> : null}
              <Text style={styles.attempts}>{t("syncCenterAttempts", { count: row.attempts })}</Text>
              <View style={styles.actions}>
                {workforceRecovery ? (
                  <View style={styles.action}>
                    <CommercialButton
                      label={row.kind === "field.workday.event" ? t("syncCenterOpenWorkday") : t("syncCenterOpenHrm")}
                      tone="secondary"
                      onPress={() => router.push(workforceRecoveryPath(row) as never)}
                    />
                  </View>
                ) : (
                  <View style={styles.action}><CommercialButton label={busyId === row.clientOpId ? "…" : t("syncCenterRetry")} disabled={busyId !== null || syncBusy} onPress={() => void retry(row)} /></View>
                )}
                {row.canContinueWithoutEvidence ? <View style={styles.action}><CommercialButton label={t("syncCenterWithoutPhoto")} tone="secondary" disabled={busyId !== null || syncBusy} onPress={() => confirmWithoutPhoto(row)} /></View> : null}
                {row.canDetachAttachment ? <View style={styles.action}><CommercialButton label={locale === "az" ? "Faylsız" : "Без файла"} tone="secondary" disabled={busyId !== null || syncBusy} onPress={() => confirmWithoutAttachment(row)} /></View> : null}
              </View>
            </View>
          )
        })}</View> : null}

        <Pressable onPress={() => router.push("/(app)/commercial/media-queue" as never)} style={styles.commercialLink}>
          <View style={styles.commercialMark}><Text style={styles.commercialMarkText}>⌾</Text></View>
          <View style={styles.commercialBody}><Text style={styles.commercialTitle}>{t("syncCenterCommercialMedia")}</Text><Text style={styles.commercialHint}>{t("syncCenterCommercialMediaHint")}</Text></View>
          <Text style={styles.arrow}>›</Text>
        </Pressable>
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
  workforceCard: { ...commercialCardStyle, marginHorizontal: 14, marginTop: 12, borderWidth: 1, borderColor: colors.primarySoft },
  workforceTop: { flexDirection: "row", alignItems: "center", gap: 11 },
  workforceMark: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  workforceMarkText: { color: colors.primary, fontSize: 21, fontWeight: "900" },
  workforceBody: { flex: 1, minWidth: 0 },
  workforceTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  workforceHint: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  workforceMeta: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  workforceSaved: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 10, marginBottom: 12 },
  workdayRecovery: { marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.warning },
  workdayRecoveryLabel: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  workdayRecoveryState: { color: colors.text, fontSize: 13, fontWeight: "900", marginTop: 3 },
  workdayRecoveryHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 6 },
  workdayRecoveryActions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 7 },
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
