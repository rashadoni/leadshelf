import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router, useFocusEffect } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  CommercialButton,
  CommercialEmpty,
  CommercialPill,
  CommercialSection,
  CommercialVisitContext,
  commercialCardStyle,
} from "../../../src/commercial/ui"
import { readCommercialMobileState, type CommercialMobileState } from "../../../src/commercial/mobile-state"
import { getStore, listLocalCatalogProducts, type QueuedOrderRow } from "../../../src/db/local-store"
import { SyncBar } from "../../../src/components/SyncBar"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { t, useLocale, type MessageKey } from "../../../src/i18n"
import { useSync } from "../../../src/sync/sync-context"
import { colors, radii } from "../../../src/theme"

type ServerOrder = CommercialMobileState["snapshot"]["orders"][number]

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

function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`
}

export default function OrdersTab() {
  const locale = useLocale()
  const { status, sync } = useSync()
  const [state, setState] = useState<CommercialMobileState>(() => readCommercialMobileState())
  const [productNames, setProductNames] = useState<Record<string, string>>({})
  const [refreshing, setRefreshing] = useState(false)
  const reload = useCallback(() => {
    setState(readCommercialMobileState())
    setProductNames(Object.fromEntries(listLocalCatalogProducts().map((product) => [product.id, product.name])))
  }, [])

  useFocusEffect(reload)
  useEffect(() => {
    if (status.phase === "idle" || status.phase === "offline" || status.phase === "error") reload()
  }, [reload, status.lastSyncAt, status.phase])

  const visibleLocalOrders = useMemo(() => {
    const serverIds = new Set(state.snapshot.orders.map((order) => order.id))
    return state.queuedOrders.filter((order) => !order.serverOrderId || !serverIds.has(order.serverOrderId))
  }, [state.queuedOrders, state.snapshot.orders])
  const total = state.snapshot.orders.reduce((sum, order) => sum + order.totalAmount, 0)
  const currency = state.snapshot.orders[0]?.currency ?? "AZN"
  const hasOrders = state.snapshot.orders.length > 0 || visibleLocalOrders.length > 0

  async function onRefresh() {
    setRefreshing(true)
    try {
      await sync()
    } finally {
      reload()
      setRefreshing(false)
    }
  }

  function createOrder() {
    if (!state.activeVisit) return
    router.push(`/(app)/order-create?storeId=${encodeURIComponent(state.activeVisit.storeId)}&visitId=${encodeURIComponent(state.activeVisit.id)}` as never)
  }

  function editOrder(item: QueuedOrderRow) {
    if (!state.activeVisit || state.activeVisit.storeId !== item.storeId) return
    const query = [
      `storeId=${encodeURIComponent(item.storeId)}`,
      `visitId=${encodeURIComponent(state.activeVisit.id)}`,
      `sourceOpId=${encodeURIComponent(item.clientOpId)}`,
    ].join("&")
    router.push(`/(app)/order-create?${query}` as never)
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}><Text style={styles.backGlyph}>‹</Text></Pressable>
        <View style={styles.headerBody}>
          <Text style={styles.title}>{t("tabOrders")}</Text>
          <Text style={styles.subtitle}>{t("ordersSubtitle")}</Text>
        </View>
      </View>
      <SyncBar />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.scroll}
      >
        <CommercialVisitContext
          active={Boolean(state.activeVisit)}
          storeName={state.activeStore?.name ?? null}
          activeLabel={t("commercialActiveVisit")}
          missingLabel={t("orderCreateNeedsVisit")}
        />
        <View style={styles.createWrap}>
          <CommercialButton label={t("createOrder")} disabled={!state.activeVisit} onPress={createOrder} />
        </View>

        <View style={styles.summary}>
          <View style={styles.summaryMetric}><Text style={styles.summaryValue}>{state.snapshot.orders.length}</Text><Text style={styles.summaryLabel}>{t("ordersServerCount")}</Text></View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryMetric}><Text style={styles.summaryValue}>{visibleLocalOrders.length}</Text><Text style={styles.summaryLabel}>{t("commercialQueuedActions")}</Text></View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryMetric}><Text style={styles.summaryAmount}>{money(total, currency)}</Text><Text style={styles.summaryLabel}>{t("ordersTotalAmount")}</Text></View>
        </View>

        {!hasOrders ? (
          <View style={styles.emptyWrap}><CommercialEmpty glyph="▤" title={t("ordersEmpty")} hint={t("ordersEmptyHint")} /></View>
        ) : null}

        {state.snapshot.orders.length > 0 ? (
          <CommercialSection title={t("ordersServerSection")} hint={t("ordersServerSectionHint")}>
            <View style={styles.list}>
              {state.snapshot.orders.map((order) => <ServerOrderCard key={order.id} order={order} locale={locale} />)}
            </View>
          </CommercialSection>
        ) : null}

        {visibleLocalOrders.length > 0 ? (
          <CommercialSection title={t("ordersLocalSection")} hint={t("ordersLocalSectionHint")}>
            <View style={styles.list}>
              {visibleLocalOrders.map((item) => {
                const store = getStore(item.storeId)
                const failed = item.status === "rejected" || item.status === "conflict"
                const canEdit = failed && state.activeVisit?.storeId === item.storeId
                const statusKey = item.status === "pending"
                  ? "orderQueued"
                  : item.status === "rejected"
                    ? "orderRejected"
                    : item.status === "conflict"
                      ? "orderConflict"
                      : "orderSynced"
                const previewNames = item.lines.slice(0, 2).map((line) => productNames[line.productId] ?? line.productId).join(", ")
                const remainingProducts = Math.max(0, item.lineCount - 2)
                return (
                  <View key={item.clientOpId} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View style={styles.cardBody}>
                        <Text style={styles.storeName} numberOfLines={1}>{store?.name ?? item.storeId}</Text>
                        <Text style={styles.reference}>{t("orderReference")} · {shortReference(item.clientOpId)}</Text>
                      </View>
                      <CommercialPill label={t(statusKey)} tone={failed ? "danger" : item.status === "pending" ? "warning" : "success"} />
                    </View>
                    <Text style={styles.createdAt}>{formatShortDateTime(item.clientCreatedAt, locale)}</Text>
                    {previewNames ? <Text style={styles.productPreview}>{previewNames}{remainingProducts > 0 ? ` · +${remainingProducts}` : ""}</Text> : null}
                    <View style={styles.metrics}>
                      <Text style={styles.metric}>{item.lineCount} {t("orderProductKinds")}</Text>
                      <Text style={styles.metric}>{item.unitCount} {t("orderUnits")}</Text>
                    </View>
                    {failed ? (
                      <View style={styles.issueBlock}>
                        <Text style={styles.issueLabel}>{t("orderIssueReason")}</Text>
                        <Text style={styles.issueText}>{issueMessage(item.detailCode)}</Text>
                        {canEdit
                          ? <View style={styles.editWrap}><CommercialButton label={t("editOrder")} onPress={() => editOrder(item)} /></View>
                          : <Text style={styles.editHint}>{t("editOrderUnavailable")}</Text>}
                      </View>
                    ) : null}
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

function ServerOrderCard({ order, locale }: { order: ServerOrder; locale: "az" | "ru" }) {
  const units = order.lines.reduce((sum, line) => sum + line.quantity, 0)
  const tone = order.status === "DELIVERED"
    ? "success"
    : order.status === "CANCELLED"
      ? "danger"
      : order.status === "DRAFT"
        ? "neutral"
        : "info"
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardBody}>
          <Text style={styles.storeName}>{order.storeName}</Text>
          <Text style={styles.reference}>{order.invoiceNumber ? `${t("orderInvoice")} · ${order.invoiceNumber}` : `${t("orderReference")} · ${order.id.slice(-8).toUpperCase()}`}</Text>
        </View>
        <CommercialPill label={t(`commercialOrderStatus_${order.status}` as MessageKey)} tone={tone} />
      </View>
      <Text style={styles.createdAt}>{formatShortDateTime(order.updatedAt, locale)}</Text>
      <Text style={styles.productPreview} numberOfLines={2}>{order.lines.slice(0, 3).map((line) => line.productName).join(", ")}{order.lines.length > 3 ? ` · +${order.lines.length - 3}` : ""}</Text>
      <View style={styles.serverFooter}>
        <View style={styles.metrics}>
          <Text style={styles.metric}>{order.lines.length} {t("orderProductKinds")}</Text>
          <Text style={styles.metric}>{units} {t("orderUnits")}</Text>
        </View>
        <Text style={styles.orderAmount}>{money(order.totalAmount, order.currency)}</Text>
      </View>
      {["SUBMITTED", "CONFIRMED", "DELIVERED"].includes(order.status) ? (
        <Pressable accessibilityRole="button" onPress={() => router.push("/(app)/commercial/returns" as never)} style={styles.returnLink}>
          <Text style={styles.returnLinkText}>{t("commercialCreateReturn")} →</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 78, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 11 },
  backButton: { ...commercialCardStyle, width: 44, height: 44, borderRadius: 16, padding: 0, alignItems: "center", justifyContent: "center" },
  backGlyph: { color: colors.text, fontSize: 32, fontWeight: "500", lineHeight: 34, marginTop: -2 },
  headerBody: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 24, fontWeight: "900", letterSpacing: -0.4 },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 3 },
  scroll: { paddingBottom: 34 },
  createWrap: { marginHorizontal: 14, marginTop: 9 },
  summary: { ...commercialCardStyle, marginHorizontal: 14, marginTop: 10, flexDirection: "row", paddingHorizontal: 8 },
  summaryMetric: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center" },
  summaryDivider: { width: 1, backgroundColor: colors.border },
  summaryValue: { color: colors.text, fontSize: 21, fontWeight: "900" },
  summaryAmount: { color: colors.successDark, fontSize: 12, fontWeight: "900", textAlign: "center" },
  summaryLabel: { color: colors.muted, fontSize: 9, fontWeight: "700", marginTop: 3, textAlign: "center" },
  emptyWrap: { marginTop: 22 },
  list: { gap: 10, paddingHorizontal: 14 },
  card: { ...commercialCardStyle },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardBody: { flex: 1, minWidth: 0 },
  storeName: { color: colors.text, fontSize: 15, fontWeight: "900" },
  reference: { color: colors.muted, fontSize: 9, marginTop: 4 },
  createdAt: { color: colors.faint, fontSize: 10, marginTop: 9 },
  productPreview: { color: colors.text, fontSize: 11, lineHeight: 16, marginTop: 8 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 11 },
  metric: { color: colors.draft, backgroundColor: colors.draftBg, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: "800" },
  serverFooter: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  orderAmount: { color: colors.successDark, fontSize: 14, fontWeight: "900" },
  returnLink: { minHeight: 44, marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, justifyContent: "flex-end", alignItems: "flex-end" },
  returnLinkText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  issueBlock: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 13, paddingTop: 11 },
  issueLabel: { color: colors.dangerPressed, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  issueText: { color: colors.text, fontSize: 11, lineHeight: 16, marginTop: 3 },
  editWrap: { marginTop: 10 },
  editHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 8 },
})
