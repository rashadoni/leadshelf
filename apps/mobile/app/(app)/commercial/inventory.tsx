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
  CommercialVisitContext,
  commercialCardStyle,
} from "../../../src/commercial/ui"
import { readCommercialMobileState, type CommercialMobileState } from "../../../src/commercial/mobile-state"
import { enqueuePromoInventoryRecord } from "../../../src/db/local-store"
import { SyncBar } from "../../../src/components/SyncBar"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { t, useLocale, type MessageKey } from "../../../src/i18n"
import { useSync } from "../../../src/sync/sync-context"
import { colors, radii } from "../../../src/theme"

type InventoryItem = CommercialMobileState["snapshot"]["inventory"]["items"][number]
type InventoryEvent = CommercialMobileState["snapshot"]["inventory"]["events"][number]
type EventType = InventoryEvent["eventType"]

const EVENT_TYPES: EventType[] = ["ISSUE", "RECEIVE", "RETURN", "COUNT_ADJUSTMENT"]

function eventLabel(value: EventType): string {
  return t(`commercialInventoryEvent_${value}` as MessageKey)
}

function parseAmount(value: string): number | null {
  const parsed = Number(value.trim().replace(",", "."))
  return Number.isFinite(parsed) ? parsed : null
}

export default function InventoryScreen() {
  const locale = useLocale()
  const { status, sync } = useSync()
  const [state, setState] = useState<CommercialMobileState>(() => readCommercialMobileState())
  const [selected, setSelected] = useState<InventoryItem | null>(null)
  const [eventType, setEventType] = useState<EventType>("ISSUE")
  const [amount, setAmount] = useState("1")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const reload = useCallback(() => setState(readCommercialMobileState()), [])

  useFocusEffect(reload)
  useEffect(() => {
    if (status.phase === "idle" || status.phase === "offline" || status.phase === "error") reload()
  }, [reload, status.lastSyncAt, status.phase])

  const inventoryTotal = useMemo(
    () => state.snapshot.inventory.items.reduce((sum, item) => sum + item.balance, 0),
    [state.snapshot.inventory.items],
  )
  const parsedAmount = parseAmount(amount)
  const needsVisit = eventType === "ISSUE"
  const amountValid = eventType === "COUNT_ADJUSTMENT"
    ? parsedAmount !== null && parsedAmount >= 0
    : parsedAmount !== null && parsedAmount > 0 && (
      eventType === "RECEIVE" || (selected ? parsedAmount <= selected.balance : false)
    )
  const canSave = Boolean(selected && amountValid && (!needsVisit || state.activeVisit) && !busy)

  function openAction(item: InventoryItem, type: EventType) {
    setSelected(item)
    setEventType(type)
    setAmount(type === "COUNT_ADJUSTMENT" ? String(item.balance) : "1")
    setNote("")
  }

  function closeAction() {
    if (busy) return
    setSelected(null)
  }

  async function save() {
    if (!selected || !canSave || parsedAmount === null) return
    setBusy(true)
    try {
      enqueuePromoInventoryRecord({
        itemId: selected.id,
        eventType,
        ...(eventType === "COUNT_ADJUSTMENT" ? { countedBalance: parsedAmount } : { quantity: parsedAmount }),
        storeId: state.activeVisit?.storeId ?? null,
        visitId: state.activeVisit?.id ?? null,
        note: note.trim() || null,
        recordedAt: new Date().toISOString(),
      })
      setSelected(null)
      Alert.alert(t("commercialSavedOffline"))
      reload()
      try {
        await sync()
      } catch {
        // The action remains in the durable outbox.
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
      <CommercialHeader title={t("commercialInventoryTitle")} subtitle={t("commercialInventorySubtitle")} />
      <SyncBar />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={styles.scroll}
      >
        <CommercialVisitContext
          active={Boolean(state.activeVisit)}
          storeName={state.activeStore?.name ?? null}
          activeLabel={t("commercialInventoryVisitAttached")}
          missingLabel={t("commercialInventoryVisitOptional")}
        />

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>{t("commercialInventoryTotal")}</Text>
          <Text style={styles.heroValue}>{inventoryTotal}</Text>
          <Text style={styles.heroUnit}>{t("commercialUnitsShort")}</Text>
          {state.pendingCount > 0 ? <CommercialPill label={`${state.pendingCount} ${t("commercialQueuedActions")}`} tone="warning" /> : null}
        </View>

        <CommercialSection title={t("commercialInventoryItems")} hint={t("commercialInventoryItemsHint")}>
          {state.snapshot.inventory.items.length === 0 ? (
            <CommercialEmpty glyph="▦" title={t("commercialInventoryEmpty")} hint={t("commercialInventoryEmptyHint")} />
          ) : (
            <View style={styles.list}>
              {state.snapshot.inventory.items.map((item) => (
                <View key={item.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={styles.itemBody}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemMeta}>{item.code} · {item.kind === "SAMPLE" ? t("commercialInventorySample") : t("commercialInventoryMaterial")}</Text>
                    </View>
                    <View style={styles.balanceBox}>
                      <Text style={styles.balance}>{item.balance}</Text>
                      <Text style={styles.balanceUnit}>{item.unit}</Text>
                    </View>
                  </View>
                  <View style={styles.actions}>
                    <InventoryAction label={t("commercialInventoryIssue")} glyph="−" onPress={() => openAction(item, "ISSUE")} />
                    <InventoryAction label={t("commercialInventoryReceive")} glyph="+" onPress={() => openAction(item, "RECEIVE")} />
                    <InventoryAction label={t("commercialInventoryCount")} glyph="≡" onPress={() => openAction(item, "COUNT_ADJUSTMENT")} />
                    <InventoryAction label={t("commercialInventoryReturn")} glyph="↩" onPress={() => openAction(item, "RETURN")} />
                  </View>
                </View>
              ))}
            </View>
          )}
        </CommercialSection>

        {state.snapshot.inventory.events.length > 0 ? (
          <CommercialSection title={t("commercialInventoryHistory")}>
            <View style={styles.historyList}>
              {state.snapshot.inventory.events.slice(0, 12).map((event) => {
                const item = state.snapshot.inventory.items.find((candidate) => candidate.id === event.itemId)
                return (
                  <View key={event.id} style={styles.historyRow}>
                    <View style={[styles.eventMark, { backgroundColor: event.quantityDelta >= 0 ? colors.successBg : colors.warningBg }]}>
                      <Text style={[styles.eventMarkText, { color: event.quantityDelta >= 0 ? colors.successDark : colors.warning }]}>
                        {event.quantityDelta >= 0 ? "+" : "−"}
                      </Text>
                    </View>
                    <View style={styles.historyBody}>
                      <Text style={styles.historyTitle}>{item?.name ?? event.itemId}</Text>
                      <Text style={styles.historyMeta}>{eventLabel(event.eventType)} · {formatShortDateTime(event.recordedAt, locale)}</Text>
                    </View>
                    <Text style={styles.historyDelta}>{event.quantityDelta > 0 ? "+" : ""}{event.quantityDelta}</Text>
                  </View>
                )
              })}
            </View>
          </CommercialSection>
        ) : null}
      </ScrollView>

      <Modal visible={Boolean(selected)} transparent animationType="slide" onRequestClose={closeAction}>
        <Pressable style={styles.modalBackdrop} onPress={closeAction}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{selected?.name}</Text>
            <Text style={styles.sheetSubtitle}>{t("commercialInventoryChooseAction")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventChips}>
              {EVENT_TYPES.map((type) => (
                <Pressable
                  key={type}
                  onPress={() => {
                    setEventType(type)
                    setAmount(type === "COUNT_ADJUSTMENT" ? String(selected?.balance ?? 0) : "1")
                  }}
                  style={[styles.eventChip, eventType === type && styles.eventChipSelected]}
                >
                  <Text style={[styles.eventChipText, eventType === type && styles.eventChipTextSelected]}>{eventLabel(type)}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.inputLabel}>{eventType === "COUNT_ADJUSTMENT" ? t("commercialInventoryCountedBalance") : t("commercialInventoryQuantity")}</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.faint}
              style={[styles.input, !amountValid && amount.length > 0 && styles.inputInvalid]}
            />
            {!amountValid && amount.length > 0 ? <Text style={styles.errorText}>{t("commercialInventoryInvalidAmount")}</Text> : null}
            {needsVisit && !state.activeVisit ? <Text style={styles.errorText}>{t("commercialInventoryIssueNeedsVisit")}</Text> : null}
            <Text style={styles.inputLabel}>{t("commercialNoteOptional")}</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              multiline
              textAlignVertical="top"
              maxLength={1000}
              placeholder={t("commercialInventoryNotePlaceholder")}
              placeholderTextColor={colors.faint}
              style={[styles.input, styles.textarea]}
            />
            <View style={styles.sheetButtons}>
              <View style={styles.sheetButton}><CommercialButton label={t("cancel")} tone="secondary" disabled={busy} onPress={closeAction} /></View>
              <View style={styles.sheetButton}><CommercialButton label={t("commercialSaveAction")} disabled={!canSave} onPress={() => void save()} /></View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

function InventoryAction({ label, glyph, onPress }: { label: string; glyph: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Text style={styles.actionGlyph}>{glyph}</Text>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: 34 },
  hero: { ...commercialCardStyle, marginHorizontal: 14, marginTop: 10, alignItems: "center" },
  heroLabel: { color: colors.muted, fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 },
  heroValue: { color: colors.text, fontSize: 38, fontWeight: "900", lineHeight: 43, marginTop: 3 },
  heroUnit: { color: colors.muted, fontSize: 11, marginBottom: 10 },
  list: { gap: 10, paddingHorizontal: 14 },
  card: { ...commercialCardStyle },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  itemBody: { flex: 1, minWidth: 0 },
  itemName: { color: colors.text, fontSize: 15, fontWeight: "900" },
  itemMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  balanceBox: { minWidth: 62, alignItems: "flex-end" },
  balance: { color: colors.primary, fontSize: 24, fontWeight: "900" },
  balanceUnit: { color: colors.muted, fontSize: 9, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  action: { minHeight: 44, flexGrow: 1, flexBasis: "42%", borderRadius: radii.inner, backgroundColor: colors.bg, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  actionGlyph: { color: colors.primary, fontSize: 17, fontWeight: "900" },
  actionText: { color: colors.text, fontSize: 10, fontWeight: "800" },
  pressed: { opacity: 0.65 },
  historyList: { marginHorizontal: 14, borderRadius: radii.card, backgroundColor: colors.card, overflow: "hidden" },
  historyRow: { minHeight: 64, paddingHorizontal: 13, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  eventMark: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  eventMarkText: { fontSize: 17, fontWeight: "900" },
  historyBody: { flex: 1, minWidth: 0 },
  historyTitle: { color: colors.text, fontSize: 12, fontWeight: "800" },
  historyMeta: { color: colors.muted, fontSize: 9, marginTop: 3 },
  historyDelta: { color: colors.text, fontSize: 14, fontWeight: "900" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(17,17,17,0.32)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28 },
  sheetHandle: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: colors.skeletonStrong, marginBottom: 15 },
  sheetTitle: { color: colors.text, fontSize: 20, fontWeight: "900" },
  sheetSubtitle: { color: colors.muted, fontSize: 11, marginTop: 3 },
  eventChips: { gap: 7, paddingVertical: 14 },
  eventChip: { minHeight: 40, borderRadius: radii.pill, paddingHorizontal: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  eventChipSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  eventChipText: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  eventChipTextSelected: { color: colors.primary },
  inputLabel: { color: colors.text, fontSize: 11, fontWeight: "900", marginTop: 9, marginBottom: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, borderRadius: radii.inner, paddingHorizontal: 12, color: colors.text, fontSize: 14 },
  inputInvalid: { borderColor: colors.danger },
  textarea: { minHeight: 76, paddingTop: 11 },
  errorText: { color: colors.dangerPressed, fontSize: 10, lineHeight: 14, marginTop: 5 },
  sheetButtons: { flexDirection: "row", gap: 9, marginTop: 16 },
  sheetButton: { flex: 1 },
})
