import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect } from "expo-router"
import { SectionHint } from "../../../src/components/SectionHint"
import { SyncBar } from "../../../src/components/SyncBar"
import { getStore, listTasks } from "../../../src/db/local-store"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { t, type MessageKey, useLocale } from "../../../src/i18n"
import type { TaskRow } from "../../../src/sync/ports"
import { useSync } from "../../../src/sync/sync-context"
import { countOpenTaskStatuses } from "../../../src/tasks/status"
import { groupTasksForWorkQueue, type TaskQueueGroup } from "../../../src/tasks/work-queue"
import { colors, radii } from "../../../src/theme"

const SECTION_TITLE_KEYS: Record<TaskQueueGroup, MessageKey> = {
  active: "tasksSectionActive",
  today: "tasksSectionToday",
  upcoming: "tasksSectionUpcoming",
  closed: "tasksSectionClosed",
}

function taskActionKey(status: TaskRow["status"]): MessageKey {
  if (status === "NEW") return "taskActionStart"
  if (status === "IN_PROGRESS") return "taskActionContinue"
  if (status === "PHOTO_SUBMITTED") return "taskActionReview"
  return "taskActionOpen"
}

function taskStatusColor(status: TaskRow["status"]): string {
  if (status === "NEW") return colors.primary
  if (status === "IN_PROGRESS") return colors.warning
  if (status === "PHOTO_SUBMITTED") return colors.primaryPressed
  if (status === "COMPLETED") return colors.success
  if (status === "EXPIRED") return colors.danger
  return colors.muted
}

function TaskCardSkeleton() {
  return (
    <View style={styles.skeletonCard}>
      <View style={[styles.skeletonLine, styles.skeletonTitle]} />
      <View style={[styles.skeletonLine, styles.skeletonStore]} />
      <View style={styles.skeletonFooter}>
        <View style={[styles.skeletonLine, styles.skeletonStatus]} />
        <View style={[styles.skeletonLine, styles.skeletonAction]} />
      </View>
    </View>
  )
}

export default function TasksScreen() {
  const locale = useLocale()
  const { sync, status } = useSync()
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const reload = useCallback(() => setTasks(listTasks()), [])
  useFocusEffect(reload)

  useEffect(() => {
    if (status.phase === "idle") reload()
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

  const openCount = countOpenTaskStatuses(tasks.map((task) => task.status))
  const sections = useMemo(() => {
    const grouped = groupTasksForWorkQueue(tasks, new Date())
    return (Object.keys(grouped) as TaskQueueGroup[])
      .map((key) => ({ key, titleKey: SECTION_TITLE_KEYS[key], data: grouped[key] }))
      .filter((section) => section.data.length > 0)
  }, [tasks])
  const firstSyncLoading =
    status.lastSyncAt === null &&
    status.phase !== "offline" &&
    status.phase !== "error" &&
    status.phase !== "upgradeRequired"
  const showSkeletons = tasks.length === 0 && (refreshing || firstSyncLoading)

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("tasks")}</Text>
        <Text style={styles.subtitle}>
          {t("tasksOpenLabel")}: {openCount}
        </Text>
      </View>
      <SyncBar />
      <SectionHint section="tasks" icon="tasks" titleKey="onboardTitle" bodyKey="onboardBody" />

      {showSkeletons ? (
        <View style={styles.skeletonList}>
          <TaskCardSkeleton />
          <TaskCardSkeleton />
          <TaskCardSkeleton />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={tasks.length === 0 ? styles.emptyWrap : styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <View style={styles.emptyCheck}>
                <Text style={styles.emptyCheckText}>✓</Text>
              </View>
              <Text style={styles.emptyTitle}>{t("noTasks")}</Text>
              <Text style={styles.emptyHint}>{t("pullToRefresh")}</Text>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t(section.titleKey)}</Text>
              <Text style={styles.sectionCount}>{section.data.length}</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const store = getStore(item.storeId)
            const statusColor = taskStatusColor(item.status)
            const due = item.dueAt ? formatShortDateTime(item.dueAt, locale) : null
            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/(app)/tasks/${item.id}` as never)}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.cardMain}>
                    <Text style={styles.taskTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={styles.storeName} numberOfLines={1}>
                      {store?.name ?? item.storeId}
                    </Text>
                  </View>
                  <View style={styles.actionButton}>
                    <Text style={styles.actionText}>{t(taskActionKey(item.status))}</Text>
                  </View>
                </View>
                <View style={styles.cardFooter}>
                  <View style={styles.statusRow}>
                    <View style={[styles.dot, { backgroundColor: statusColor }]} />
                    <Text style={[styles.statusText, { color: statusColor }]}>
                      {t(`status_${item.status}` as MessageKey)}
                    </Text>
                  </View>
                  {due ? <Text style={styles.dueText}>{t("due")}: {due}</Text> : null}
                </View>
              </Pressable>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 9 },
  title: { color: colors.text, fontSize: 28, fontWeight: "900", letterSpacing: -0.7 },
  subtitle: { color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 5 },
  listContent: { paddingHorizontal: 20, paddingBottom: 28 },
  emptyWrap: { flexGrow: 1, justifyContent: "center" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingTop: 20,
    paddingBottom: 9,
  },
  sectionTitle: { color: colors.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  sectionCount: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    color: colors.muted,
    backgroundColor: colors.skeleton,
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center",
  },
  card: {
    minHeight: 104,
    marginBottom: 10,
    padding: 15,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPressed: { opacity: 0.72 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  cardMain: { flex: 1, minWidth: 0 },
  taskTitle: { color: colors.text, fontSize: 15, fontWeight: "900", lineHeight: 20 },
  storeName: { color: colors.muted, fontSize: 11, fontWeight: "600", marginTop: 5 },
  actionButton: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 11,
    borderRadius: radii.inner,
    backgroundColor: colors.navy,
  },
  actionText: { color: colors.headerText, fontSize: 10, fontWeight: "800" },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 13,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: "800" },
  dueText: { flexShrink: 1, color: colors.faint, fontSize: 10, textAlign: "right" },
  emptyBox: { alignItems: "center", paddingHorizontal: 36, gap: 8 },
  emptyCheck: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.successBg,
  },
  emptyCheckText: { color: colors.success, fontSize: 32, fontWeight: "800" },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "800", textAlign: "center" },
  emptyHint: { color: colors.muted, fontSize: 14, textAlign: "center" },
  skeletonList: { paddingHorizontal: 20, paddingTop: 14, gap: 10 },
  skeletonCard: {
    minHeight: 100,
    padding: 14,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skeletonLine: { height: 11, borderRadius: radii.pill, backgroundColor: colors.skeleton },
  skeletonTitle: { width: "68%", height: 16 },
  skeletonStore: { width: "42%", marginTop: 10 },
  skeletonFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 20 },
  skeletonStatus: { width: 72 },
  skeletonAction: { width: 58 },
})
