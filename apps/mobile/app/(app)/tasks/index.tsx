import { useCallback, useEffect, useState } from "react"
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect } from "expo-router"
import { listTasks, getStore } from "../../../src/db/local-store"
import type { TaskRow } from "../../../src/sync/ports"
import { useSync } from "../../../src/sync/sync-context"
import { SyncBar } from "../../../src/components/SyncBar"
import { t, type MessageKey } from "../../../src/i18n"
import { tokenStore } from "../../../src/auth/token-store"

const STATUS_COLORS: Record<string, string> = {
  NEW: "#2563eb",
  IN_PROGRESS: "#d97706",
  PHOTO_SUBMITTED: "#7c3aed",
  COMPLETED: "#16a34a",
  EXPIRED: "#dc2626",
  EMPTY: "#737373",
}

export default function TasksScreen() {
  const { status, sync } = useSync()
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

  async function logout() {
    await tokenStore.clearSession()
    router.replace("/(auth)/login" as never)
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("tasks")}</Text>
        <Pressable onPress={logout}>
          <Text style={styles.logout}>{t("logout")}</Text>
        </Pressable>
      </View>
      <SyncBar />
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={tasks.length === 0 && styles.emptyWrap}
        ListEmptyComponent={<Text style={styles.empty}>{t("noTasks")}</Text>}
        renderItem={({ item }) => {
          const store = getStore(item.storeId)
          return (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/(app)/tasks/${item.id}` as never)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.taskTitle}>{item.title}</Text>
                <Text style={styles.meta}>
                  {store?.name ?? item.storeId}
                  {item.dueAt ? ` · ${t("due")}: ${item.dueAt.slice(0, 10)}` : ""}
                </Text>
              </View>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: `${STATUS_COLORS[item.status] ?? "#737373"}20` },
                ]}
              >
                <Text style={[styles.badgeText, { color: STATUS_COLORS[item.status] ?? "#737373" }]}>
                  {t(`status_${item.status}` as MessageKey)}
                </Text>
              </View>
            </Pressable>
          )
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafaf9" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { fontSize: 24, fontWeight: "700" },
  logout: { color: "#737373", fontSize: 13 },
  emptyWrap: { flex: 1, justifyContent: "center" },
  empty: { textAlign: "center", color: "#a3a3a3", paddingHorizontal: 40 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "white",
    marginHorizontal: 12,
    marginVertical: 4,
    padding: 14,
    borderRadius: 12,
  },
  taskTitle: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 12, color: "#737373", marginTop: 2 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: "600" },
})
