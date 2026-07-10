// Вкладка «Панель»: офлайн-статистика дня из локальной БД + переход ко всем задачам.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect } from "expo-router"
import { SyncBar } from "../../../src/components/SyncBar"
import { listTasks, listVisits } from "../../../src/db/local-store"
import type { TaskRow, VisitRow } from "../../../src/sync/ports"
import { useSync } from "../../../src/sync/sync-context"
import { t, useLocale, type MessageKey } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"

function StatCard({ labelKey, value, accent }: { labelKey: MessageKey; value: number; accent?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{t(labelKey)}</Text>
    </View>
  )
}

export default function DashboardTab() {
  useLocale()
  const { status, sync } = useSync()
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [visits, setVisits] = useState<VisitRow[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const reload = useCallback(() => {
    setTasks(listTasks())
    setVisits(listVisits())
  }, [])
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

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const open = tasks.filter((task) => task.status !== "COMPLETED" && task.status !== "EMPTY").length
    const done = tasks.filter((task) => task.status === "COMPLETED").length
    const visitsToday = visits.filter(
      (visit) => visit.status === "COMPLETED" && (visit.checkOutAt ?? visit.updatedAt).startsWith(today),
    ).length
    return { open, done, visitsToday }
  }, [tasks, visits])

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t("tabDashboard")}</Text>
        </View>
        <SyncBar />

        <View style={styles.grid}>
          <StatCard labelKey="statOpenTasks" value={stats.open} accent={colors.primary} />
          <StatCard labelKey="statDoneTasks" value={stats.done} accent={colors.success} />
          <StatCard labelKey="statVisitsToday" value={stats.visitsToday} />
          <StatCard labelKey="statPendingSync" value={status.pendingOps} accent={status.pendingOps > 0 ? colors.warning : undefined} />
          <StatCard labelKey="statPhotosQueued" value={status.pendingPhotos} accent={status.pendingPhotos > 0 ? colors.warning : undefined} />
        </View>

        <Pressable onPress={() => router.push("/(app)/tasks" as never)} style={styles.allTasks}>
          <Text style={styles.allTasksText}>{t("allTasks")}</Text>
          <Text style={styles.allTasksArrow}>→</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 24 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 14,
    marginTop: 14,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 16,
    ...cardShadow,
  },
  statValue: { fontSize: 28, fontWeight: "800", color: colors.text },
  statLabel: { fontSize: 12, color: colors.muted, marginTop: 4, fontWeight: "600" },
  allTasks: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    marginHorizontal: 14,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderRadius: radii.card,
    ...cardShadow,
  },
  allTasksText: { fontSize: 14, fontWeight: "700", color: colors.text },
  allTasksArrow: { fontSize: 16, fontWeight: "800", color: colors.primary },
})
