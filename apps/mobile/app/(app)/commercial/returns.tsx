import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Alert,
  Modal,
  Pressable,
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
  CommercialSection,
  commercialCardStyle,
} from "../../../src/commercial/ui"
import { readCommercialMobileState, type CommercialMobileState } from "../../../src/commercial/mobile-state"
import { enqueueSalesReturn } from "../../../src/db/local-store"
import { SyncBar } from "../../../src/components/SyncBar"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { t, useLocale, type MessageKey } from "../../../src/i18n"
import { useSync } from "../../../src/sync/sync-context"
import { colors, radii } from "../../../src/theme"

type CommercialOrder = CommercialMobileState["snapshot"]["orders"][number]
type CommercialReturn = CommercialMobileState["snapshot"]["returns"][number]
type ReturnReason = "DAMAGED" | "EXPIRED" | "WRONG_ITEM" | "CUSTOMER_REQUEST" | "OTHER"

const REASONS: ReturnReason[] = ["DAMAGED", "EXPIRED", "WRONG_ITEM", "CUSTOMER_REQUEST", "OTHER"]

function returnStatus(status: CommercialReturn["status"]): string {
  return t(`commercialReturnStatus_${status}` as MessageKey)
}

function returnTone(status: CommercialReturn["status"]): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "APPROVED" || status === "RECEIVED") return "success"
  if (status === "REJECTED") return "danger"
  return "info"
}

function reasonLabel(reason: ReturnReason | string): string {
  return REASONS.includes(reason as ReturnReason)
    ? t(`commercialReturnReason_${reason}` as MessageKey)
    : reason
}

function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`
}

export default function ReturnsScreen() {
  const locale = useLocale()
  const { status, sync } = useSync()
  const [state, setState] = useState<CommercialMobileState>(() => readCommercialMobileState())
  const [selected, setSelected] = useState<CommercialOrder | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [reason, setReason] = useState<ReturnReason>("DAMAGED")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const reload = useCallback(() => setState(readCommercialMobileState()), [])

  useFocusEffect(reload)
  useEffect(() => {
    if (status.phase === "idle" || status.phase === "offline" || status.phase === "error") reload()
  }, [reload, status.lastSyncAt, status.phase])

  const returnableOrders = useMemo(
    () => state.snapshot.orders.filter((order) => ["SUBMITTED", "CONFIRMED", "DELIVERED"].includes(order.status)),
    [state.snapshot.orders],
  )

  function alreadyReturned(orderLineId: string): number {
    return state.snapshot.returns
      .filter((item) => item.status !== "REJECTED")
      .flatMap((item) => item.lines)
      .filter((line) => line.orderLineId === orderLineId)
      .reduce((sum, line) => sum + line.quantity, 0)
  }

  function remaining(line: CommercialOrder["lines"][number]): number {
    return Math.max(0, line.quantity - alreadyReturned(line.id))
  }

  function openOrder(order: CommercialOrder) {
    setSelected(order)
    setQuantities({})
    setReason("DAMAGED")
    setNote("")
  }

  function changeQuantity(line: CommercialOrder["lines"][number], delta: number) {
    const current = quantities[line.id] ?? 0
    const next = Math.max(0, Math.min(remaining(line), current + delta))
    setQuantities((values) => ({ ...values, [line.id]: next }))
  }

  const selectedLines = selected?.lines.flatMap((line) => {
    const quantity = quantities[line.id] ?? 0
    return quantity > 0 ? [{ orderLineId: line.id, quantity }] : []
  }) ?? []
  const selectedUnits = selectedLines.reduce((sum, line) => sum + line.quantity, 0)

  function close() {
    if (!busy) setSelected(null)
  }

  async function save() {
    if (!selected || selectedLines.length === 0 || busy) return
    setBusy(true)
    try {
      const attachedVisit = state.activeVisit?.storeId === selected.storeId ? state.activeVisit : null
      enqueueSalesReturn({
        orderId: selected.id,
        visitId: attachedVisit?.id ?? null,
        reason,
        note: note.trim() || null,
        lines: selectedLines,
      })
      setSelected(null)
      Alert.alert(t("commercialSavedOffline"))
      reload()
      try {
        await sync()
      } catch {
        // The request remains visible in the local projection.
      }
      reload()
    } finally {
      setBusy(false)
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
      <CommercialHeader title={t("commercialReturnsTitle")} subtitle={t("commercialReturnsSubtitle")} />
      <SyncBar />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.explainer}>
          <View style={styles.explainerGlyph}><Text style={styles.explainerGlyphText}>↩</Text></View>
          <View style={styles.explainerBody}>
            <Text style={styles.explainerTitle}>{t("commercialReturnsHowTitle")}</Text>
            <Text style={styles.explainerText}>{t("commercialReturnsHowHint")}</Text>
          </View>
        </View>

        <CommercialSection title={t("commercialReturnableOrders")} hint={t("commercialReturnableOrdersHint")}>
          {returnableOrders.length === 0 ? (
            <CommercialEmpty glyph="↩" title={t("commercialReturnsEmpty")} hint={t("commercialReturnsEmptyHint")} />
          ) : (
            <View style={styles.list}>
              {returnableOrders.map((order) => {
                const availableUnits = order.lines.reduce((sum, line) => sum + remaining(line), 0)
                return (
                  <View key={order.id} style={styles.orderCard}>
                    <View style={styles.orderTop}>
                      <View style={styles.orderBody}>
                        <Text style={styles.storeName}>{order.storeName}</Text>
                        <Text style={styles.orderMeta}>{order.invoiceNumber || order.id.slice(-8).toUpperCase()} · {formatShortDateTime(order.createdAt, locale)}</Text>
                      </View>
                      <CommercialPill label={t(`commercialOrderStatus_${order.status}` as MessageKey)} tone={order.status === "DELIVERED" ? "success" : "info"} />
                    </View>
                    <View style={styles.orderMetrics}>
                      <Text style={styles.metric}>{order.lines.length} {t("orderProductKinds")}</Text>
                      <Text style={styles.metric}>{availableUnits} {t("commercialReturnAvailableUnits")}</Text>
                      <Text style={styles.amount}>{money(order.totalAmount, order.currency)}</Text>
                    </View>
                    <CommercialButton
                      label={t("commercialCreateReturn")}
                      disabled={availableUnits <= 0}
                      onPress={() => openOrder(order)}
                    />
                  </View>
                )
              })}
            </View>
          )}
        </CommercialSection>

        {state.snapshot.returns.length > 0 ? (
          <CommercialSection title={t("commercialReturnHistory")}>
            <View style={styles.historyCard}>
              {state.snapshot.returns.map((item) => {
                const order = state.snapshot.orders.find((candidate) => candidate.id === item.orderId)
                const units = item.lines.reduce((sum, line) => sum + line.quantity, 0)
                return (
                  <View key={item.id} style={styles.historyItem}>
                    <View style={styles.historyBody}>
                      <Text style={styles.historyTitle}>{order?.storeName ?? item.storeId}</Text>
                      <Text style={styles.historyMeta}>{reasonLabel(item.reason)} · {units} {t("orderUnits")} · {formatShortDateTime(item.submittedAt, locale)}</Text>
                    </View>
                    <CommercialPill label={returnStatus(item.status)} tone={returnTone(item.status)} />
                  </View>
                )
              })}
            </View>
          </CommercialSection>
        ) : null}
      </ScrollView>

      <Modal visible={Boolean(selected)} transparent animationType="slide" onRequestClose={close}>
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t("commercialCreateReturn")}</Text>
            <Text style={styles.sheetSubtitle}>{selected?.storeName}</Text>
            <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetScrollContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.formTitle}>{t("commercialReturnChooseProducts")}</Text>
              {selected?.lines.map((line) => {
                const max = remaining(line)
                const quantity = quantities[line.id] ?? 0
                return (
                  <View key={line.id} style={[styles.lineRow, max <= 0 && styles.lineDisabled]}>
                    <View style={styles.lineBody}>
                      <Text style={styles.lineName}>{line.productName}</Text>
                      <Text style={styles.lineMeta}>{line.sku} · {t("commercialReturnAvailable", { count: max })}</Text>
                    </View>
                    <View style={styles.stepper}>
                      <Pressable disabled={quantity <= 0} onPress={() => changeQuantity(line, -1)} style={[styles.stepButton, quantity <= 0 && styles.stepDisabled]}><Text style={styles.stepText}>−</Text></Pressable>
                      <Text style={styles.quantity}>{quantity}</Text>
                      <Pressable disabled={quantity >= max} onPress={() => changeQuantity(line, 1)} style={[styles.stepButton, quantity >= max && styles.stepDisabled]}><Text style={styles.stepText}>+</Text></Pressable>
                    </View>
                  </View>
                )
              })}

              <Text style={styles.formTitle}>{t("commercialReturnReason")}</Text>
              <View style={styles.reasons}>
                {REASONS.map((value) => (
                  <Pressable key={value} onPress={() => setReason(value)} style={[styles.reasonChip, reason === value && styles.reasonChipSelected]}>
                    <Text style={[styles.reasonText, reason === value && styles.reasonTextSelected]}>{reasonLabel(value)}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.formTitle}>{t("commercialNoteOptional")}</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                multiline
                maxLength={1000}
                textAlignVertical="top"
                placeholder={t("commercialReturnNotePlaceholder")}
                placeholderTextColor={colors.faint}
                style={styles.textarea}
              />
              <Text style={styles.photoHint}>{t("commercialReturnPhotoHint")}</Text>
            </ScrollView>
            <View style={styles.sheetFooter}>
              <View style={styles.footerButton}><CommercialButton label={t("cancel")} tone="secondary" disabled={busy} onPress={close} /></View>
              <View style={styles.footerButton}><CommercialButton label={`${t("commercialSubmitReturn")} · ${selectedUnits}`} disabled={selectedUnits <= 0 || busy} onPress={() => void save()} /></View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: 34 },
  explainer: { ...commercialCardStyle, marginHorizontal: 14, marginTop: 10, flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: colors.warningBg },
  explainerGlyph: { width: 43, height: 43, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  explainerGlyphText: { color: colors.warning, fontSize: 21, fontWeight: "900" },
  explainerBody: { flex: 1, minWidth: 0 },
  explainerTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  explainerText: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  list: { gap: 10, paddingHorizontal: 14 },
  orderCard: { ...commercialCardStyle, gap: 12 },
  orderTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  orderBody: { flex: 1, minWidth: 0 },
  storeName: { color: colors.text, fontSize: 15, fontWeight: "900" },
  orderMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },
  orderMetrics: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  metric: { color: colors.draft, backgroundColor: colors.draftBg, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: "800" },
  amount: { marginLeft: "auto", color: colors.text, fontSize: 12, fontWeight: "900" },
  historyCard: { marginHorizontal: 14, backgroundColor: colors.card, borderRadius: radii.card, overflow: "hidden" },
  historyItem: { minHeight: 68, paddingHorizontal: 13, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  historyBody: { flex: 1, minWidth: 0 },
  historyTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  historyMeta: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 4 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(17,17,17,0.32)", justifyContent: "flex-end" },
  sheet: { maxHeight: "88%", backgroundColor: colors.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 10 },
  sheetHandle: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: colors.skeletonStrong, marginBottom: 14 },
  sheetTitle: { color: colors.text, fontSize: 20, fontWeight: "900", paddingHorizontal: 18 },
  sheetSubtitle: { color: colors.muted, fontSize: 11, marginTop: 3, paddingHorizontal: 18 },
  sheetScroll: { marginTop: 8 },
  sheetScrollContent: { paddingHorizontal: 18, paddingBottom: 15 },
  formTitle: { color: colors.text, fontSize: 12, fontWeight: "900", marginTop: 14, marginBottom: 8 },
  lineRow: { minHeight: 66, borderRadius: radii.inner, backgroundColor: colors.bg, paddingHorizontal: 11, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 7 },
  lineDisabled: { opacity: 0.45 },
  lineBody: { flex: 1, minWidth: 0 },
  lineName: { color: colors.text, fontSize: 11, fontWeight: "800" },
  lineMeta: { color: colors.muted, fontSize: 9, marginTop: 3 },
  stepper: { minHeight: 42, borderRadius: 13, backgroundColor: colors.card, flexDirection: "row", alignItems: "center" },
  stepButton: { width: 38, height: 42, alignItems: "center", justifyContent: "center" },
  stepDisabled: { opacity: 0.25 },
  stepText: { color: colors.primary, fontSize: 18, fontWeight: "900" },
  quantity: { minWidth: 25, color: colors.text, fontSize: 13, fontWeight: "900", textAlign: "center" },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  reasonChip: { minHeight: 40, borderRadius: radii.pill, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  reasonChipSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  reasonText: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  reasonTextSelected: { color: colors.primary },
  textarea: { minHeight: 82, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, padding: 11, color: colors.text, fontSize: 12, lineHeight: 17 },
  photoHint: { color: colors.faint, fontSize: 10, lineHeight: 14, marginTop: 7 },
  sheetFooter: { flexDirection: "row", gap: 9, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 28, borderTopWidth: 1, borderTopColor: colors.border },
  footerButton: { flex: 1 },
})
