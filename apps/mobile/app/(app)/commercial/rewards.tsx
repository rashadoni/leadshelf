import { useCallback, useEffect, useState } from "react"
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
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
import { enqueueRewardClaim } from "../../../src/db/local-store"
import { SyncBar } from "../../../src/components/SyncBar"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { t, useLocale, type MessageKey } from "../../../src/i18n"
import { useSync } from "../../../src/sync/sync-context"
import { colors, radii } from "../../../src/theme"

type Reward = CommercialMobileState["snapshot"]["rewards"]["catalog"][number]
type Claim = CommercialMobileState["snapshot"]["rewards"]["claims"][number]

function claimStatus(status: Claim["status"]): string {
  return t(`commercialRewardStatus_${status}` as MessageKey)
}

function claimTone(status: Claim["status"]): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "FULFILLED" || status === "APPROVED") return "success"
  if (status === "REJECTED" || status === "CANCELLED") return "danger"
  if (status === "SUBMITTED") return "info"
  return "neutral"
}

export default function RewardsScreen() {
  const locale = useLocale()
  const { status, sync } = useSync()
  const [state, setState] = useState<CommercialMobileState>(() => readCommercialMobileState())
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const reload = useCallback(() => setState(readCommercialMobileState()), [])

  useFocusEffect(reload)
  useEffect(() => {
    if (status.phase === "idle" || status.phase === "offline" || status.phase === "error") reload()
  }, [reload, status.lastSyncAt, status.phase])

  function quantity(reward: Reward): number {
    return quantities[reward.id] ?? 1
  }

  function maxQuantity(reward: Reward): number {
    const affordable = reward.pointsCost === 0 ? 100 : Math.floor(state.snapshot.rewards.balance / reward.pointsCost)
    const stock = reward.stockQuantity ?? 100
    return Math.max(0, Math.min(100, affordable, stock))
  }

  function changeQuantity(reward: Reward, delta: number) {
    const next = Math.max(1, Math.min(maxQuantity(reward), quantity(reward) + delta))
    setQuantities((current) => ({ ...current, [reward.id]: next }))
  }

  function requestClaim(reward: Reward) {
    const selectedQuantity = quantity(reward)
    const total = reward.pointsCost * selectedQuantity
    Alert.alert(
      t("commercialRewardConfirmTitle"),
      t("commercialRewardConfirmBody", { name: reward.name, quantity: selectedQuantity, points: total }),
      [
        { text: t("cancel"), style: "cancel" },
        { text: t("commercialRewardClaim"), onPress: () => void claim(reward) },
      ],
    )
  }

  async function claim(reward: Reward) {
    if (busyId || maxQuantity(reward) < 1) return
    setBusyId(reward.id)
    try {
      enqueueRewardClaim({ rewardItemId: reward.id, quantity: quantity(reward) })
      Alert.alert(t("commercialSavedOffline"))
      reload()
      try {
        await sync()
      } catch {
        // Offline queue is the source of truth until the next sync.
      }
      reload()
    } finally {
      setBusyId(null)
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
      <CommercialHeader title={t("commercialRewardsTitle")} subtitle={t("commercialRewardsSubtitle")} />
      <SyncBar />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.balanceCard}>
          <View style={styles.star}><Text style={styles.starText}>★</Text></View>
          <Text style={styles.balanceLabel}>{t("commercialRewardBalance")}</Text>
          <Text style={styles.balanceValue}>{state.snapshot.rewards.balance}</Text>
          <Text style={styles.balanceUnit}>{t("commercialPointsShort")}</Text>
          {state.pendingCount > 0 ? <CommercialPill label={`${state.pendingCount} ${t("commercialQueuedActions")}`} tone="warning" /> : null}
        </View>

        <CommercialSection title={t("commercialRewardCatalog")} hint={t("commercialRewardCatalogHint")}>
          {state.snapshot.rewards.catalog.length === 0 ? (
            <CommercialEmpty glyph="★" title={t("commercialRewardsEmpty")} hint={t("commercialRewardsEmptyHint")} />
          ) : (
            <View style={styles.list}>
              {state.snapshot.rewards.catalog.map((reward) => {
                const available = maxQuantity(reward)
                const selectedQuantity = quantity(reward)
                const totalCost = reward.pointsCost * selectedQuantity
                return (
                  <View key={reward.id} style={styles.rewardCard}>
                    <View style={styles.rewardTop}>
                      <View style={styles.rewardIcon}><Text style={styles.rewardIconText}>★</Text></View>
                      <View style={styles.rewardBody}>
                        <Text style={styles.rewardName}>{reward.name}</Text>
                        <Text style={styles.rewardCode}>{reward.code}</Text>
                      </View>
                      <View style={styles.costBox}>
                        <Text style={styles.cost}>{reward.pointsCost}</Text>
                        <Text style={styles.costUnit}>{t("commercialPointsShort")}</Text>
                      </View>
                    </View>
                    {reward.description ? <Text style={styles.description}>{reward.description}</Text> : null}
                    <View style={styles.stockRow}>
                      <Text style={styles.stockText}>{reward.stockQuantity == null ? t("commercialRewardStockUnlimited") : t("commercialRewardStock", { count: reward.stockQuantity })}</Text>
                      {available < 1 ? <CommercialPill label={t("commercialRewardUnavailable")} tone="warning" /> : null}
                    </View>
                    <View style={styles.claimRow}>
                      <View style={styles.stepper}>
                        <Pressable disabled={selectedQuantity <= 1} onPress={() => changeQuantity(reward, -1)} style={[styles.stepButton, selectedQuantity <= 1 && styles.stepDisabled]}><Text style={styles.stepText}>−</Text></Pressable>
                        <Text style={styles.quantity}>{selectedQuantity}</Text>
                        <Pressable disabled={selectedQuantity >= available} onPress={() => changeQuantity(reward, 1)} style={[styles.stepButton, selectedQuantity >= available && styles.stepDisabled]}><Text style={styles.stepText}>+</Text></Pressable>
                      </View>
                      <View style={styles.claimButton}>
                        <CommercialButton
                          label={`${t("commercialRewardClaim")} · ${totalCost}`}
                          disabled={available < 1 || busyId !== null}
                          onPress={() => requestClaim(reward)}
                        />
                      </View>
                    </View>
                  </View>
                )
              })}
            </View>
          )}
        </CommercialSection>

        {state.snapshot.rewards.claims.length > 0 ? (
          <CommercialSection title={t("commercialRewardClaims")}>
            <View style={styles.claimsCard}>
              {state.snapshot.rewards.claims.map((claim) => {
                const reward = state.snapshot.rewards.catalog.find((item) => item.id === claim.rewardItemId)
                return (
                  <View key={claim.id} style={styles.claimItem}>
                    <View style={styles.claimItemBody}>
                      <Text style={styles.claimTitle}>{reward?.name ?? claim.rewardItemId}</Text>
                      <Text style={styles.claimMeta}>{claim.quantity} × {claim.pointsCost} · {formatShortDateTime(claim.submittedAt, locale)}</Text>
                    </View>
                    <CommercialPill label={claimStatus(claim.status)} tone={claimTone(claim.status)} />
                  </View>
                )
              })}
            </View>
          </CommercialSection>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: 34 },
  balanceCard: { ...commercialCardStyle, marginHorizontal: 14, marginTop: 10, alignItems: "center", backgroundColor: colors.holidayBg },
  star: { width: 45, height: 45, borderRadius: 15, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  starText: { color: colors.holiday, fontSize: 22 },
  balanceLabel: { color: colors.muted, fontSize: 10, fontWeight: "900", textTransform: "uppercase", marginTop: 10 },
  balanceValue: { color: colors.holiday, fontSize: 40, fontWeight: "900", lineHeight: 45 },
  balanceUnit: { color: colors.muted, fontSize: 11, marginBottom: 10 },
  list: { gap: 10, paddingHorizontal: 14 },
  rewardCard: { ...commercialCardStyle },
  rewardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  rewardIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.holidayBg, alignItems: "center", justifyContent: "center" },
  rewardIconText: { color: colors.holiday, fontSize: 18 },
  rewardBody: { flex: 1, minWidth: 0 },
  rewardName: { color: colors.text, fontSize: 15, fontWeight: "900" },
  rewardCode: { color: colors.muted, fontSize: 9, marginTop: 3 },
  costBox: { alignItems: "flex-end" },
  cost: { color: colors.holiday, fontSize: 20, fontWeight: "900" },
  costUnit: { color: colors.muted, fontSize: 9 },
  description: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 11 },
  stockRow: { minHeight: 35, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  stockText: { color: colors.faint, fontSize: 10 },
  claimRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 4, flexDirection: "row", gap: 10, alignItems: "center" },
  stepper: { minHeight: 46, borderRadius: 15, backgroundColor: colors.bg, flexDirection: "row", alignItems: "center" },
  stepButton: { width: 42, height: 46, alignItems: "center", justifyContent: "center" },
  stepDisabled: { opacity: 0.3 },
  stepText: { color: colors.primary, fontSize: 19, fontWeight: "900" },
  quantity: { minWidth: 28, color: colors.text, fontSize: 14, fontWeight: "900", textAlign: "center" },
  claimButton: { flex: 1 },
  claimsCard: { marginHorizontal: 14, backgroundColor: colors.card, borderRadius: radii.card, overflow: "hidden" },
  claimItem: { minHeight: 67, paddingHorizontal: 13, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  claimItemBody: { flex: 1, minWidth: 0 },
  claimTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  claimMeta: { color: colors.muted, fontSize: 9, marginTop: 4 },
})
