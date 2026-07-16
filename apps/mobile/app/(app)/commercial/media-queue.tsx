import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useFocusEffect } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { SyncBar } from "../../../src/components/SyncBar"
import {
  detachCommercialMedia,
  listCommercialMediaRecoveryQueue,
  retryCommercialMedia,
  type CommercialMediaRecoveryRow,
} from "../../../src/db/local-store"
import { discardCommercialMediaFile } from "../../../src/commercial/media-store"
import {
  CommercialButton,
  CommercialEmpty,
  CommercialHeader,
  CommercialPill,
  commercialCardStyle,
} from "../../../src/commercial/ui"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { t, useLocale } from "../../../src/i18n"
import { useSync } from "../../../src/sync/sync-context"
import { colors, radii } from "../../../src/theme"

function purposeLabel(purpose: CommercialMediaRecoveryRow["purpose"]): string {
  return purpose === "PROMOTION_PROOF" ? t("commercialMediaPromotion") : t("commercialMediaReturn")
}

export default function CommercialMediaQueueScreen() {
  const locale = useLocale()
  const { status, sync } = useSync()
  const [rows, setRows] = useState<CommercialMediaRecoveryRow[]>(() => listCommercialMediaRecoveryQueue())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const reload = useCallback(() => setRows(listCommercialMediaRecoveryQueue()), [])

  useFocusEffect(reload)
  useEffect(() => {
    if (status.phase === "idle" || status.phase === "offline" || status.phase === "error") reload()
  }, [reload, status.lastSyncAt, status.phase])

  const quarantinedCount = useMemo(
    () => rows.filter((row) => row.status === "quarantined").length,
    [rows],
  )
  const syncBusy = status.phase === "pulling"
    || status.phase === "acking"
    || status.phase === "uploadingPhotos"
    || status.phase === "pushing"

  async function syncQuietly() {
    try {
      await sync()
    } catch {
      // The media remains durable in SQLite and can be retried later.
    } finally {
      reload()
    }
  }

  async function retry(row: CommercialMediaRecoveryRow) {
    if (busyId || syncBusy) return
    setBusyId(row.clientMediaId)
    try {
      retryCommercialMedia(row.clientMediaId)
      reload()
      Alert.alert(t("commercialMediaRetryQueued"))
      await syncQuietly()
    } catch (error) {
      Alert.alert(t("fieldDataError"), error instanceof Error ? error.message : String(error))
    } finally {
      setBusyId(null)
    }
  }

  async function continueWithoutPhoto(row: CommercialMediaRecoveryRow) {
    if (busyId || syncBusy) return
    setBusyId(row.clientMediaId)
    try {
      const detached = detachCommercialMedia(row.clientMediaId)
      if (detached) await discardCommercialMediaFile(detached.fileUri)
      reload()
      Alert.alert(t("commercialMediaRemoved"))
      await syncQuietly()
    } catch (error) {
      Alert.alert(t("fieldDataError"), error instanceof Error ? error.message : String(error))
    } finally {
      setBusyId(null)
    }
  }

  function confirmWithoutPhoto(row: CommercialMediaRecoveryRow) {
    Alert.alert(t("commercialMediaRemoveTitle"), t("commercialMediaRemoveBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("commercialMediaRemoveConfirm"),
        style: "destructive",
        onPress: () => void continueWithoutPhoto(row),
      },
    ])
  }

  async function refresh() {
    setRefreshing(true)
    try {
      await syncQuietly()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <CommercialHeader title={t("commercialMediaQueueTitle")} subtitle={t("commercialMediaQueueSubtitle")} />
      <SyncBar />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={styles.scroll}
      >
        {rows.length > 0 ? (
          <View style={[styles.summary, quarantinedCount > 0 && styles.summaryAttention]}>
            <View style={[styles.summaryGlyph, quarantinedCount > 0 && styles.summaryGlyphAttention]}>
              <Text style={[styles.summaryGlyphText, quarantinedCount > 0 && styles.summaryGlyphTextAttention]}>⌾</Text>
            </View>
            <View style={styles.summaryBody}>
              <Text style={styles.summaryTitle}>{t("commercialMediaQueueHint", { count: rows.length })}</Text>
              <Text style={styles.summaryHint}>
                {quarantinedCount > 0
                  ? `${quarantinedCount} · ${t("commercialMediaQuarantined")}`
                  : t("commercialMediaPending")}
              </Text>
            </View>
          </View>
        ) : null}

        {rows.length === 0 ? (
          <CommercialEmpty
            glyph="✓"
            title={t("commercialMediaQueueEmpty")}
            hint={t("commercialMediaQueueEmptyHint")}
          />
        ) : (
          <View style={styles.list}>
            {rows.map((row) => {
              const quarantined = row.status === "quarantined"
              const busy = busyId === row.clientMediaId
              const statusLabel = quarantined
                ? t("commercialMediaQuarantined")
                : row.attempts > 0
                  ? t("commercialMediaRetrying")
                  : t("commercialMediaPending")
              return (
                <View key={row.clientMediaId} style={[styles.card, quarantined && styles.cardAttention]}>
                  <View style={styles.cardTop}>
                    <Image source={{ uri: row.fileUri }} style={styles.preview} />
                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle}>{purposeLabel(row.purpose)}</Text>
                      <Text style={styles.cardDate}>{formatShortDateTime(row.takenAt, locale)}</Text>
                      <View style={styles.pillRow}>
                        <CommercialPill label={statusLabel} tone={quarantined ? "danger" : "warning"} />
                        {row.attempts > 0 ? (
                          <Text style={styles.attempts}>{t("commercialMediaAttempts", { count: row.attempts })}</Text>
                        ) : null}
                      </View>
                    </View>
                  </View>

                  {row.lastError ? (
                    <View style={styles.errorBox}>
                      <Text style={styles.errorText} numberOfLines={3}>{row.lastError}</Text>
                    </View>
                  ) : null}

                  <View style={styles.actions}>
                    <View style={styles.action}>
                      <CommercialButton
                        label={busy ? "…" : t("commercialMediaRetry")}
                        disabled={busyId !== null || syncBusy}
                        onPress={() => void retry(row)}
                      />
                    </View>
                    <View style={styles.action}>
                      <CommercialButton
                        label={t("commercialMediaWithoutPhoto")}
                        tone="secondary"
                        disabled={busyId !== null || syncBusy}
                        onPress={() => confirmWithoutPhoto(row)}
                      />
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: 34 },
  summary: {
    marginHorizontal: 14,
    marginTop: 10,
    padding: 14,
    borderRadius: radii.card,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBg,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  summaryAttention: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
  summaryGlyph: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  summaryGlyphAttention: { backgroundColor: colors.card },
  summaryGlyphText: { color: colors.warning, fontSize: 23, fontWeight: "900" },
  summaryGlyphTextAttention: { color: colors.dangerPressed },
  summaryBody: { flex: 1, minWidth: 0 },
  summaryTitle: { color: colors.text, fontSize: 13, fontWeight: "900", lineHeight: 18 },
  summaryHint: { color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 3 },
  list: { paddingHorizontal: 14, marginTop: 12, gap: 11 },
  card: { ...commercialCardStyle, borderWidth: 1, borderColor: colors.border },
  cardAttention: { borderColor: colors.dangerBorder },
  cardTop: { flexDirection: "row", gap: 12 },
  preview: { width: 82, height: 82, borderRadius: radii.inner, backgroundColor: colors.skeleton },
  cardBody: { flex: 1, minWidth: 0, justifyContent: "center" },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  cardDate: { color: colors.muted, fontSize: 11, marginTop: 4 },
  pillRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 9 },
  attempts: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  errorBox: { marginTop: 12, padding: 10, borderRadius: radii.inner, backgroundColor: colors.dangerBg },
  errorText: { color: colors.dangerPressed, fontSize: 10, lineHeight: 15 },
  actions: { flexDirection: "row", gap: 8, marginTop: 13 },
  action: { flex: 1 },
})
