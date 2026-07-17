import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router, useFocusEffect } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { SyncBar } from "../../../src/components/SyncBar"
import {
  listCommercialMediaRecoveryQueue,
  type CommercialMediaRecoveryRow,
} from "../../../src/db/local-store"
import {
  activePromotionCount,
  commercialOrderTotal,
  readCommercialMobileState,
  type CommercialMobileState,
} from "../../../src/commercial/mobile-state"
import { t, useLocale } from "../../../src/i18n"
import { useSync } from "../../../src/sync/sync-context"
import { colors, cardShadow, radii } from "../../../src/theme"

type CommercialModule = {
  key: "orders" | "promotions" | "inventory" | "returns" | "rewards"
  title: string
  hint: string
  value: string
  glyph: string
  href: string
  tint: string
  tintSoft: string
}

function money(value: number, currency = "AZN"): string {
  return `${value.toFixed(2)} ${currency}`
}

export default function CommercialHomeScreen() {
  useLocale()
  const { status, sync } = useSync()
  const [state, setState] = useState<CommercialMobileState>(() => readCommercialMobileState())
  const [mediaQueue, setMediaQueue] = useState<CommercialMediaRecoveryRow[]>(() => listCommercialMediaRecoveryQueue())
  const [refreshing, setRefreshing] = useState(false)
  const reload = useCallback(() => {
    setState(readCommercialMobileState())
    setMediaQueue(listCommercialMediaRecoveryQueue())
  }, [])

  useFocusEffect(reload)
  useEffect(() => {
    if (status.phase === "idle" || status.phase === "offline" || status.phase === "error") reload()
  }, [reload, status.lastSyncAt, status.phase])

  const modules = useMemo<CommercialModule[]>(() => {
    const currency = state.snapshot.orders[0]?.currency ?? "AZN"
    const inventoryBalance = state.snapshot.inventory.items.reduce((sum, item) => sum + item.balance, 0)
    return [
      {
        key: "orders",
        title: t("commercialOrdersTitle"),
        hint: t("commercialOrdersHint"),
        value: `${state.snapshot.orders.length + state.queuedOrders.length} · ${money(commercialOrderTotal(state), currency)}`,
        glyph: "▤",
        href: "/(app)/(tabs)/orders",
        tint: colors.successDark,
        tintSoft: colors.successBg,
      },
      {
        key: "promotions",
        title: t("commercialPromotionsTitle"),
        hint: t("commercialPromotionsHint"),
        value: String(activePromotionCount(state)),
        glyph: "%",
        href: "/(app)/commercial/promotions",
        tint: colors.primary,
        tintSoft: colors.primarySoft,
      },
      {
        key: "inventory",
        title: t("commercialInventoryTitle"),
        hint: t("commercialInventoryHint"),
        value: `${inventoryBalance} ${t("commercialUnitsShort")}`,
        glyph: "▦",
        href: "/(app)/commercial/inventory",
        tint: colors.info,
        tintSoft: colors.infoBg,
      },
      {
        key: "returns",
        title: t("commercialReturnsTitle"),
        hint: t("commercialReturnsHint"),
        value: String(state.snapshot.returns.length),
        glyph: "↩",
        href: "/(app)/commercial/returns",
        tint: colors.warning,
        tintSoft: colors.warningBg,
      },
      {
        key: "rewards",
        title: t("commercialRewardsTitle"),
        hint: t("commercialRewardsHint"),
        value: `${state.snapshot.rewards.balance} ${t("commercialPointsShort")}`,
        glyph: "★",
        href: "/(app)/commercial/rewards",
        tint: colors.holiday,
        tintSoft: colors.holidayBg,
      },
    ]
  }, [state])

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
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <View style={styles.topbarText}>
          <Text style={styles.eyebrow}>{t("tabWork").toUpperCase()}</Text>
          <Text style={styles.title}>{t("commercialCenterTitle")}</Text>
        </View>
      </View>
      <SyncBar />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={styles.scroll}
      >
        <View style={[styles.visitCard, state.activeVisit ? styles.visitActive : styles.visitMissing]}>
          <View style={[styles.visitDot, { backgroundColor: state.activeVisit ? colors.success : colors.warning }]} />
          <View style={styles.visitBody}>
            <Text style={styles.visitLabel}>
              {state.activeVisit ? t("commercialActiveVisit") : t("commercialNoActiveVisit")}
            </Text>
            <Text style={styles.visitName} numberOfLines={1}>
              {state.activeStore?.name ?? (state.activeVisit ? state.activeVisit.storeId : t("commercialStartVisitHint"))}
            </Text>
          </View>
        </View>

        {(state.pendingCount > 0 || state.attentionCount > 0) ? (
          <View style={styles.queueCard}>
            <View style={styles.queueMetric}>
              <Text style={styles.queueValue}>{state.pendingCount}</Text>
              <Text style={styles.queueLabel}>{t("commercialQueuedActions")}</Text>
            </View>
            <View style={styles.queueDivider} />
            <View style={styles.queueMetric}>
              <Text style={[styles.queueValue, state.attentionCount > 0 && styles.attentionValue]}>{state.attentionCount}</Text>
              <Text style={styles.queueLabel}>{t("commercialNeedsAttention")}</Text>
            </View>
          </View>
        ) : null}

        {mediaQueue.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(app)/commercial/media-queue" as never)}
            style={({ pressed }) => [
              styles.mediaQueueCard,
              mediaQueue.some((row) => row.status === "quarantined") && styles.mediaQueueAttention,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.mediaQueueGlyph}><Text style={styles.mediaQueueGlyphText}>⌾</Text></View>
            <View style={styles.mediaQueueBody}>
              <Text style={styles.mediaQueueTitle}>{t("commercialMediaQueueTitle")}</Text>
              <Text style={styles.mediaQueueHint}>{t("commercialMediaQueueHint", { count: mediaQueue.length })}</Text>
            </View>
            <View style={styles.mediaQueueMeta}>
              <Text style={styles.mediaQueueCount}>{mediaQueue.length}</Text>
              <Text style={styles.mediaQueueArrow}>›</Text>
            </View>
          </Pressable>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("commercialActionsTitle")}</Text>
          <Text style={styles.sectionHint}>{t("commercialActionsHint")}</Text>
        </View>

        <View style={styles.modules}>
          {modules.map((module) => (
            <Pressable
              key={module.key}
              accessibilityRole="button"
              onPress={() => router.push(module.href as never)}
              style={({ pressed }) => [styles.moduleCard, pressed && styles.pressed]}
            >
              <View style={[styles.moduleGlyph, { backgroundColor: module.tintSoft }]}>
                <Text style={[styles.moduleGlyphText, { color: module.tint }]}>{module.glyph}</Text>
              </View>
              <View style={styles.moduleBody}>
                <Text style={styles.moduleTitle}>{module.title}</Text>
                <Text style={styles.moduleHint} numberOfLines={2}>{module.hint}</Text>
              </View>
              <View style={styles.moduleMeta}>
                <Text style={[styles.moduleValue, { color: module.tint }]}>{module.value}</Text>
                <Text style={[styles.moduleArrow, { color: module.tint }]}>›</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <Text style={styles.offlineHint}>{t("commercialOfflineHint")}</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topbar: { minHeight: 76, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  backButton: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", ...cardShadow },
  backGlyph: { color: colors.text, fontSize: 32, fontWeight: "500", lineHeight: 34, marginTop: -2 },
  topbarText: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  title: { color: colors.text, fontSize: 25, fontWeight: "900", letterSpacing: -0.5, marginTop: 2 },
  scroll: { paddingBottom: 30 },
  visitCard: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, padding: 15, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1 },
  visitActive: { backgroundColor: colors.successBg, borderColor: colors.successBorder },
  visitMissing: { backgroundColor: colors.warningBg, borderColor: colors.warningBg },
  visitDot: { width: 10, height: 10, borderRadius: 5 },
  visitBody: { flex: 1, minWidth: 0 },
  visitLabel: { color: colors.muted, fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 },
  visitName: { color: colors.text, fontSize: 14, fontWeight: "900", marginTop: 3 },
  queueCard: { marginHorizontal: 14, marginTop: 10, paddingVertical: 13, borderRadius: radii.card, backgroundColor: colors.card, flexDirection: "row", ...cardShadow },
  queueMetric: { flex: 1, alignItems: "center", paddingHorizontal: 10 },
  queueValue: { color: colors.warning, fontSize: 22, fontWeight: "900" },
  attentionValue: { color: colors.danger },
  queueLabel: { color: colors.muted, fontSize: 10, fontWeight: "700", textAlign: "center", marginTop: 2 },
  queueDivider: { width: 1, backgroundColor: colors.border },
  mediaQueueCard: { marginHorizontal: 14, marginTop: 10, minHeight: 78, padding: 13, borderRadius: radii.card, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.warningBg, flexDirection: "row", alignItems: "center", gap: 11 },
  mediaQueueAttention: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
  mediaQueueGlyph: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  mediaQueueGlyphText: { color: colors.warning, fontSize: 22, fontWeight: "900" },
  mediaQueueBody: { flex: 1, minWidth: 0 },
  mediaQueueTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  mediaQueueHint: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  mediaQueueMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  mediaQueueCount: { color: colors.warning, fontSize: 18, fontWeight: "900" },
  mediaQueueArrow: { color: colors.warning, fontSize: 25, fontWeight: "700" },
  sectionHeader: { paddingHorizontal: 18, marginTop: 24, marginBottom: 10 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  sectionHint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  modules: { gap: 10, paddingHorizontal: 14 },
  moduleCard: { minHeight: 92, borderRadius: radii.card, backgroundColor: colors.card, padding: 13, flexDirection: "row", alignItems: "center", gap: 12, ...cardShadow },
  moduleGlyph: { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  moduleGlyphText: { fontSize: 21, fontWeight: "900" },
  moduleBody: { flex: 1, minWidth: 0 },
  moduleTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  moduleHint: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  moduleMeta: { minWidth: 62, alignItems: "flex-end", justifyContent: "center" },
  moduleValue: { fontSize: 12, fontWeight: "900", textAlign: "right" },
  moduleArrow: { fontSize: 25, fontWeight: "600", lineHeight: 26, marginTop: 2 },
  offlineHint: { color: colors.faint, fontSize: 11, lineHeight: 16, textAlign: "center", marginHorizontal: 28, marginTop: 18 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
})
