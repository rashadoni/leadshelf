// Вкладка «Визит»: активный визит с задачами точки и завершением; история за день.
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import * as Crypto from "expo-crypto"
import { router, useFocusEffect } from "expo-router"
import { SyncBar } from "../../../src/components/SyncBar"
import {
  enqueueOrderCreate,
  enqueueVisitCheckOut,
  getStore,
  listLocalCatalogProducts,
  listTasks,
  listVisits,
  type LocalCatalogProductRow,
} from "../../../src/db/local-store"
import type { TaskRow, VisitRow } from "../../../src/sync/ports"
import { useSync } from "../../../src/sync/sync-context"
import { t, useLocale } from "../../../src/i18n"
import { minutesBetween } from "../../../src/i18n/date-format"
import { colors, cardShadow, radii } from "../../../src/theme"
import { TabIcon } from "../../../src/components/TabIcon"

function isLocalVisit(visit: VisitRow | undefined): boolean {
  return Boolean(visit?.id.startsWith("local-"))
}

export default function VisitTab() {
  useLocale()
  const { status, sync } = useSync()
  const [visits, setVisits] = useState<VisitRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [catalog, setCatalog] = useState<LocalCatalogProductRow[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [orderFormOpen, setOrderFormOpen] = useState(false)
  const [orderQuery, setOrderQuery] = useState("")
  const [orderQuantities, setOrderQuantities] = useState<Record<string, number>>({})
  const [orderSaved, setOrderSaved] = useState(false)

  const reload = useCallback(() => {
    setVisits(listVisits())
    setTasks(listTasks())
    setCatalog(listLocalCatalogProducts())
    setNow(new Date())
  }, [])
  useFocusEffect(reload)

  useEffect(() => {
    if (status.phase !== "idle") return
    reload()
  }, [reload, status.lastSyncAt, status.phase])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const activeVisit = useMemo(() => visits.find((v) => v.status === "IN_PROGRESS"), [visits])
  const activeStore = activeVisit ? getStore(activeVisit.storeId) : null
  const activeTasks = useMemo(
    () => (activeVisit ? tasks.filter((task) => task.storeId === activeVisit.storeId) : []),
    [activeVisit, tasks],
  )
  const completedToday = useMemo(() => {
    const today = now.toISOString().slice(0, 10)
    return visits.filter((v) => v.status === "COMPLETED" && (v.checkOutAt ?? v.updatedAt).startsWith(today))
  }, [visits, now])
  const selectedOrderProducts = useMemo(
    () => catalog.filter((product) => (orderQuantities[product.id] ?? 0) > 0),
    [catalog, orderQuantities],
  )
  const visibleCatalog = useMemo(() => {
    const query = orderQuery.trim().toLocaleLowerCase()
    return catalog
      .filter((product) => {
        if (!query) return true
        return [product.name, product.sku, product.barcode, product.brandName]
          .some((value) => value?.toLocaleLowerCase().includes(query))
      })
      .slice(0, 40)
  }, [catalog, orderQuery])

  useEffect(() => {
    if (activeVisit) return
    setOrderFormOpen(false)
    setOrderQuery("")
    setOrderQuantities({})
    setOrderSaved(false)
  }, [activeVisit])

  async function onRefresh() {
    setRefreshing(true)
    await sync()
    reload()
    setRefreshing(false)
  }

  function checkOut(visit: VisitRow) {
    enqueueVisitCheckOut({ clientOpId: `op-${Crypto.randomUUID()}`, visitId: visit.id })
    Vibration.vibrate(60)
    reload()
    void sync()
  }

  function setOrderQuantity(productId: string, quantity: number) {
    setOrderSaved(false)
    setOrderQuantities((current) => {
      const next = { ...current }
      if (quantity <= 0) delete next[productId]
      else next[productId] = quantity
      return next
    })
  }

  function confirmOrder() {
    if (!activeVisit || selectedOrderProducts.length === 0) return
    enqueueOrderCreate({
      clientOpId: `op-${Crypto.randomUUID()}`,
      storeId: activeVisit.storeId,
      // Временный local-* id существует только в SQLite. Передавать его на
      // сервер нельзя; такой заказ остаётся прямым заказом той же точки.
      visitId: isLocalVisit(activeVisit) ? null : activeVisit.id,
      lines: selectedOrderProducts.map((product) => ({
        productId: product.id,
        quantity: orderQuantities[product.id] ?? 1,
      })),
    })
    Vibration.vibrate(40)
    setOrderQuantities({})
    setOrderQuery("")
    setOrderFormOpen(false)
    setOrderSaved(true)
    void sync()
  }

  const activeVisitIsLocal = isLocalVisit(activeVisit)

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t("tabVisit")}</Text>
        </View>
        <SyncBar />

        {activeVisit && activeStore ? (
          <View style={[styles.card, styles.activeCard]}>
            <View style={styles.activeLabelRow}>
              <View style={styles.activeDot} />
              <Text style={styles.activeLabel}>{t("nowAt")}</Text>
            </View>
            <Text style={styles.activeStore}>{activeStore.name}</Text>
            {activeStore.address ? <Text style={styles.activeAddress}>{activeStore.address}</Text> : null}
            <Text style={styles.activeMeta}>
              {activeVisit.checkInAt
                ? `${minutesBetween(activeVisit.checkInAt, now)} ${t("minutesElapsed")}`
                : t("visitInProgress")}
            </Text>

            {activeTasks.length > 0 ? (
              <View style={styles.taskBlock}>
                <Text style={styles.taskBlockTitle}>{t("tasksAtThisStore")}</Text>
                {activeTasks.map((task) => (
                  <Pressable
                    key={task.id}
                    onPress={() => router.push(`/(app)/tasks/${task.id}` as never)}
                    style={styles.taskRow}
                  >
                    <View style={styles.taskRowBody}>
                      <Text style={styles.taskRowTitle} numberOfLines={1}>
                        {task.title}
                      </Text>
                      <Text style={styles.taskRowMeta}>{task.status}</Text>
                    </View>
                    <Text style={styles.taskOpen}>{t("openTask")}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.noTasks}>{t("noTasksAtStop")}</Text>
            )}

            <Pressable
              disabled={activeVisitIsLocal}
              onPress={() => checkOut(activeVisit)}
              style={({ pressed }) => [
                styles.finishButton,
                pressed && styles.finishPressed,
                activeVisitIsLocal && styles.finishDisabled,
              ]}
            >
              <Text style={styles.finishText}>{activeVisitIsLocal ? t("queued") : t("finishVisit")}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.card, styles.emptyCard]}>
            <View style={styles.emptyIcon}>
              <TabIcon name="visit" color={colors.primary} size={30} />
            </View>
            <Text style={styles.emptyTitle}>{t("noActiveVisit")}</Text>
            <Text style={styles.emptyHint}>{t("noActiveVisitHint")}</Text>
          </View>
        )}

        {activeVisit && activeStore ? (
          <View style={styles.card}>
            <View style={styles.orderHeader}>
              <View style={styles.orderHeaderBody}>
                <Text style={styles.sectionTitle}>{t("createOrder")}</Text>
                <Text style={styles.orderHint}>{t("createOrderHint")}</Text>
              </View>
              {!orderFormOpen ? (
                <Pressable
                  onPress={() => {
                    setOrderSaved(false)
                    setOrderFormOpen(true)
                  }}
                  style={({ pressed }) => [styles.orderOpenButton, pressed && styles.orderOpenPressed]}
                >
                  <Text style={styles.orderOpenText}>{t("createOrder")}</Text>
                </Pressable>
              ) : null}
            </View>

            {orderSaved ? <Text style={styles.orderSaved}>{t("orderCreated")}</Text> : null}

            {orderFormOpen ? (
              <View style={styles.orderForm}>
                <TextInput
                  value={orderQuery}
                  onChangeText={setOrderQuery}
                  placeholder={t("productSearchPlaceholder")}
                  placeholderTextColor={colors.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.orderSearch}
                />

                {catalog.length === 0 ? (
                  <View style={styles.catalogEmpty}>
                    <Text style={styles.catalogEmptyTitle}>{t("noLocalProducts")}</Text>
                    <Text style={styles.catalogEmptyHint}>{t("noLocalProductsHint")}</Text>
                  </View>
                ) : visibleCatalog.length === 0 ? (
                  <Text style={styles.noMatches}>{t("noMatchingProducts")}</Text>
                ) : (
                  <View style={styles.catalogList}>
                    {visibleCatalog.map((product) => {
                      const quantity = orderQuantities[product.id] ?? 0
                      return (
                        <View
                          key={product.id}
                          style={[styles.productRow, quantity > 0 && styles.productRowSelected]}
                        >
                          <View style={styles.productBody}>
                            <Text style={styles.productName} numberOfLines={2}>
                              {product.name}
                            </Text>
                            <Text style={styles.productMeta} numberOfLines={1}>
                              {product.sku}
                              {product.brandName ? ` · ${product.brandName}` : ""}
                            </Text>
                          </View>
                          {quantity > 0 ? (
                            <View style={styles.quantityControl}>
                              <Pressable
                                accessibilityLabel={t("decreaseQuantity")}
                                onPress={() => setOrderQuantity(product.id, quantity - 1)}
                                style={({ pressed }) => [styles.quantityButton, pressed && styles.quantityPressed]}
                              >
                                <Text style={styles.quantityButtonText}>−</Text>
                              </Pressable>
                              <Text style={styles.quantityValue}>{quantity}</Text>
                              <Pressable
                                accessibilityLabel={t("increaseQuantity")}
                                onPress={() => setOrderQuantity(product.id, quantity + 1)}
                                style={({ pressed }) => [styles.quantityButton, pressed && styles.quantityPressed]}
                              >
                                <Text style={styles.quantityButtonText}>+</Text>
                              </Pressable>
                            </View>
                          ) : (
                            <Pressable
                              onPress={() => setOrderQuantity(product.id, 1)}
                              style={({ pressed }) => [styles.addProductButton, pressed && styles.addProductPressed]}
                            >
                              <Text style={styles.addProductText}>{t("addProduct")}</Text>
                            </Pressable>
                          )}
                        </View>
                      )
                    })}
                  </View>
                )}

                <Text style={styles.selectedCount}>
                  {t("selectedProducts")}: {selectedOrderProducts.length}
                </Text>
                <View style={styles.orderActions}>
                  <Pressable
                    onPress={() => {
                      setOrderFormOpen(false)
                      setOrderQuery("")
                      setOrderQuantities({})
                    }}
                    style={({ pressed }) => [styles.cancelOrderButton, pressed && styles.cancelOrderPressed]}
                  >
                    <Text style={styles.cancelOrderText}>{t("cancelOrder")}</Text>
                  </Pressable>
                  <Pressable
                    disabled={selectedOrderProducts.length === 0}
                    onPress={confirmOrder}
                    style={({ pressed }) => [
                      styles.confirmOrderButton,
                      pressed && styles.confirmOrderPressed,
                      selectedOrderProducts.length === 0 && styles.confirmOrderDisabled,
                    ]}
                  >
                    <Text style={styles.confirmOrderText}>{t("confirmOrder")}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {completedToday.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("visitsToday")}</Text>
            {completedToday.map((visit) => {
              const store = getStore(visit.storeId)
              const doneAt = (visit.checkOutAt ?? visit.updatedAt).slice(11, 16)
              return (
                <View key={visit.id} style={styles.historyRow}>
                  <View style={styles.historyDot} />
                  <View style={styles.historyBody}>
                    <Text style={styles.historyStore} numberOfLines={1}>
                      {store?.name ?? visit.storeId}
                    </Text>
                    <Text style={styles.historyMeta}>
                      {t("visitCompletedShort")} · {doneAt}
                    </Text>
                  </View>
                </View>
              )
            })}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 24 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text },
  card: {
    backgroundColor: colors.card,
    marginHorizontal: 14,
    marginTop: 14,
    padding: 16,
    borderRadius: radii.card,
    ...cardShadow,
  },
  activeCard: { backgroundColor: colors.successBg, borderWidth: 1, borderColor: colors.successBorder },
  activeLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  activeLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6, color: colors.successDark },
  activeStore: { fontSize: 20, fontWeight: "800", color: colors.text, marginTop: 6 },
  activeAddress: { fontSize: 13, color: colors.muted, marginTop: 2 },
  activeMeta: { fontSize: 12, color: colors.muted, marginTop: 4 },
  taskBlock: { marginTop: 14, gap: 6 },
  taskBlockTitle: { fontSize: 12, fontWeight: "700", color: colors.successDark, marginBottom: 2 },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.cardOverlay,
    borderRadius: radii.inner,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  taskRowBody: { flex: 1 },
  taskRowTitle: { fontSize: 13, fontWeight: "700", color: colors.text },
  taskRowMeta: { fontSize: 11, color: colors.muted, marginTop: 1 },
  taskOpen: { fontSize: 11, fontWeight: "800", color: colors.primary },
  noTasks: { marginTop: 12, fontSize: 12, color: colors.muted },
  finishButton: {
    marginTop: 16,
    alignSelf: "flex-start",
    backgroundColor: colors.danger,
    borderRadius: radii.pill,
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  finishPressed: { backgroundColor: colors.dangerPressed },
  finishDisabled: { backgroundColor: colors.disabled },
  finishText: { color: colors.headerText, fontSize: 14, fontWeight: "800" },
  emptyCard: { alignItems: "center", paddingVertical: 40, gap: 6 },
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
  emptyHint: { fontSize: 13, color: colors.faint, textAlign: "center", paddingHorizontal: 24 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.text, marginBottom: 8 },
  orderHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  orderHeaderBody: { flex: 1, minWidth: 0 },
  orderHint: { fontSize: 12, lineHeight: 17, color: colors.muted },
  orderOpenButton: {
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  orderOpenPressed: { backgroundColor: colors.primaryPressed },
  orderOpenText: { color: colors.headerText, fontSize: 12, fontWeight: "800" },
  orderSaved: {
    marginTop: 12,
    borderRadius: radii.inner,
    backgroundColor: colors.successBg,
    color: colors.successDark,
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  orderForm: { marginTop: 14, gap: 10 },
  orderSearch: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  catalogEmpty: {
    alignItems: "center",
    borderRadius: radii.inner,
    backgroundColor: colors.bg,
    paddingHorizontal: 18,
    paddingVertical: 22,
  },
  catalogEmptyTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  catalogEmptyHint: { color: colors.faint, fontSize: 12, lineHeight: 17, marginTop: 4, textAlign: "center" },
  noMatches: { color: colors.faint, fontSize: 13, paddingVertical: 18, textAlign: "center" },
  catalogList: { gap: 7 },
  productRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    backgroundColor: colors.card,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  productRowSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  productBody: { flex: 1, minWidth: 0 },
  productName: { color: colors.text, fontSize: 13, fontWeight: "700" },
  productMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  addProductButton: {
    borderRadius: radii.pill,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addProductPressed: { backgroundColor: colors.border },
  addProductText: { color: colors.primaryPressed, fontSize: 11, fontWeight: "800" },
  quantityControl: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  quantityButton: { minWidth: 34, minHeight: 34, alignItems: "center", justifyContent: "center" },
  quantityPressed: { backgroundColor: colors.primarySoft },
  quantityButtonText: { color: colors.primaryPressed, fontSize: 20, fontWeight: "700" },
  quantityValue: { minWidth: 28, color: colors.text, fontSize: 13, fontWeight: "800", textAlign: "center" },
  selectedCount: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  orderActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  cancelOrderButton: {
    borderRadius: radii.pill,
    backgroundColor: colors.bg,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  cancelOrderPressed: { backgroundColor: colors.border },
  cancelOrderText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  confirmOrderButton: {
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  confirmOrderPressed: { backgroundColor: colors.primaryPressed },
  confirmOrderDisabled: { backgroundColor: colors.disabled },
  confirmOrderText: { color: colors.headerText, fontSize: 12, fontWeight: "800" },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 10,
  },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  historyBody: { flex: 1 },
  historyStore: { fontSize: 14, fontWeight: "600", color: colors.text },
  historyMeta: { fontSize: 12, color: colors.muted, marginTop: 1 },
})
