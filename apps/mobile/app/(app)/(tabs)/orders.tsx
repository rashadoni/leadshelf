// Вкладка «Заказы»: локальная история order.create и прозрачный sync-статус.
import { useCallback, useEffect, useMemo, useState } from "react"
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect } from "expo-router"
import { SyncBar } from "../../../src/components/SyncBar"
import {
  getStore,
  listLocalCatalogProducts,
  listQueuedOrders,
  listVisits,
  type QueuedOrderRow,
} from "../../../src/db/local-store"
import type { VisitRow } from "../../../src/sync/ports"
import { useSync } from "../../../src/sync/sync-context"
import { t, useLocale } from "../../../src/i18n"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { colors, cardShadow, radii } from "../../../src/theme"
import { TabIcon } from "../../../src/components/TabIcon"

function issueMessage(code: string | null): string {
  switch (code) {
    case "store_not_found": return t("orderIssueStoreNotFound")
    case "visit_not_found": return t("orderIssueVisitNotFound")
    case "visit_store_mismatch": return t("orderIssueVisitStoreMismatch")
    case "product_not_found": return t("orderIssueProductNotFound")
    case "product_price_missing": return t("orderIssueProductPriceMissing")
    case "credit_limit_exceeded": return t("orderIssueCreditLimitExceeded")
    case "credit_account_blocked": return t("orderIssueCreditAccountBlocked")
    default: return t("orderIssueUnknown")
  }
}

function shortReference(clientOpId: string): string {
  return clientOpId.replace(/^op-/, "").slice(-8).toUpperCase()
}

export default function OrdersTab() {
  const locale = useLocale()
  const { status, sync } = useSync()
  const [orders, setOrders] = useState<QueuedOrderRow[]>([])
  const [activeVisit, setActiveVisit] = useState<VisitRow | null>(null)
  const [productNames, setProductNames] = useState<Record<string, string>>({})
  const [refreshing, setRefreshing] = useState(false)

  const reload = useCallback(() => {
    setOrders(listQueuedOrders())
    setActiveVisit(listVisits().find((visit) => visit.status === "IN_PROGRESS") ?? null)
    setProductNames(Object.fromEntries(listLocalCatalogProducts().map((product) => [product.id, product.name])))
  }, [])
  useFocusEffect(reload)

  useEffect(() => {
    if (status.phase !== "idle") return
    reload()
  }, [reload, status.lastSyncAt, status.phase])

  async function onRefresh() {
    setRefreshing(true)
    try {
      await sync()
      reload()
    } finally {
      setRefreshing(false)
    }
  }

  function editOrder(item: QueuedOrderRow) {
    if (!activeVisit || activeVisit.storeId !== item.storeId) return
    const query = [
      `storeId=${encodeURIComponent(item.storeId)}`,
      `visitId=${encodeURIComponent(activeVisit.id)}`,
      `sourceOpId=${encodeURIComponent(item.clientOpId)}`,
    ].join("&")
    router.push(`/(app)/order-create?${query}` as never)
  }

  const hasOrders = orders.length > 0
  const listStyle = useMemo(() => (hasOrders ? styles.list : styles.emptyWrap), [hasOrders])

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("tabOrders")}</Text>
      </View>
      <SyncBar />
      <FlatList
        data={orders}
        keyExtractor={(item) => item.clientOpId}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={listStyle}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <TabIcon name="orders" color={colors.primary} size={30} />
            </View>
            <Text style={styles.emptyTitle}>{t("ordersEmpty")}</Text>
            <Text style={styles.emptyHint}>{t("ordersEmptyHint")}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const store = getStore(item.storeId)
          const statusKey = item.status === "pending"
            ? "orderQueued"
            : item.status === "rejected"
              ? "orderRejected"
              : item.status === "conflict"
                ? "orderConflict"
                : "orderSynced"
          const failed = item.status === "rejected" || item.status === "conflict"
          const canEdit = failed && activeVisit?.storeId === item.storeId
          const previewNames = item.lines
            .slice(0, 2)
            .map((line) => productNames[line.productId] ?? line.productId)
            .join(", ")
          const remainingProducts = Math.max(0, item.lineCount - 2)

          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderBody}>
                  <Text style={styles.storeName} numberOfLines={1}>{store?.name ?? item.storeId}</Text>
                  <Text style={styles.reference}>
                    {t("orderReference")} · {shortReference(item.clientOpId)}
                  </Text>
                </View>
                <View style={[
                  styles.statusPill,
                  item.status === "pending"
                    ? styles.statusPending
                    : failed ? styles.statusFailed : styles.statusDone,
                ]}>
                  <Text style={[
                    styles.statusText,
                    item.status === "pending"
                      ? styles.statusTextPending
                      : failed ? styles.statusTextFailed : styles.statusTextDone,
                  ]}>{t(statusKey)}</Text>
                </View>
              </View>

              <Text style={styles.createdAt}>{formatShortDateTime(item.clientCreatedAt, locale)}</Text>
              {previewNames ? (
                <Text style={styles.productPreview} numberOfLines={2}>
                  {previewNames}{remainingProducts > 0 ? ` · +${remainingProducts}` : ""}
                </Text>
              ) : null}

              <View style={styles.metrics}>
                <View style={styles.metricPill}>
                  <Text style={styles.metricText}>{item.lineCount} {t("orderProductKinds")}</Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricText}>{item.unitCount} {t("orderUnits")}</Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricText}>{item.visitId ? t("orderFromVisit") : t("orderDirect")}</Text>
                </View>
              </View>

              {failed ? (
                <View style={styles.issueBlock}>
                  <Text style={styles.issueLabel}>{t("orderIssueReason")}</Text>
                  <Text style={styles.issueText}>{issueMessage(item.detailCode)}</Text>
                  {canEdit ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => editOrder(item)}
                      style={({ pressed }) => [styles.editButton, pressed && styles.editPressed]}
                    >
                      <Text style={styles.editButtonText}>{t("editOrder")}</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.editHint}>{t("editOrderUnavailable")}</Text>
                  )}
                </View>
              ) : null}
            </View>
          )
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text },
  list: { paddingBottom: 24 },
  emptyWrap: { flexGrow: 1, justifyContent: "center" },
  emptyCard: { alignItems: "center", gap: 6, paddingHorizontal: 24 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: colors.text },
  emptyHint: { fontSize: 13, color: colors.faint, textAlign: "center" },
  card: {
    backgroundColor: colors.card,
    marginHorizontal: 14,
    marginTop: 12,
    padding: 16,
    borderRadius: radii.card,
    ...cardShadow,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardHeaderBody: { flex: 1, minWidth: 0 },
  storeName: { fontSize: 16, fontWeight: "800", color: colors.text },
  reference: { fontSize: 11, color: colors.muted, marginTop: 3 },
  createdAt: { fontSize: 12, color: colors.faint, marginTop: 9 },
  productPreview: { color: colors.text, fontSize: 13, lineHeight: 18, marginTop: 8 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  metricPill: { borderRadius: radii.pill, backgroundColor: colors.bg, paddingHorizontal: 9, paddingVertical: 5 },
  metricText: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  statusPill: { borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  statusPending: { backgroundColor: colors.warningBg },
  statusDone: { backgroundColor: colors.successBg },
  statusFailed: { backgroundColor: colors.dangerBg },
  statusText: { fontSize: 10, fontWeight: "800" },
  statusTextPending: { color: colors.warning },
  statusTextDone: { color: colors.successDark },
  statusTextFailed: { color: colors.dangerPressed },
  issueBlock: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 14,
    paddingTop: 12,
  },
  issueLabel: { color: colors.dangerPressed, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  issueText: { color: colors.text, fontSize: 12, lineHeight: 17, marginTop: 3 },
  editButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    marginTop: 10,
    paddingHorizontal: 16,
  },
  editPressed: { backgroundColor: colors.primaryPressed },
  editButtonText: { color: colors.headerText, fontSize: 12, fontWeight: "800" },
  editHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
})
