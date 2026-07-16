import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { useFocusEffect } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  CommercialButton,
  CommercialEmpty,
  CommercialHeader,
  CommercialPill,
  CommercialVisitContext,
  commercialCardStyle,
} from "../../../src/commercial/ui"
import { readCommercialMobileState, type CommercialMobileState } from "../../../src/commercial/mobile-state"
import { enqueuePromotionEnroll, enqueuePromotionSubmit } from "../../../src/db/local-store"
import { SyncBar } from "../../../src/components/SyncBar"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { t, useLocale, type MessageKey } from "../../../src/i18n"
import { useSync } from "../../../src/sync/sync-context"
import { colors, radii } from "../../../src/theme"
import { captureCommercialPhoto, type CommercialPhotoCapture } from "../../../src/commercial/capture-photo"
import { discardCommercialMedia, persistCommercialMedia } from "../../../src/commercial/media-store"

type Promotion = CommercialMobileState["snapshot"]["promotions"][number]
type Execution = CommercialMobileState["snapshot"]["promotionExecutions"][number]

function executionLabel(status: Execution["status"]): string {
  return t(`commercialPromotionStatus_${status}` as MessageKey)
}

function executionTone(status: Execution["status"]): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "APPROVED") return "success"
  if (status === "REJECTED") return "danger"
  if (status === "SUBMITTED") return "info"
  return "warning"
}

function isPromotionActive(promotion: Promotion, now = Date.now()): boolean {
  const startsAt = Date.parse(promotion.activeFrom)
  const endsAt = promotion.activeTo ? Date.parse(promotion.activeTo) : Number.POSITIVE_INFINITY
  return startsAt <= now && endsAt >= now
}

export default function PromotionsScreen() {
  const locale = useLocale()
  const { status, sync } = useSync()
  const [state, setState] = useState<CommercialMobileState>(() => readCommercialMobileState())
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [photos, setPhotos] = useState<Record<string, CommercialPhotoCapture>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const reload = useCallback(() => setState(readCommercialMobileState()), [])

  useFocusEffect(reload)
  useEffect(() => {
    if (status.phase === "idle" || status.phase === "offline" || status.phase === "error") reload()
  }, [reload, status.lastSyncAt, status.phase])

  const promotions = useMemo(
    () => [...state.snapshot.promotions].sort((left, right) => {
      const activeDelta = Number(isPromotionActive(right)) - Number(isPromotionActive(left))
      return activeDelta || right.activeFrom.localeCompare(left.activeFrom)
    }),
    [state.snapshot.promotions],
  )

  function executionFor(promotionId: string): Execution | null {
    if (!state.activeVisit) return null
    return state.snapshot.promotionExecutions
      .filter((execution) => execution.promotionId === promotionId && execution.storeId === state.activeVisit?.storeId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  }

  async function flush() {
    reload()
    try {
      await sync()
    } catch {
      // Offline is expected; the shared outbox already owns the operation.
    } finally {
      reload()
    }
  }

  async function enroll(promotion: Promotion) {
    if (!state.activeVisit || busyId) return
    setBusyId(promotion.id)
    try {
      enqueuePromotionEnroll({
        promotionId: promotion.id,
        storeId: state.activeVisit.storeId,
        visitId: state.activeVisit.id,
      })
      Alert.alert(t("commercialSavedOffline"))
      await flush()
    } finally {
      setBusyId(null)
    }
  }

  async function submit(execution: Execution) {
    const note = notes[execution.clientExecutionId]?.trim() ?? ""
    if (note.length < 2 || busyId) return
    setBusyId(execution.clientExecutionId)
    let media: Awaited<ReturnType<typeof persistCommercialMedia>> | undefined
    try {
      const photo = photos[execution.clientExecutionId]
      if (photo) {
        media = await persistCommercialMedia({
          sourceUri: photo.uri,
          purpose: "PROMOTION_PROOF",
          takenAt: photo.takenAt,
        })
      }
      enqueuePromotionSubmit({ clientExecutionId: execution.clientExecutionId, note }, media)
      setNotes((current) => ({ ...current, [execution.clientExecutionId]: "" }))
      setPhotos((current) => {
        const next = { ...current }
        delete next[execution.clientExecutionId]
        return next
      })
      Alert.alert(t("commercialSavedOffline"))
      await flush()
    } catch (error) {
      if (media) await discardCommercialMedia(media)
      Alert.alert(t("fieldDataError"), error instanceof Error ? error.message : String(error))
    } finally {
      setBusyId(null)
    }
  }

  async function capture(execution: Execution) {
    const result = await captureCommercialPhoto()
    if (result === "denied") {
      Alert.alert(t("cameraPermissionDenied"))
      return
    }
    if (result) {
      setPhotos((current) => ({ ...current, [execution.clientExecutionId]: result }))
    }
  }

  async function refresh() {
    setRefreshing(true)
    try {
      await sync()
    } finally {
      reload()
      setRefreshing(false)
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <CommercialHeader title={t("commercialPromotionsTitle")} subtitle={t("commercialPromotionsSubtitle")} />
      <SyncBar />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <CommercialVisitContext
          active={Boolean(state.activeVisit)}
          storeName={state.activeStore?.name ?? null}
          activeLabel={t("commercialActiveVisit")}
          missingLabel={t("commercialPromotionNeedsVisit")}
        />

        <View style={styles.summary}>
          <View><Text style={styles.summaryValue}>{promotions.filter((promotion) => isPromotionActive(promotion)).length}</Text><Text style={styles.summaryLabel}>{t("commercialPromotionsActive")}</Text></View>
          <View style={styles.summaryDivider} />
          <View><Text style={styles.summaryValue}>{state.snapshot.promotionExecutions.length}</Text><Text style={styles.summaryLabel}>{t("commercialPromotionsMyResults")}</Text></View>
        </View>

        {promotions.length === 0 ? (
          <CommercialEmpty glyph="%" title={t("commercialPromotionsEmpty")} hint={t("commercialPromotionsEmptyHint")} />
        ) : (
          <View style={styles.list}>
            {promotions.map((promotion) => {
              const active = isPromotionActive(promotion)
              const execution = executionFor(promotion.id)
              const note = execution ? notes[execution.clientExecutionId] ?? "" : ""
              const photo = execution ? photos[execution.clientExecutionId] : undefined
              const canSubmit = Boolean(execution && execution.status === "ENROLLED" && note.trim().length >= 2)
              return (
                <View key={promotion.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardTitleBody}>
                      <Text style={styles.cardTitle}>{promotion.name}</Text>
                      <Text style={styles.cardKind}>{promotion.kind}</Text>
                    </View>
                    {execution
                      ? <CommercialPill label={executionLabel(execution.status)} tone={executionTone(execution.status)} />
                      : <CommercialPill label={active ? t("commercialPromotionAvailable") : t("commercialPromotionInactive")} tone={active ? "success" : "neutral"} />}
                  </View>
                  <Text style={styles.period}>
                    {formatShortDateTime(promotion.activeFrom, locale)} · {promotion.activeTo ? formatShortDateTime(promotion.activeTo, locale) : t("commercialNoEndDate")}
                  </Text>
                  <View style={styles.metrics}>
                    <Text style={styles.metric}>{promotion.productIds.length} {t("commercialPromotionProducts")}</Text>
                  </View>

                  {!execution ? (
                    <View style={styles.actionBlock}>
                      <Text style={styles.actionHint}>{state.activeVisit ? t("commercialPromotionEnrollHint") : t("commercialPromotionNeedsVisit")}</Text>
                      <CommercialButton
                        label={t("commercialPromotionEnroll")}
                        disabled={!active || !state.activeVisit || busyId !== null}
                        onPress={() => void enroll(promotion)}
                      />
                    </View>
                  ) : execution.status === "ENROLLED" ? (
                    <View style={styles.actionBlock}>
                      <Text style={styles.inputLabel}>{t("commercialPromotionResult")}</Text>
                      <TextInput
                        value={note}
                        onChangeText={(value) => setNotes((current) => ({ ...current, [execution.clientExecutionId]: value }))}
                        placeholder={t("commercialPromotionResultPlaceholder")}
                        placeholderTextColor={colors.faint}
                        multiline
                        textAlignVertical="top"
                        maxLength={1000}
                        style={styles.textarea}
                      />
                      <View style={styles.photoRow}>
                        {photo ? <Image source={{ uri: photo.uri }} style={styles.photoPreview} /> : <View style={styles.photoPlaceholder}><Text style={styles.photoGlyph}>⌾</Text></View>}
                        <View style={styles.photoBody}>
                          <Text style={styles.photoTitle}>{photo ? t("commercialPhotoReady") : t("commercialPromotionProofHint")}</Text>
                          <View style={styles.photoButton}>
                            <CommercialButton
                              label={photo ? t("commercialRetakePhoto") : t("commercialAddPhoto")}
                              tone="secondary"
                              disabled={busyId !== null}
                              onPress={() => void capture(execution)}
                            />
                          </View>
                        </View>
                      </View>
                      <CommercialButton
                        label={t("commercialPromotionSubmit")}
                        disabled={!canSubmit || busyId !== null}
                        onPress={() => void submit(execution)}
                      />
                    </View>
                  ) : (
                    <View style={styles.resultBlock}>
                      <Text style={styles.resultLabel}>{t("commercialPromotionLastResult")}</Text>
                      <Text style={styles.resultText}>{execution.note || t("commercialPromotionProofAttached")}</Text>
                      {execution.submittedAt ? <Text style={styles.resultTime}>{formatShortDateTime(execution.submittedAt, locale)}</Text> : null}
                    </View>
                  )}
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
  scroll: { paddingBottom: 30 },
  summary: { ...commercialCardStyle, marginHorizontal: 14, marginTop: 10, paddingVertical: 14, flexDirection: "row", justifyContent: "space-around" },
  summaryDivider: { width: 1, backgroundColor: colors.border },
  summaryValue: { color: colors.text, fontSize: 22, fontWeight: "900", textAlign: "center" },
  summaryLabel: { color: colors.muted, fontSize: 10, fontWeight: "700", marginTop: 2, textAlign: "center" },
  list: { gap: 11, paddingHorizontal: 14, marginTop: 18 },
  card: { ...commercialCardStyle },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardTitleBody: { flex: 1, minWidth: 0 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  cardKind: { color: colors.primary, fontSize: 10, fontWeight: "800", marginTop: 3, textTransform: "uppercase" },
  period: { color: colors.muted, fontSize: 11, marginTop: 10 },
  metrics: { flexDirection: "row", marginTop: 9 },
  metric: { color: colors.draft, backgroundColor: colors.draftBg, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 5, fontSize: 10, fontWeight: "800" },
  actionBlock: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 14, paddingTop: 13, gap: 9 },
  actionHint: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  inputLabel: { color: colors.text, fontSize: 12, fontWeight: "900" },
  textarea: { minHeight: 88, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, borderRadius: radii.inner, paddingHorizontal: 12, paddingVertical: 11, color: colors.text, fontSize: 13, lineHeight: 18 },
  photoRow: { minHeight: 72, borderRadius: radii.inner, backgroundColor: colors.bg, padding: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  photoPreview: { width: 54, height: 54, borderRadius: 12, backgroundColor: colors.skeleton },
  photoPlaceholder: { width: 54, height: 54, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  photoGlyph: { color: colors.primary, fontSize: 22, fontWeight: "900" },
  photoBody: { flex: 1, minWidth: 0 },
  photoTitle: { color: colors.muted, fontSize: 10, lineHeight: 14 },
  photoButton: { marginTop: 6 },
  resultBlock: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 14, paddingTop: 12 },
  resultLabel: { color: colors.faint, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  resultText: { color: colors.text, fontSize: 12, lineHeight: 17, marginTop: 4 },
  resultTime: { color: colors.muted, fontSize: 10, marginTop: 6 },
})
