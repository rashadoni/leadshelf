// Вкладка «Визит»: активный визит, задачи точки, заказ и история за день.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, Vibration, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import * as Crypto from "expo-crypto"
import { router, useFocusEffect } from "expo-router"
import { SyncBar } from "../../../src/components/SyncBar"
import {
  enqueueVisitCheckOut,
  getStore,
  listTasks,
  listVisits,
} from "../../../src/db/local-store"
import type { TaskRow, VisitRow } from "../../../src/sync/ports"
import { useSync } from "../../../src/sync/sync-context"
import { t, type MessageKey, useLocale } from "../../../src/i18n"
import { formatTime, isSameLocalDay, minutesBetween } from "../../../src/i18n/date-format"
import { colors, radii } from "../../../src/theme"
import { TabIcon } from "../../../src/components/TabIcon"

function isLocalVisit(visit: VisitRow | undefined): boolean {
  return Boolean(visit?.id.startsWith("local-"))
}

export default function VisitTab() {
  useLocale()
  const { status, sync } = useSync()
  const [visits, setVisits] = useState<VisitRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => new Date())

  const reload = useCallback(() => {
    setVisits(listVisits())
    setTasks(listTasks())
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

  const activeVisit = useMemo(() => visits.find((visit) => visit.status === "IN_PROGRESS"), [visits])
  const activeStore = activeVisit ? getStore(activeVisit.storeId) : null
  const activeTasks = useMemo(
    () => (activeVisit ? tasks.filter((task) => task.storeId === activeVisit.storeId) : []),
    [activeVisit, tasks],
  )
  const completedToday = useMemo(
    () => visits.filter((visit) => {
      if (visit.status !== "COMPLETED") return false
      const completedAt = new Date(visit.checkOutAt ?? visit.updatedAt)
      return Number.isFinite(completedAt.getTime()) && isSameLocalDay(completedAt, now)
    }),
    [visits, now],
  )

  async function onRefresh() {
    setRefreshing(true)
    try {
      await sync()
      reload()
    } finally {
      setRefreshing(false)
    }
  }

  function checkOut(visit: VisitRow) {
    enqueueVisitCheckOut({ clientOpId: `op-${Crypto.randomUUID()}`, visitId: visit.id })
    Vibration.vibrate(60)
    reload()
    void sync()
  }

  function openOrderComposer(visit: VisitRow) {
    const query = `storeId=${encodeURIComponent(visit.storeId)}&visitId=${encodeURIComponent(visit.id)}`
    router.push(`/(app)/order-create?${query}` as never)
  }

  const activeVisitIsLocal = isLocalVisit(activeVisit)

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t("tabVisit")}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(app)/(tabs)/orders" as never)}
            style={({ pressed }) => [styles.ordersLink, pressed && styles.ordersLinkPressed]}
          >
            <Text style={styles.ordersLinkText}>{t("tabOrders")}</Text>
          </Pressable>
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
                    accessibilityRole="button"
                    onPress={() => router.push(`/(app)/tasks/${task.id}` as never)}
                    style={({ pressed }) => [styles.taskRow, pressed && styles.taskRowPressed]}
                  >
                    <View style={styles.taskRowBody}>
                      <Text style={styles.taskRowTitle} numberOfLines={1}>{task.title}</Text>
                      <Text style={styles.taskRowMeta}>
                        {t(`status_${task.status}` as MessageKey)}
                      </Text>
                    </View>
                    <Text style={styles.taskOpen}>{t("openTask")}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.noTasks}>{t("noTasksAtStop")}</Text>
            )}

            <View style={styles.visitActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => openOrderComposer(activeVisit)}
                style={({ pressed }) => [styles.orderButton, pressed && styles.orderPressed]}
              >
                <Text style={styles.orderButtonText}>{t("createOrder")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
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
            <Text style={styles.sectionTitle}>{t("createOrder")}</Text>
            <Text style={styles.orderHint}>{t("createOrderHint")}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => openOrderComposer(activeVisit)}
              style={({ pressed }) => [styles.orderCallToAction, pressed && styles.orderPressed]}
            >
              <Text style={styles.orderCallToActionText}>{t("createOrder")}</Text>
              <Text style={styles.orderArrow}>›</Text>
            </Pressable>
          </View>
        ) : null}

        {completedToday.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("visitsToday")}</Text>
            {completedToday.map((visit) => {
              const store = getStore(visit.storeId)
              return (
                <View key={visit.id} style={styles.historyRow}>
                  <View style={styles.historyDot} />
                  <View style={styles.historyBody}>
                    <Text style={styles.historyStore} numberOfLines={1}>{store?.name ?? visit.storeId}</Text>
                    <Text style={styles.historyMeta}>
                      {t("visitCompletedShort")} · {formatTime(visit.checkOutAt ?? visit.updatedAt)}
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
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 9,
  },
  title: { fontSize: 28, fontWeight: "900", color: colors.text, letterSpacing: -0.7 },
  ordersLink: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  ordersLinkPressed: { opacity: 0.65 },
  ordersLinkText: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  card: {
    backgroundColor: colors.card,
    marginHorizontal: 20,
    marginTop: 16,
    padding: 17,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  activeCard: { borderTopWidth: 4, borderTopColor: colors.success },
  activeLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  activeLabel: { fontSize: 9, fontWeight: "900", letterSpacing: 1.1, color: colors.successDark },
  activeStore: { fontSize: 21, fontWeight: "900", color: colors.text, marginTop: 8, letterSpacing: -0.4 },
  activeAddress: { fontSize: 13, color: colors.muted, marginTop: 2 },
  activeMeta: { fontSize: 12, color: colors.muted, marginTop: 4 },
  taskBlock: { marginTop: 14, gap: 6 },
  taskBlockTitle: { fontSize: 12, fontWeight: "700", color: colors.successDark, marginBottom: 2 },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.inner,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  taskRowPressed: { opacity: 0.72 },
  taskRowBody: { flex: 1, minWidth: 0 },
  taskRowTitle: { fontSize: 13, fontWeight: "700", color: colors.text },
  taskRowMeta: { fontSize: 11, color: colors.muted, marginTop: 1 },
  taskOpen: { fontSize: 11, fontWeight: "800", color: colors.primary },
  noTasks: { marginTop: 12, fontSize: 12, color: colors.muted },
  visitActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  orderButton: {
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.navy,
    borderRadius: radii.inner,
    paddingHorizontal: 18,
  },
  orderPressed: { backgroundColor: colors.primaryPressed },
  orderButtonText: { color: colors.headerText, fontSize: 13, fontWeight: "800" },
  finishButton: {
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radii.inner,
    paddingHorizontal: 18,
  },
  finishPressed: { backgroundColor: colors.dangerPressed },
  finishDisabled: { backgroundColor: colors.disabled },
  finishText: { color: colors.danger, fontSize: 13, fontWeight: "800" },
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
  orderHint: { fontSize: 12, lineHeight: 17, color: colors.muted },
  orderCallToAction: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radii.inner,
    backgroundColor: colors.navy,
    marginTop: 14,
    paddingHorizontal: 18,
  },
  orderCallToActionText: { color: colors.headerText, fontSize: 14, fontWeight: "800" },
  orderArrow: { color: colors.headerText, fontSize: 25, lineHeight: 25 },
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
