import { type ReactNode, useEffect, useState } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  enqueueFieldTaskEvent,
  enqueueFieldTaskUpdate,
  readFieldCache,
} from "../../../src/db/local-store"
import type {
  FieldAgentTaskEvent,
  FieldAgentTaskEventType,
  FieldAgentTaskPriority,
  FieldAgentTaskStatus,
  FieldAgentTasksData,
} from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import { FIELD_AGENT_TASKS_CACHE_KEY } from "../../../src/field/task-cache"
import { fieldErrorMessageKey, FIELD_TASK_ERROR_OVERRIDES } from "../../../src/field/error-message"
import { resolveFieldTaskToday, shiftFieldTaskDueDate } from "../../../src/field/task-time"
import { safeFieldBack } from "../../../src/navigation/safe-back"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { t, type MessageKey, useLocale } from "../../../src/i18n"
import { useSync } from "../../../src/sync/sync-context"
import { colors, cardShadow, radii } from "../../../src/theme"
import { TabIcon, type TabIconName } from "../../../src/components/TabIcon"
import { FieldScreenChrome } from "../../../src/components/FieldScreenChrome"
import { useResponsiveLayout } from "../../../src/layout/responsive"

type TaskDetailPanel = "tools" | "comment" | "evidence" | "timeline"

function statusLabel(status: FieldAgentTaskStatus): string {
  if (status === "PENDING") return t("agentTaskStatus_PENDING")
  if (status === "IN_PROGRESS") return t("agentTaskStatus_IN_PROGRESS")
  if (status === "COMPLETED") return t("agentTaskStatus_COMPLETED")
  if (status === "CANCELLED") return t("agentTaskStatus_CANCELLED")
  return t("agentTaskStatus_OVERDUE")
}

function statusTone(status: FieldAgentTaskStatus) {
  if (status === "OVERDUE") return { bg: colors.dangerBg, color: colors.missed }
  if (status === "IN_PROGRESS") return { bg: colors.infoBg, color: colors.info }
  if (status === "COMPLETED") return { bg: colors.successBg, color: colors.successDark }
  if (status === "CANCELLED") return { bg: colors.draftBg, color: colors.draft }
  return { bg: colors.warningBg, color: colors.warning }
}

function priorityLabel(priority: FieldAgentTaskPriority): string {
  if (priority === "LOW") return t("agentTaskPriority_LOW")
  if (priority === "MEDIUM") return t("agentTaskPriority_MEDIUM")
  if (priority === "HIGH") return t("agentTaskPriority_HIGH")
  return t("agentTaskPriority_URGENT")
}

function eventLabel(type: FieldAgentTaskEventType): string {
  if (type === "CREATED") return t("agentTaskEvent_CREATED")
  if (type === "ACCEPTED") return t("agentTaskEvent_ACCEPTED")
  if (type === "STARTED") return t("agentTaskEvent_STARTED")
  if (type === "COMPLETED") return t("agentTaskEvent_COMPLETED")
  if (type === "RESCHEDULED") return t("agentTaskEvent_RESCHEDULED")
  if (type === "COMMENTED") return t("agentTaskEvent_COMMENTED")
  if (type === "EVIDENCE_ADDED") return t("agentTaskEvent_EVIDENCE_ADDED")
  if (type === "COPIED") return t("agentTaskEvent_COPIED")
  if (type === "CANCELLED") return t("agentTaskEvent_CANCELLED")
  return t("agentTaskEvent_EDITED")
}

function evidenceSummary(event: FieldAgentTaskEvent): string | null {
  if (!event.evidence || typeof event.evidence !== "object" || Array.isArray(event.evidence)) return null
  const note = (event.evidence as Record<string, unknown>).note
  return typeof note === "string" ? note : null
}

export default function AgentTaskDetailScreen() {
  const locale = useLocale()
  const { taskId } = useLocalSearchParams<{ taskId: string }>()
  const field = useField()
  const layout = useResponsiveLayout()
  const { sync } = useSync()
  const tenantTimeZone = field.week?.timezone ?? field.workday?.timezone ?? field.profile?.todaySummary.timezone ?? "UTC"
  const tenantToday = resolveFieldTaskToday(
    field.week?.today ?? field.workday?.today ?? field.profile?.todaySummary.date,
    tenantTimeZone,
  )
  const task = field.agentTasks?.tasks.find((item) => item.id === taskId) ?? null
  const canCreateSelfTask = field.agentTasks?.capabilities.createSelfTask === true
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<FieldAgentTaskPriority>("MEDIUM")
  const [result, setResult] = useState("")
  const [comment, setComment] = useState("")
  const [evidence, setEvidence] = useState("")
  const [activePanel, setActivePanel] = useState<TaskDetailPanel | null>(null)

  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setDescription(task.description ?? "")
    setPriority(task.priority)
    setResult(task.result ?? "")
  }, [task?.id, task?.version])

  function applyCachedTasks() {
    const cached = readFieldCache<FieldAgentTasksData>(FIELD_AGENT_TASKS_CACHE_KEY)
    if (cached) field.applyLocalAgentTasks(cached.value)
  }

  async function flush() {
    await sync()
    await field.refreshAgentTasks()
  }

  async function updateTask(input: Omit<Parameters<typeof enqueueFieldTaskUpdate>[0], "taskId" | "expectedVersion">): Promise<boolean> {
    if (!task) return false
    setBusy(true)
    setError(null)
    try {
      enqueueFieldTaskUpdate({ taskId: task.id, expectedVersion: task.version, ...input })
      applyCachedTasks()
      await flush()
      return true
    } catch (cause) {
      setError(fieldErrorMessageKey(cause, "agentTaskActionFailed", FIELD_TASK_ERROR_OVERRIDES))
      applyCachedTasks()
      return false
    } finally {
      setBusy(false)
    }
  }

  async function addEvent(type: "COMMENTED" | "EVIDENCE_ADDED") {
    if (!task) return
    const text = type === "COMMENTED" ? comment.trim() : evidence.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    try {
      enqueueFieldTaskEvent({
        taskId: task.id,
        type,
        occurredAt: new Date().toISOString(),
        comment: type === "COMMENTED" ? text : null,
        evidence: type === "EVIDENCE_ADDED" ? { note: text, source: "mobile-agent" } : null,
      })
      if (type === "COMMENTED") setComment("")
      else setEvidence("")
      applyCachedTasks()
      Alert.alert(type === "COMMENTED" ? t("agentTaskCommentSaved") : t("agentTaskEvidenceSaved"))
      await flush()
    } catch (cause) {
      setError(fieldErrorMessageKey(cause, "agentTaskActionFailed", FIELD_TASK_ERROR_OVERRIDES))
      applyCachedTasks()
    } finally {
      setBusy(false)
    }
  }

  function complete() {
    Alert.alert(t("agentTaskCompleteConfirmTitle"), t("agentTaskCompleteConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("agentTaskComplete"), onPress: () => void updateTask({ status: "COMPLETED", result: result.trim() || null }) },
    ])
  }

  function cancelTask() {
    Alert.alert(t("agentTaskCancelConfirmTitle"), t("agentTaskCancelConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("agentTaskCancel"), style: "destructive", onPress: () => void updateTask({ status: "CANCELLED" }) },
    ])
  }

  function hasUnsavedTaskInput() {
    if (!task) return false
    return (editing && (
      title !== task.title ||
      description !== (task.description ?? "") ||
      priority !== task.priority
    )) ||
      result !== (task.result ?? "") ||
      Boolean(comment.trim()) ||
      Boolean(evidence.trim())
  }

  function togglePanel(panel: TaskDetailPanel) {
    setActivePanel((current) => current === panel ? null : panel)
  }

  function goBack() {
    const leave = () => safeFieldBack("/(app)/field-tasks")
    if (!hasUnsavedTaskInput()) {
      leave()
      return
    }
    Alert.alert(t("agentTaskDiscardEditTitle"), t("agentTaskDiscardEditBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("agentTaskDiscardEditConfirm"), style: "destructive", onPress: leave },
    ])
  }

  if (!task) {
    return <SafeAreaView style={styles.root} edges={["top"]}><FieldScreenChrome /><View style={styles.missing}><Text style={styles.missingTitle}>{field.taskPhase === "loading" ? "…" : t("agentTasksEmpty")}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("back")} accessibilityState={{ disabled: false }} onPress={goBack} style={styles.backButton}><Text style={styles.backButtonText}>{t("back")}</Text></Pressable></View></SafeAreaView>
  }

  const tone = statusTone(task.status)
  const terminal = task.persistedStatus === "COMPLETED" || task.persistedStatus === "CANCELLED"

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <FieldScreenChrome />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.content, layout.isTablet && styles.contentTablet]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} accessibilityState={{ disabled: false }} onPress={goBack} style={styles.back}>
            <TabIcon name="chevronLeft" color={colors.text} size={21} />
          </Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("agentTasksTitle").toUpperCase()}</Text>
            <Text style={styles.headerTitle}>{t("agentTaskDetails")}</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroTop}><View style={[styles.status, { backgroundColor: tone.bg }]}><Text style={[styles.statusText, { color: tone.color }]}>{statusLabel(task.status)}</Text></View><Text style={styles.version}>{t("agentTaskVersion", { version: task.version })}</Text></View>
          {editing ? <>
            <TextInput accessibilityLabel={t("agentTaskTitleLabel")} accessibilityHint={t("agentTaskPersonalHint")} value={title} onChangeText={setTitle} style={styles.editTitle} />
            <TextInput accessibilityLabel={t("agentTaskDescriptionLabel")} accessibilityHint={t("agentTaskPersonalHint")} value={description} onChangeText={setDescription} multiline textAlignVertical="top" style={styles.editDescription} />
            <View style={styles.priorityRow}>{(["LOW", "MEDIUM", "HIGH", "URGENT"] as FieldAgentTaskPriority[]).map((value) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={priorityLabel(value)} accessibilityState={{ selected: priority === value, disabled: false }} onPress={() => setPriority(value)} style={[styles.priorityChip, priority === value && styles.priorityChipSelected]}><Text style={[styles.priorityChipText, priority === value && styles.priorityChipTextSelected]}>{priorityLabel(value)}</Text></Pressable>)}</View>
            <View style={styles.editActions}>
              <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskCancelEdit")} accessibilityState={{ disabled: false }} onPress={() => { setEditing(false); setTitle(task.title); setDescription(task.description ?? ""); setPriority(task.priority) }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t("agentTaskCancelEdit")}</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskSave")} accessibilityState={{ disabled: !title.trim() || busy, busy }} disabled={!title.trim() || busy} onPress={() => void updateTask({ title: title.trim(), description: description.trim() || null, priority }).then((saved) => { if (saved) setEditing(false) })} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{t("agentTaskSave")}</Text></Pressable>
            </View>
          </> : <><Text style={styles.taskTitle}>{task.title}</Text>{task.description ? <Text style={styles.description}>{task.description}</Text> : null}<Text style={styles.source}>{task.canEditContent ? t("agentTaskPersonal") : t("agentTaskAssigned")} · {priorityLabel(task.priority)}</Text></>}
        </View>

        <View style={styles.infoCard}>
          <InfoRow icon="week" label={t("agentTaskDueLabel")} value={task.dueDate ? formatShortDateTime(task.dueDate, locale, tenantTimeZone) : t("agentTaskDueNone")} danger={task.status === "OVERDUE"} />
          {task.customer ? <InfoLinkRow icon="organizations" label={t("agentTaskCustomerLabel")} value={task.customer.name} hint={t("agentTaskCustomerOpenHint")} onPress={() => router.push(`/(app)/organizations/${task.customer!.id}` as never)} /> : <InfoRow icon="organizations" label={t("agentTaskCustomerLabel")} value={t("agentTaskNoCustomer")} />}
          {task.visitId ? <InfoLinkRow icon="visit" label={t("agentTaskVisitLabel")} value={t("openVisit")} hint={t("agentTaskVisitOpenHint")} onPress={() => router.push(`/(app)/field-visits/${task.visitId}` as never)} /> : null}
          {task.recurrenceRule ? <InfoRow icon="refresh" label={t("agentTaskRecurrenceLabel")} value={task.recurrenceRule === "DAILY" ? t("agentTaskRecurrenceDaily") : task.recurrenceRule === "WEEKLY" ? t("agentTaskRecurrenceWeekly") : t("agentTaskRecurrenceMonthly")} /> : null}
        </View>

        {task.syncState ? <TaskSyncNotice state={task.syncState} /> : null}
        <View style={styles.policy}><Text style={styles.policyText}>{task.canEditContent ? t("agentTaskPersonalHint") : t("agentTaskManagerHint")}</Text></View>

        {!terminal ? <View style={styles.actionCard}>
          {!task.acceptedAt && task.persistedStatus === "PENDING" ? <PrimaryAction label={t("agentTaskAccept")} busy={busy} onPress={() => void updateTask({ acceptedAt: new Date().toISOString() })} /> : task.persistedStatus === "PENDING" || task.status === "OVERDUE" ? <PrimaryAction label={t("agentTaskStart")} busy={busy} onPress={() => void updateTask({ status: "IN_PROGRESS" })} /> : <PrimaryAction label={t("agentTaskComplete")} busy={busy} success onPress={complete} />}
        </View> : null}

        {task.persistedStatus === "IN_PROGRESS" ? <View style={styles.formCard}><Text style={styles.formTitle}>{t("agentTaskResult")}</Text><TextInput accessibilityLabel={t("agentTaskResult")} accessibilityHint={t("agentTaskCompleteConfirmBody")} value={result} onChangeText={setResult} multiline textAlignVertical="top" placeholder={t("agentTaskEvidencePlaceholder")} placeholderTextColor={colors.faint} style={styles.textarea} /></View> : null}

        <TaskDisclosure
          title={t("agentTaskMoreActions")}
          hint={t("agentTaskMoreActionsHint")}
          icon="tasks"
          open={activePanel === "tools"}
          onPress={() => togglePanel("tools")}
        >
          {!terminal ? <View style={styles.quickRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskTomorrow")} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => void updateTask({ dueDate: shiftFieldTaskDueDate(task.dueDate, 1, tenantToday, tenantTimeZone) })} style={styles.quickButton}><Text style={styles.quickButtonText}>{t("agentTaskTomorrow")}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskNextWeek")} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => void updateTask({ dueDate: shiftFieldTaskDueDate(task.dueDate, 7, tenantToday, tenantTimeZone) })} style={styles.quickButton}><Text style={styles.quickButtonText}>{t("agentTaskNextWeek")}</Text></Pressable>
            {task.canEditContent ? <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskEdit")} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => { setEditing(true); setActivePanel(null) }} style={styles.quickButton}><Text style={styles.quickButtonText}>{t("agentTaskEdit")}</Text></Pressable> : null}
          </View> : null}
          <View style={styles.bottomActions}>
            {canCreateSelfTask ? <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskCopy")} accessibilityState={{ disabled: false }} onPress={() => router.push(`/(app)/field-tasks/new?copyFrom=${task.id}` as never)} style={styles.bottomSecondary}>
              <TabIcon name="copy" color={colors.primary} size={17} />
              <Text style={styles.bottomSecondaryText}>{t("agentTaskCopy")}</Text>
            </Pressable> : null}
            {task.canEditContent && !terminal ? <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskCancel")} accessibilityState={{ disabled: false }} onPress={cancelTask} style={styles.bottomDanger}><Text style={styles.bottomDangerText}>{t("agentTaskCancel")}</Text></Pressable> : null}
          </View>
        </TaskDisclosure>

        {!terminal ? <>
          <TaskDisclosure
            title={t("agentTaskComment")}
            hint={t("agentTaskCommentPlaceholder")}
            icon="inbox"
            open={activePanel === "comment"}
            onPress={() => togglePanel("comment")}
          >
            <TextInput accessibilityLabel={t("agentTaskComment")} accessibilityHint={t("agentTaskCommentPlaceholder")} value={comment} onChangeText={setComment} multiline textAlignVertical="top" placeholder={t("agentTaskCommentPlaceholder")} placeholderTextColor={colors.faint} style={styles.textarea} />
            <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskAddComment")} accessibilityState={{ disabled: !comment.trim() || busy, busy }} disabled={!comment.trim() || busy} onPress={() => void addEvent("COMMENTED")} style={[styles.formButton, (!comment.trim() || busy) && styles.disabled]}><Text style={styles.formButtonText}>{t("agentTaskAddComment")}</Text></Pressable>
          </TaskDisclosure>
          <TaskDisclosure
            title={t("agentTaskEvidence")}
            hint={t("agentTaskEvidencePlaceholder")}
            icon="check"
            open={activePanel === "evidence"}
            onPress={() => togglePanel("evidence")}
          >
            <TextInput accessibilityLabel={t("agentTaskEvidence")} accessibilityHint={t("agentTaskEvidencePlaceholder")} value={evidence} onChangeText={setEvidence} multiline textAlignVertical="top" placeholder={t("agentTaskEvidencePlaceholder")} placeholderTextColor={colors.faint} style={styles.textarea} />
            <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskAddEvidence")} accessibilityState={{ disabled: !evidence.trim() || busy, busy }} disabled={!evidence.trim() || busy} onPress={() => void addEvent("EVIDENCE_ADDED")} style={[styles.formButton, styles.evidenceButton, (!evidence.trim() || busy) && styles.disabled]}><Text style={styles.formButtonText}>{t("agentTaskAddEvidence")}</Text></Pressable>
          </TaskDisclosure>
        </> : null}

        {error ? <View style={styles.error}><Text style={styles.errorText}>{t(error)}</Text></View> : null}

        <TaskDisclosure
          title={t("agentTaskTimeline")}
          icon="tasks"
          count={task.events.length}
          open={activePanel === "timeline"}
          onPress={() => togglePanel("timeline")}
        >
          <View style={styles.timelineCard}>{task.events.length === 0 ? <Text style={styles.emptyTimeline}>{t("agentTaskTimelineEmpty")}</Text> : task.events.map((event, index) => <View key={event.id} style={styles.event}><View style={styles.eventRail}><View style={[styles.eventDot, event.syncState && styles.eventDotPending]} />{index < task.events.length - 1 ? <View style={styles.eventLine} /> : null}</View><View style={styles.eventBody}><Text style={styles.eventTitle}>{eventLabel(event.type)}</Text><Text style={styles.eventTime}>{formatShortDateTime(event.occurredAt, locale, tenantTimeZone)}{event.syncState ? ` · ${t("agentTaskOfflineQueued")}` : ""}</Text>{event.comment ? <Text style={styles.eventText}>{event.comment}</Text> : null}{evidenceSummary(event) ? <Text style={styles.eventEvidence}>{evidenceSummary(event)}</Text> : null}</View></View>)}</View>
        </TaskDisclosure>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function InfoRow({ icon, label, value, danger }: { icon: TabIconName; label: string; value: string; danger?: boolean }) { return <View style={styles.infoRow}><View style={styles.infoIcon}><TabIcon name={icon} color={danger ? colors.missed : colors.primary} size={18} /></View><View style={styles.infoBody}><Text style={styles.infoLabel}>{label}</Text><Text style={[styles.infoValue, danger && styles.infoDanger]}>{value}</Text></View></View> }
function InfoLinkRow({ icon, label, value, hint, onPress }: { icon: TabIconName; label: string; value: string; hint: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} accessibilityHint={hint} onPress={onPress} style={({ pressed }) => [styles.infoRow, styles.infoLinkRow, pressed && styles.pressed]}><View accessible={false} style={styles.infoIcon}><TabIcon name={icon} color={colors.primary} size={18} /></View><View accessible={false} style={styles.infoBody}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View><View accessible={false} style={styles.infoLinkChevron}><TabIcon name="chevronRight" color={colors.faint} size={20} /></View></Pressable>
}
function TaskSyncNotice({ state }: { state: "PENDING" | "CONFLICT" | "REJECTED" }) {
  const error = state !== "PENDING"
  const text = state === "PENDING" ? t("agentTaskOfflineQueued") : state === "CONFLICT" ? t("agentTaskConflictHint") : t("agentTaskSyncRejected")
  if (!error) return <View style={styles.syncNotice}><Text style={styles.syncNoticeText}>{text}</Text></View>
  return <Pressable accessibilityRole="button" accessibilityLabel={text} accessibilityHint={t("syncCenterOpen")} onPress={() => router.push("/(app)/sync-center" as never)} style={({ pressed }) => [styles.syncNotice, styles.syncError, styles.syncNoticeAction, pressed && styles.pressed]}><Text style={[styles.syncNoticeText, styles.syncErrorText]}>{text}</Text><TabIcon name="chevronRight" color={colors.missed} size={18} /></Pressable>
}
function PrimaryAction({ label, busy, success, onPress }: { label: string; busy: boolean; success?: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onPress} style={[styles.mainAction, success && styles.mainActionSuccess, busy && styles.disabled]}><Text style={styles.mainActionText}>{busy ? "…" : label}</Text></Pressable> }

function TaskDisclosure({
  title,
  hint,
  icon,
  count,
  open,
  onPress,
  children,
}: {
  title: string
  hint?: string
  icon: TabIconName
  count?: number
  open: boolean
  onPress: () => void
  children: ReactNode
}) {
  return (
    <View style={styles.disclosure}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={onPress}
        style={({ pressed }) => [styles.disclosureToggle, pressed && styles.pressed]}
      >
        <View accessible={false} style={styles.disclosureIcon}><TabIcon name={icon} color={colors.primary} size={18} /></View>
        <View style={styles.disclosureBody}>
          <Text style={styles.disclosureTitle}>{title}</Text>
          {hint ? <Text numberOfLines={1} style={styles.disclosureHint}>{hint}</Text> : null}
        </View>
        {count !== undefined ? <View accessible={false} style={styles.disclosureCount}><Text style={styles.disclosureCountText}>{count}</Text></View> : null}
        <View accessible={false} style={styles.disclosureChevron}><TabIcon name={open ? "chevronUp" : "chevronDown"} color={colors.primary} size={20} /></View>
      </Pressable>
      {open ? <View style={styles.disclosureContent}>{children}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 38 },
  content: { width: "100%" },
  contentTablet: { maxWidth: 1_060, alignSelf: "center" },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  headerBody: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.7 },
  headerTitle: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: 2 },
  hero: { marginHorizontal: 14, marginTop: 14, borderRadius: 22, padding: 17, backgroundColor: colors.card, ...cardShadow },
  heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  status: { borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  statusText: { fontSize: 11, fontWeight: "900" },
  version: { color: colors.faint, fontSize: 11, fontWeight: "800" },
  taskTitle: { color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: "900", marginTop: 15 },
  description: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 9 },
  source: { color: colors.primary, fontSize: 11, fontWeight: "900", marginTop: 14 },
  editTitle: { minHeight: 48, marginTop: 12, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 11, color: colors.text, fontSize: 15, fontWeight: "900" },
  editDescription: { minHeight: 86, marginTop: 9, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, padding: 11, color: colors.text, fontSize: 13 },
  priorityRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
  priorityChip: { minHeight: 44, borderRadius: radii.pill, paddingHorizontal: 10, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  priorityChipSelected: { backgroundColor: colors.primary },
  priorityChipText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  priorityChipTextSelected: { color: colors.headerText },
  editActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  secondaryButton: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  primaryButton: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: colors.headerText, fontSize: 12, fontWeight: "900" },
  infoCard: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, gap: 12 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoLinkRow: { minHeight: 44, marginVertical: -4, paddingVertical: 4, borderRadius: 12 },
  infoIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  infoBody: { flex: 1 },
  infoLabel: { color: colors.faint, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.4 },
  infoValue: { color: colors.text, fontSize: 12, fontWeight: "800", marginTop: 2 },
  infoLinkChevron: { width: 28, height: 44, alignItems: "center", justifyContent: "center" },
  infoDanger: { color: colors.missed },
  syncNotice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.primarySoft },
  syncError: { backgroundColor: colors.dangerBg },
  syncNoticeAction: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  syncNoticeText: { color: colors.primary, fontSize: 11, fontWeight: "800" },
  syncErrorText: { color: colors.missed },
  policy: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.infoBg },
  policyText: { color: colors.info, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  actionCard: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.card, padding: 12, backgroundColor: colors.card, ...cardShadow },
  mainAction: { minHeight: 52, borderRadius: 15, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  mainActionSuccess: { backgroundColor: colors.success },
  mainActionText: { color: colors.headerText, fontSize: 14, fontWeight: "900" },
  disclosure: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.card, backgroundColor: colors.card, overflow: "hidden", ...cardShadow },
  disclosureToggle: { minHeight: 58, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  disclosureIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  disclosureBody: { flex: 1, minWidth: 0 },
  disclosureTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  disclosureHint: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  disclosureCount: { minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 7, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  disclosureCountText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  disclosureChevron: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  disclosureContent: { borderTopWidth: 1, borderTopColor: colors.border, padding: 12 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.993 }] },
  quickRow: { flexDirection: "row", gap: 7 },
  quickButton: { flex: 1, minHeight: 44, borderRadius: 11, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  quickButtonText: { color: colors.primary, fontSize: 11, fontWeight: "900", textAlign: "center" },
  formCard: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, ...cardShadow },
  formTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  textarea: { minHeight: 83, marginTop: 9, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, padding: 11, color: colors.text, fontSize: 13, lineHeight: 19 },
  formButton: { alignSelf: "flex-end", minHeight: 44, marginTop: 9, borderRadius: 12, paddingHorizontal: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  evidenceButton: { backgroundColor: colors.info },
  formButtonText: { color: colors.headerText, fontSize: 12, fontWeight: "900" },
  error: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.dangerBg },
  errorText: { color: colors.missed, fontSize: 11, fontWeight: "800" },
  timelineCard: { borderRadius: 14, padding: 2 },
  event: { flexDirection: "row", gap: 10, minHeight: 54 },
  eventRail: { width: 14, alignItems: "center" },
  eventDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary, marginTop: 4 },
  eventDotPending: { backgroundColor: colors.warning },
  eventLine: { width: 2, flex: 1, backgroundColor: colors.border, marginTop: 3 },
  eventBody: { flex: 1, paddingBottom: 14 },
  eventTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  eventTime: { color: colors.faint, fontSize: 11, fontWeight: "700", marginTop: 3 },
  eventText: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  eventEvidence: { color: colors.info, fontSize: 11, lineHeight: 16, marginTop: 6, padding: 8, borderRadius: 9, backgroundColor: colors.infoBg },
  emptyTimeline: { color: colors.muted, fontSize: 11, textAlign: "center", paddingVertical: 20 },
  bottomActions: { marginTop: 10, flexDirection: "row", gap: 8 },
  bottomSecondary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  bottomSecondaryText: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  bottomDanger: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: colors.dangerBg, alignItems: "center", justifyContent: "center" },
  bottomDangerText: { color: colors.missed, fontSize: 12, fontWeight: "900" },
  disabled: { opacity: 0.4 },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  missingTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  backButton: { minHeight: 44, marginTop: 15, borderRadius: 13, paddingHorizontal: 18, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  backButtonText: { color: colors.headerText, fontSize: 12, fontWeight: "900" },
})
