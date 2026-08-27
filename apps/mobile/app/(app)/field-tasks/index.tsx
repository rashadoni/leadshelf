import { useMemo, useState } from "react"
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { enqueueFieldTaskUpdate, readFieldCache } from "../../../src/db/local-store"
import type { FieldAgentTask, FieldAgentTaskPriority, FieldAgentTasksData, FieldAgentTaskStatus } from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import { FIELD_AGENT_TASKS_CACHE_KEY } from "../../../src/field/task-cache"
import { fieldErrorMessage, FIELD_TASK_ERROR_OVERRIDES } from "../../../src/field/error-message"
import { isFieldTaskDueOnDate, resolveFieldTaskToday } from "../../../src/field/task-time"
import { safeFieldBack } from "../../../src/navigation/safe-back"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { t, type MessageKey, useLocale } from "../../../src/i18n"
import { useSync } from "../../../src/sync/sync-context"
import { TabIcon } from "../../../src/components/TabIcon"
import { FieldScreenChrome } from "../../../src/components/FieldScreenChrome"
import { colors, cardShadow, radii } from "../../../src/theme"
import { useResponsiveLayout } from "../../../src/layout/responsive"

type Filter = "OPEN" | "ALL" | "IN_PROGRESS" | "COMPLETED"

const FILTER_LABEL_KEYS: Record<Filter, MessageKey> = {
  OPEN: "agentTasksFilterOpen",
  ALL: "agentTasksFilterAll",
  IN_PROGRESS: "agentTasksFilterProgress",
  COMPLETED: "agentTasksFilterDone",
}

const PRIORITY_WEIGHT: Record<FieldAgentTaskPriority, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }
const STATUS_WEIGHT: Record<FieldAgentTaskStatus, number> = { OVERDUE: 5, IN_PROGRESS: 4, PENDING: 3, COMPLETED: 2, CANCELLED: 1 }

function statusLabel(status: FieldAgentTaskStatus): string {
  if (status === "PENDING") return t("agentTaskStatus_PENDING")
  if (status === "IN_PROGRESS") return t("agentTaskStatus_IN_PROGRESS")
  if (status === "COMPLETED") return t("agentTaskStatus_COMPLETED")
  if (status === "CANCELLED") return t("agentTaskStatus_CANCELLED")
  return t("agentTaskStatus_OVERDUE")
}

function priorityLabel(priority: FieldAgentTaskPriority): string {
  if (priority === "LOW") return t("agentTaskPriority_LOW")
  if (priority === "MEDIUM") return t("agentTaskPriority_MEDIUM")
  if (priority === "HIGH") return t("agentTaskPriority_HIGH")
  return t("agentTaskPriority_URGENT")
}

function statusTone(status: FieldAgentTaskStatus) {
  if (status === "OVERDUE") return { bg: colors.dangerBg, color: colors.missed }
  if (status === "IN_PROGRESS") return { bg: colors.infoBg, color: colors.info }
  if (status === "COMPLETED") return { bg: colors.successBg, color: colors.successDark }
  if (status === "CANCELLED") return { bg: colors.draftBg, color: colors.draft }
  return { bg: colors.warningBg, color: colors.warning }
}

function priorityColor(priority: FieldAgentTaskPriority): string {
  if (priority === "URGENT") return colors.danger
  if (priority === "HIGH") return colors.warning
  if (priority === "MEDIUM") return colors.info
  return colors.faint
}

function dueToday(task: FieldAgentTask, tenantToday: string, tenantTimeZone: string): boolean {
  return isFieldTaskDueOnDate(task.dueDate, tenantToday, tenantTimeZone)
}

export default function AgentTasksScreen() {
  const locale = useLocale()
  const field = useField()
  const layout = useResponsiveLayout()
  const { sync } = useSync()
  const [filter, setFilter] = useState<Filter>("OPEN")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const tenantTimeZone = field.week?.timezone ?? field.workday?.timezone ?? field.profile?.todaySummary.timezone ?? "UTC"
  const tenantToday = resolveFieldTaskToday(
    field.week?.today ?? field.workday?.today ?? field.profile?.todaySummary.date,
    tenantTimeZone,
  )
  const canCreateTask = field.agentTasks?.capabilities.createSelfTask === true
  const tasks = field.agentTasks?.tasks ?? []
  const displayedError = localError ?? (field.taskError ? t(field.taskError) : null)
  const open = tasks.filter((task) => task.status !== "COMPLETED" && task.status !== "CANCELLED").length
  const overdue = tasks.filter((task) => task.status === "OVERDUE").length
  const today = tasks.filter((task) => dueToday(task, tenantToday, tenantTimeZone) && task.status !== "COMPLETED" && task.status !== "CANCELLED").length

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return tasks
      .filter((task) => {
        if (filter === "OPEN" && (task.status === "COMPLETED" || task.status === "CANCELLED")) return false
        if (filter === "IN_PROGRESS" && task.status !== "IN_PROGRESS") return false
        if (filter === "COMPLETED" && task.status !== "COMPLETED") return false
        return !query || task.title.toLocaleLowerCase().includes(query) || task.customer?.name.toLocaleLowerCase().includes(query)
      })
      .sort((left, right) => {
        const statusDelta = STATUS_WEIGHT[right.status] - STATUS_WEIGHT[left.status]
        if (statusDelta) return statusDelta
        const leftDue = left.dueDate ? new Date(left.dueDate).getTime() : Number.MAX_SAFE_INTEGER
        const rightDue = right.dueDate ? new Date(right.dueDate).getTime() : Number.MAX_SAFE_INTEGER
        if (leftDue !== rightDue) return leftDue - rightDue
        return PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority]
      })
  }, [filter, search, tasks])

  function applyCachedTasks() {
    const cached = readFieldCache<FieldAgentTasksData>(FIELD_AGENT_TASKS_CACHE_KEY)
    if (cached) field.applyLocalAgentTasks(cached.value)
  }

  async function queueUpdate(task: FieldAgentTask, update: Parameters<typeof enqueueFieldTaskUpdate>[0]) {
    setBusyId(task.id)
    setLocalError(null)
    try {
      enqueueFieldTaskUpdate(update)
      applyCachedTasks()
      await sync()
      await field.refreshAgentTasks()
    } catch (cause) {
      setLocalError(fieldErrorMessage(cause, "agentTaskActionFailed", FIELD_TASK_ERROR_OVERRIDES))
      applyCachedTasks()
    } finally {
      setBusyId(null)
    }
  }

  function quickAction(task: FieldAgentTask) {
    if (!task.acceptedAt && task.persistedStatus === "PENDING") {
      void queueUpdate(task, { taskId: task.id, expectedVersion: task.version, acceptedAt: new Date().toISOString() })
      return
    }
    if (task.persistedStatus === "PENDING" || task.status === "OVERDUE") {
      void queueUpdate(task, { taskId: task.id, expectedVersion: task.version, status: "IN_PROGRESS" })
      return
    }
    if (task.persistedStatus === "IN_PROGRESS") {
      Alert.alert(t("agentTaskCompleteConfirmTitle"), t("agentTaskCompleteConfirmBody"), [
        { text: t("cancel"), style: "cancel" },
        { text: t("agentTaskComplete"), onPress: () => void queueUpdate(task, { taskId: task.id, expectedVersion: task.version, status: "COMPLETED" }) },
      ])
    }
  }

  async function refresh() {
    await sync().catch(() => {})
    await field.refreshAgentTasks()
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <FieldScreenChrome />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={field.taskPhase === "refreshing"} onRefresh={() => void refresh()} tintColor={colors.primary} />}
      >
        <View style={[styles.content, layout.isTablet && styles.contentTablet]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => safeFieldBack("/(app)/(tabs)/work")} style={styles.back}><TabIcon name="chevronLeft" color={colors.text} size={23} /></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("tabWork").toUpperCase()}</Text>
            <Text style={styles.title}>{t("agentTasksTitle")}</Text>
            <Text style={styles.subtitle}>{t("agentTasksSubtitle")}</Text>
          </View>
          {canCreateTask ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskCreate")} onPress={() => router.push("/(app)/field-tasks/new" as never)} style={styles.add}><TabIcon name="add" color={colors.headerText} size={22} /></Pressable>
          ) : null}
        </View>

        <View style={styles.summary}>
          <SummaryMetric value={open} label={t("agentTasksSummaryOpen")} color={colors.info} />
          <SummaryMetric value={today} label={t("agentTasksSummaryToday")} color={colors.warning} />
          <SummaryMetric value={overdue} label={t("agentTasksSummaryOverdue")} color={colors.missed} />
        </View>

        <View style={styles.searchBox}><TabIcon name="search" color={colors.faint} size={20} /><TextInput accessibilityLabel={t("agentTasksSearch")} value={search} onChangeText={setSearch} placeholder={t("agentTasksSearch")} placeholderTextColor={colors.faint} style={styles.searchInput} /></View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t("agentTasksFilterLabel")}: ${t(FILTER_LABEL_KEYS[filter])}`}
          accessibilityState={{ expanded: filtersOpen }}
          onPress={() => setFiltersOpen((open) => !open)}
          style={({ pressed }) => [styles.filterSummary, pressed && styles.pressed]}
        >
          <View style={styles.filterSummaryIcon}><TabIcon name="tasks" color={colors.primary} size={19} /></View>
          <View style={styles.filterSummaryBody}>
            <Text style={styles.filterSummaryLabel}>{t("agentTasksFilterLabel")}</Text>
            <Text style={styles.filterSummaryValue}>{t(FILTER_LABEL_KEYS[filter])}</Text>
          </View>
          <View accessible={false} style={styles.filterSummaryChevron}><TabIcon name={filtersOpen ? "chevronUp" : "chevronDown"} color={colors.primary} size={20} /></View>
        </Pressable>
        {filtersOpen ? <View style={styles.filters}>
          <FilterChip selected={filter === "OPEN"} label={t("agentTasksFilterOpen")} onPress={() => { setFilter("OPEN"); setFiltersOpen(false) }} />
          <FilterChip selected={filter === "IN_PROGRESS"} label={t("agentTasksFilterProgress")} onPress={() => { setFilter("IN_PROGRESS"); setFiltersOpen(false) }} />
          <FilterChip selected={filter === "COMPLETED"} label={t("agentTasksFilterDone")} onPress={() => { setFilter("COMPLETED"); setFiltersOpen(false) }} />
          <FilterChip selected={filter === "ALL"} label={t("agentTasksFilterAll")} onPress={() => { setFilter("ALL"); setFiltersOpen(false) }} />
        </View> : null}

        {displayedError ? <View style={styles.error}><Text style={styles.errorText}>{displayedError}</Text></View> : null}
        {visible.length > 0 ? <View style={[styles.taskList, layout.isTablet && styles.taskListTablet]}>{visible.map((task) => {
          const tone = statusTone(task.status)
          const action = !task.acceptedAt && task.persistedStatus === "PENDING"
            ? t("agentTaskAccept")
            : task.persistedStatus === "IN_PROGRESS" ? t("agentTaskComplete") : t("agentTaskStart")
          const actionable = task.persistedStatus === "PENDING" || task.persistedStatus === "IN_PROGRESS"
          return (
            <Pressable key={task.id} accessibilityRole="button" accessibilityLabel={t("agentTaskDetails") + ": " + task.title} onPress={() => router.push(`/(app)/field-tasks/${task.id}` as never)} style={({ pressed }) => [styles.card, layout.isTablet && styles.cardTablet, pressed && styles.pressed]}>
              <View style={styles.cardTop}>
                <View style={[styles.priorityDot, { backgroundColor: priorityColor(task.priority) }]} />
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{task.title}</Text>
                  <Text style={styles.source}>{task.canEditContent ? t("agentTaskPersonal") : t("agentTaskAssigned")} · {priorityLabel(task.priority)}</Text>
                </View>
                <View style={[styles.status, { backgroundColor: tone.bg }]}><Text style={[styles.statusText, { color: tone.color }]}>{statusLabel(task.status)}</Text></View>
              </View>
              <View style={styles.metaRow}>
                <TabIcon name="week" color={colors.faint} size={16} /><Text style={[styles.meta, task.status === "OVERDUE" && styles.overdue]}>{task.dueDate ? formatShortDateTime(task.dueDate, locale, tenantTimeZone) : t("agentTaskDueNone")}</Text>
              </View>
              <View style={styles.metaRow}><TabIcon name="organizations" color={colors.faint} size={16} /><Text style={styles.meta} numberOfLines={1}>{task.customer?.name ?? t("agentTaskNoCustomer")}</Text></View>
              {task.syncState ? <SyncNotice state={task.syncState} /> : null}
              <View style={styles.cardFooter}>
                <Text style={styles.version}>{t("agentTaskVersion", { version: task.version })}</Text>
                {actionable ? <Pressable accessibilityRole="button" accessibilityLabel={action} disabled={busyId === task.id} onPress={(event) => { event.stopPropagation(); quickAction(task) }} style={[styles.action, task.persistedStatus === "IN_PROGRESS" && styles.actionDone]}><Text style={styles.actionText}>{busyId === task.id ? "…" : action}</Text></Pressable> : <TabIcon name="chevronRight" color={colors.primary} size={21} />}
              </View>
            </Pressable>
          )
        })}</View> : null}

        {visible.length === 0 && field.taskPhase !== "loading" ? (
          <View style={styles.empty}><View style={styles.emptyMark}><TabIcon name="check" color={colors.success} size={27} /></View><Text style={styles.emptyTitle}>{t("agentTasksEmpty")}</Text><Text style={styles.emptyHint}>{t("agentTasksEmptyHint")}</Text>{canCreateTask ? <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskCreate")} onPress={() => router.push("/(app)/field-tasks/new" as never)} style={styles.emptyButton}><TabIcon name="add" color={colors.headerText} size={18} /><Text style={styles.emptyButtonText}>{t("agentTaskCreate")}</Text></Pressable> : null}</View>
        ) : null}
        {field.taskPhase === "loading" ? <View style={styles.loading}>{[1, 2, 3].map((item) => <View key={item} style={styles.skeleton} />)}</View> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function SummaryMetric({ value, label, color }: { value: number; label: string; color: string }) {
  return <View style={styles.metric}><Text style={[styles.metricValue, { color }]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>
}

function FilterChip({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.filter, selected && styles.filterSelected]}><Text style={[styles.filterText, selected && styles.filterTextSelected]}>{label}</Text></Pressable>
}

function SyncNotice({ state }: { state: "PENDING" | "CONFLICT" | "REJECTED" }) {
  const conflict = state === "CONFLICT"
  const rejected = state === "REJECTED"
  const icon = state === "PENDING" ? "refresh" : "alert"
  const label = state === "PENDING" ? t("agentTaskOfflineQueued") : state === "CONFLICT" ? t("agentTaskSyncConflict") : t("agentTaskSyncRejected")
  const color = conflict || rejected ? colors.missed : colors.primary
  return <View style={[styles.syncNotice, conflict && styles.syncConflict, rejected && styles.syncRejected]}><TabIcon name={icon} color={color} size={15} /><Text style={[styles.syncText, (conflict || rejected) && styles.syncTextError]}>{label}</Text></View>
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { minHeight: "100%", paddingBottom: 34 }, content: { width: "100%" }, contentTablet: { maxWidth: 1_060, alignSelf: "center" },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "flex-start", gap: 10 }, back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }, headerBody: { flex: 1, minWidth: 0 }, eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.8 }, title: { color: colors.text, fontSize: 23, fontWeight: "900", marginTop: 2 }, subtitle: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 }, add: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  summary: { marginHorizontal: 14, marginTop: 16, borderRadius: radii.card, padding: 8, backgroundColor: colors.card, flexDirection: "row", ...cardShadow }, metric: { flex: 1, minHeight: 65, alignItems: "center", justifyContent: "center" }, metricValue: { fontSize: 22, fontWeight: "900" }, metricLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", marginTop: 2 },
  searchBox: { marginHorizontal: 14, marginTop: 14, minHeight: 47, borderRadius: 15, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 }, searchInput: { flex: 1, minHeight: 45, color: colors.text, fontSize: 13, paddingHorizontal: 8 }, filterSummary: { minHeight: 58, marginHorizontal: 14, marginTop: 10, borderRadius: 16, paddingHorizontal: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 9 }, filterSummaryIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, filterSummaryBody: { flex: 1, minWidth: 0 }, filterSummaryLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 }, filterSummaryValue: { color: colors.text, fontSize: 14, fontWeight: "900", marginTop: 2 }, filterSummaryChevron: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, filters: { marginHorizontal: 14, paddingTop: 9, flexDirection: "row", flexWrap: "wrap", gap: 8 }, filter: { minHeight: 44, borderRadius: radii.pill, paddingHorizontal: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }, filterSelected: { backgroundColor: colors.primary, borderColor: colors.primary }, filterText: { color: colors.muted, fontSize: 12, fontWeight: "900" }, filterTextSelected: { color: colors.headerText },
  taskList: { width: "100%" }, taskListTablet: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 14, paddingTop: 12, alignItems: "flex-start" }, card: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, ...cardShadow }, cardTablet: { flexBasis: "48%", flexGrow: 1, marginHorizontal: 0, marginTop: 0 }, pressed: { opacity: 0.75, transform: [{ scale: 0.993 }] }, cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 9 }, priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 }, cardBody: { flex: 1, minWidth: 0 }, cardTitle: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: "900" }, source: { color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 4 }, status: { maxWidth: 118, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 5 }, statusText: { fontSize: 11, fontWeight: "900" }, metaRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10 }, meta: { flex: 1, color: colors.muted, fontSize: 11, fontWeight: "700" }, overdue: { color: colors.missed }, syncNotice: { marginTop: 10, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 7, backgroundColor: colors.primarySoft, flexDirection: "row", alignItems: "center", gap: 6 }, syncConflict: { backgroundColor: colors.warningBg }, syncRejected: { backgroundColor: colors.dangerBg }, syncText: { color: colors.primary, fontSize: 11, fontWeight: "900" }, syncTextError: { color: colors.missed }, cardFooter: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, version: { color: colors.faint, fontSize: 11, fontWeight: "800" }, action: { minHeight: 44, borderRadius: 11, paddingHorizontal: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, actionDone: { backgroundColor: colors.success }, actionText: { color: colors.headerText, fontSize: 12, fontWeight: "900" },
  error: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.dangerBg }, errorText: { color: colors.missed, fontSize: 11, fontWeight: "800" }, empty: { margin: 14, minHeight: 300, borderRadius: radii.card, padding: 24, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", ...cardShadow }, emptyMark: { width: 58, height: 58, borderRadius: 20, backgroundColor: colors.successBg, alignItems: "center", justifyContent: "center" }, emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "900", textAlign: "center", marginTop: 14 }, emptyHint: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 6 }, emptyButton: { minHeight: 44, marginTop: 16, borderRadius: 13, paddingHorizontal: 17, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 }, emptyButtonText: { color: colors.headerText, fontSize: 11, fontWeight: "900" }, loading: { paddingHorizontal: 14, paddingTop: 8, gap: 10 }, skeleton: { height: 150, borderRadius: radii.card, backgroundColor: colors.skeleton },
})
