import { useCallback, useEffect, useState } from "react"
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect } from "expo-router"
import { listTasks, getStore } from "../../../src/db/local-store"
import type { TaskRow } from "../../../src/sync/ports"
import { useSync } from "../../../src/sync/sync-context"
import { SyncBar } from "../../../src/components/SyncBar"
import { SectionHint } from "../../../src/components/SectionHint"
import { t, type MessageKey } from "../../../src/i18n"
import { countOpenTaskStatuses } from "../../../src/tasks/status"

const STATUS_COLORS: Record<string, string> = {
  NEW: "#2563eb",
  IN_PROGRESS: "#d97706",
  PHOTO_SUBMITTED: "#7c3aed",
  COMPLETED: "#16a34a",
  EXPIRED: "#dc2626",
  EMPTY: "#737373",
}

export default function TasksScreen() {
  const { sync, status } = useSync()
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const reload = useCallback(() => setTasks(listTasks()), [])
  useFocusEffect(reload)

  useEffect(() => {
    if (status.phase !== "idle") return
    setTasks(listTasks())
  }, [status.lastSyncAt, status.phase])

  async function onRefresh() {
    setRefreshing(true)
    await sync()
    reload()
    setRefreshing(false)
  }

  const openCount = countOpenTaskStatuses(tasks.map((task) => task.status))

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t("tasks")}</Text>
          <Text style={styles.subtitle}>
            {t("todayWord")}: {openCount}
          </Text>
        </View>

      </View>
      <SyncBar />
      <SectionHint section="tasks" icon="tasks" titleKey="onboardTitle" bodyKey="onboardBody" />
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={tasks.length === 0 ? styles.emptyWrap : styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>✅</Text>
            <Text style={styles.emptyTitle}>{t("noTasks")}</Text>
            <Text style={styles.emptyHint}>{t("pullToRefresh")}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const store = getStore(item.storeId)
          const color = STATUS_COLORS[item.status] ?? "#737373"
          return (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => router.push(`/(app)/tasks/${item.id}` as never)}
            >
              <View style={styles.cardMain}>
                <Text style={styles.taskTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  📍 {store?.name ?? item.storeId}
                  {item.dueAt ? ` · ${t("due")} ${item.dueAt.slice(0, 10)}` : ""}
                </Text>
                <View style={styles.statusRow}>
                  <View style={[styles.dot, { backgroundColor: color }]} />
                  <Text style={[styles.statusText, { color }]}>
                    {t(`status_${item.status}` as MessageKey)}
                  </Text>
                </View>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F4F4F6" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  title: { fontSize: 26, fontWeight: "800", color: "#1c1917" },
  subtitle: { fontSize: 13, color: "#78716c", marginTop: 2 },
  listContent: { paddingVertical: 6, paddingBottom: 24 },
  emptyWrap: { flex: 1, justifyContent: "center" },
  emptyBox: { alignItems: "center", paddingHorizontal: 40, gap: 8 },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: "#44403c" },
  emptyHint: { fontSize: 14, color: "#a8a29e", textAlign: "center" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "white",
    marginHorizontal: 12,
    marginVertical: 5,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#eeece9",
  },
  cardPressed: { backgroundColor: "#fafaf9", borderColor: "#e7e5e4" },
  cardMain: { flex: 1, gap: 6 },
  taskTitle: { fontSize: 17, fontWeight: "700", color: "#1c1917" },
  meta: { fontSize: 13, color: "#78716c" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  statusText: { fontSize: 12, fontWeight: "700" },
  chevron: { fontSize: 28, color: "#d6d3d1", fontWeight: "700" },
})
