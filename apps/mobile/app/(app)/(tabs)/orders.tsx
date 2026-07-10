// Вкладка «Заказы»: заказы, созданные на устройстве (локальная очередь sync).
// Создание заказа живёт в контексте визита; здесь — статус и история отправки.
import { useCallback, useEffect, useState } from "react"
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useFocusEffect } from "expo-router"
import { SyncBar } from "../../../src/components/SyncBar"
import { getStore, listQueuedOrders, type QueuedOrderRow } from "../../../src/db/local-store"
import { useSync } from "../../../src/sync/sync-context"
import { t, useLocale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"
import { TabIcon } from "../../../src/components/TabIcon"

export default function OrdersTab() {
  useLocale()
  const { status, sync } = useSync()
  const [orders, setOrders] = useState<QueuedOrderRow[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const reload = useCallback(() => setOrders(listQueuedOrders()), [])
  useFocusEffect(reload)

  useEffect(() => {
    if (status.phase !== "idle") return
    reload()
  }, [reload, status.lastSyncAt, status.phase])

  async function onRefresh() {
    setRefreshing(true)
    await sync()
    reload()
    setRefreshing(false)
  }

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
        contentContainerStyle={orders.length === 0 ? styles.emptyWrap : styles.list}
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
          const createdAt = item.clientCreatedAt ? item.clientCreatedAt.slice(0, 16).replace("T", " ") : ""
          const statusKey = item.status === "pending"
            ? "orderQueued"
            : item.status === "rejected"
              ? "orderRejected"
              : item.status === "conflict"
                ? "orderConflict"
                : "orderSynced"
          const statusStyle = item.status === "pending"
            ? styles.statusPending
            : item.status === "rejected" || item.status === "conflict"
              ? styles.statusFailed
              : styles.statusDone
          const statusTextStyle = item.status === "pending"
            ? styles.statusTextPending
            : item.status === "rejected" || item.status === "conflict"
              ? styles.statusTextFailed
              : styles.statusTextDone
          return (
            <View style={styles.card}>
              <View style={styles.cardBody}>
                <Text style={styles.storeName} numberOfLines={1}>
                  {store?.name ?? item.storeId}
                </Text>
                <Text style={styles.meta}>
                  {item.lineCount} {t("orderProductKinds")} · {createdAt}
                </Text>
              </View>
              <View style={[styles.statusPill, statusStyle]}>
                <Text style={[styles.statusText, statusTextStyle]}>
                  {t(statusKey)}
                </Text>
              </View>
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
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    marginHorizontal: 14,
    marginTop: 12,
    padding: 16,
    borderRadius: radii.card,
    ...cardShadow,
  },
  cardBody: { flex: 1, minWidth: 0 },
  storeName: { fontSize: 15, fontWeight: "700", color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  statusPill: { borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5 },
  statusPending: { backgroundColor: colors.warningBg },
  statusDone: { backgroundColor: colors.successBg },
  statusFailed: { backgroundColor: colors.dangerBg },
  statusText: { fontSize: 11, fontWeight: "700" },
  statusTextPending: { color: colors.warning },
  statusTextDone: { color: colors.successDark },
  statusTextFailed: { color: colors.dangerPressed },
})
