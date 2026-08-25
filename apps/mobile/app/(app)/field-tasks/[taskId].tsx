import { useEffect, useState } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  enqueueFieldTaskEvent,
  enqueueFieldTaskUpdate,
  readFieldCache,
} from "../../../src/db/local-store"
import type {
  FieldAgentTask,
  FieldAgentTaskEvent,
  FieldAgentTaskEventType,
  FieldAgentTaskPriority,
  FieldAgentTaskStatus,
  FieldAgentTasksData,
} from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import { FIELD_AGENT_TASKS_CACHE_KEY } from "../../../src/field/task-cache"
import { fieldErrorMessage, FIELD_TASK_ERROR_OVERRIDES } from "../../../src/field/error-message"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { t, useLocale } from "../../../src/i18n"
import { useSync } from "../../../src/sync/sync-context"
import { colors, cardShadow, radii } from "../../../src/theme"
import { TabIcon, type TabIconName } from "../../../src/components/TabIcon"

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

function shiftDueDate(task: FieldAgentTask, days: number): string {
  const previous = task.dueDate ? new Date(task.dueDate) : null
  const target = new Date()
  target.setDate(target.getDate() + days)
  target.setHours(previous?.getHours() ?? 9, previous?.getMinutes() ?? 0, 0, 0)
  return target.toISOString()
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
  const { sync } = useSync()
  const task = field.agentTasks?.tasks.find((item) => item.id === taskId) ?? null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<FieldAgentTaskPriority>("MEDIUM")
  const [result, setResult] = useState("")
  const [comment, setComment] = useState("")
  const [evidence, setEvidence] = useState("")

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

  async function updateTask(input: Omit<Parameters<typeof enqueueFieldTaskUpdate>[0], "taskId" | "expectedVersion">) {
    if (!task) return
    setBusy(true)
    setError(null)
    try {
      enqueueFieldTaskUpdate({ taskId: task.id, expectedVersion: task.version, ...input })
      applyCachedTasks()
      await flush()
    } catch (cause) {
      setError(fieldErrorMessage(cause, "agentTaskActionFailed", FIELD_TASK_ERROR_OVERRIDES))
      applyCachedTasks()
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
      setError(fieldErrorMessage(cause, "agentTaskActionFailed", FIELD_TASK_ERROR_OVERRIDES))
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

  if (!task) {
    return <SafeAreaView style={styles.root} edges={["top"]}><View style={styles.missing}><Text style={styles.missingTitle}>{field.taskPhase === "loading" ? "…" : t("agentTasksEmpty")}</Text><Pressable onPress={() => router.back()} style={styles.backButton}><Text style={styles.backButtonText}>{t("back")}</Text></Pressable></View></SafeAreaView>
  }

  const tone = statusTone(task.status)
  const terminal = task.persistedStatus === "COMPLETED" || task.persistedStatus === "CANCELLED"

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.back}>
            <TabIcon name="chevronLeft" color={colors.text} size={21} />
          </Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("agentTasksTitle").toUpperCase()}</Text>
            <Text style={styles.headerTitle}>{t("agentTaskDetails")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskCopy")} onPress={() => router.push(`/(app)/field-tasks/new?copyFrom=${task.id}` as never)} style={styles.copy}>
            <TabIcon name="copy" color={colors.primary} size={20} />
          </Pressable>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroTop}><View style={[styles.status, { backgroundColor: tone.bg }]}><Text style={[styles.statusText, { color: tone.color }]}>{statusLabel(task.status)}</Text></View><Text style={styles.version}>{t("agentTaskVersion", { version: task.version })}</Text></View>
          {editing ? <><TextInput value={title} onChangeText={setTitle} style={styles.editTitle} /><TextInput value={description} onChangeText={setDescription} multiline textAlignVertical="top" style={styles.editDescription} /><View style={styles.priorityRow}>{(["LOW", "MEDIUM", "HIGH", "URGENT"] as FieldAgentTaskPriority[]).map((value) => <Pressable key={value} onPress={() => setPriority(value)} style={[styles.priorityChip, priority === value && styles.priorityChipSelected]}><Text style={[styles.priorityChipText, priority === value && styles.priorityChipTextSelected]}>{priorityLabel(value)}</Text></Pressable>)}</View><View style={styles.editActions}><Pressable onPress={() => { setEditing(false); setTitle(task.title); setDescription(task.description ?? ""); setPriority(task.priority) }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t("agentTaskCancelEdit")}</Text></Pressable><Pressable disabled={!title.trim() || busy} onPress={() => void updateTask({ title: title.trim(), description: description.trim() || null, priority }).then(() => setEditing(false))} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{t("agentTaskSave")}</Text></Pressable></View></> : <><Text style={styles.taskTitle}>{task.title}</Text>{task.description ? <Text style={styles.description}>{task.description}</Text> : null}<Text style={styles.source}>{task.canEditContent ? t("agentTaskPersonal") : t("agentTaskAssigned")} · {priorityLabel(task.priority)}</Text></>}
        </View>

        <View style={styles.infoCard}>
          <InfoRow icon="week" label={t("agentTaskDueLabel")} value={task.dueDate ? formatShortDateTime(task.dueDate, locale) : t("agentTaskDueNone")} danger={task.status === "OVERDUE"} />
          <InfoRow icon="organizations" label={t("agentTaskCustomerLabel")} value={task.customer?.name ?? t("agentTaskNoCustomer")} />
          {task.recurrenceRule ? <InfoRow icon="refresh" label={t("agentTaskRecurrenceLabel")} value={task.recurrenceRule === "DAILY" ? t("agentTaskRecurrenceDaily") : task.recurrenceRule === "WEEKLY" ? t("agentTaskRecurrenceWeekly") : t("agentTaskRecurrenceMonthly")} /> : null}
        </View>

        {task.syncState ? <View style={[styles.syncNotice, task.syncState !== "PENDING" && styles.syncError]}><Text style={[styles.syncNoticeText, task.syncState !== "PENDING" && styles.syncErrorText]}>{task.syncState === "PENDING" ? t("agentTaskOfflineQueued") : task.syncState === "CONFLICT" ? t("agentTaskConflictHint") : t("agentTaskSyncRejected")}</Text></View> : null}
        <View style={styles.policy}><Text style={styles.policyText}>{task.canEditContent ? t("agentTaskPersonalHint") : t("agentTaskManagerHint")}</Text></View>

        {!terminal ? <View style={styles.actionCard}>
          {!task.acceptedAt && task.persistedStatus === "PENDING" ? <PrimaryAction label={t("agentTaskAccept")} busy={busy} onPress={() => void updateTask({ acceptedAt: new Date().toISOString() })} /> : task.persistedStatus === "PENDING" || task.status === "OVERDUE" ? <PrimaryAction label={t("agentTaskStart")} busy={busy} onPress={() => void updateTask({ status: "IN_PROGRESS" })} /> : <PrimaryAction label={t("agentTaskComplete")} busy={busy} success onPress={complete} />}
          <View style={styles.quickRow}><Pressable disabled={busy} onPress={() => void updateTask({ dueDate: shiftDueDate(task, 1) })} style={styles.quickButton}><Text style={styles.quickButtonText}>{t("agentTaskTomorrow")}</Text></Pressable><Pressable disabled={busy} onPress={() => void updateTask({ dueDate: shiftDueDate(task, 7) })} style={styles.quickButton}><Text style={styles.quickButtonText}>{t("agentTaskNextWeek")}</Text></Pressable>{task.canEditContent ? <Pressable disabled={busy} onPress={() => setEditing(true)} style={styles.quickButton}><Text style={styles.quickButtonText}>{t("agentTaskEdit")}</Text></Pressable> : null}</View>
        </View> : null}

        {task.persistedStatus === "IN_PROGRESS" ? <View style={styles.formCard}><Text style={styles.formTitle}>{t("agentTaskResult")}</Text><TextInput value={result} onChangeText={setResult} multiline textAlignVertical="top" placeholder={t("agentTaskEvidencePlaceholder")} placeholderTextColor={colors.faint} style={styles.textarea} /></View> : null}

        {!terminal ? <><View style={styles.formCard}><Text style={styles.formTitle}>{t("agentTaskComment")}</Text><TextInput value={comment} onChangeText={setComment} multiline textAlignVertical="top" placeholder={t("agentTaskCommentPlaceholder")} placeholderTextColor={colors.faint} style={styles.textarea} /><Pressable disabled={!comment.trim() || busy} onPress={() => void addEvent("COMMENTED")} style={[styles.formButton, (!comment.trim() || busy) && styles.disabled]}><Text style={styles.formButtonText}>{t("agentTaskAddComment")}</Text></Pressable></View><View style={styles.formCard}><Text style={styles.formTitle}>{t("agentTaskEvidence")}</Text><TextInput value={evidence} onChangeText={setEvidence} multiline textAlignVertical="top" placeholder={t("agentTaskEvidencePlaceholder")} placeholderTextColor={colors.faint} style={styles.textarea} /><Pressable disabled={!evidence.trim() || busy} onPress={() => void addEvent("EVIDENCE_ADDED")} style={[styles.formButton, styles.evidenceButton, (!evidence.trim() || busy) && styles.disabled]}><Text style={styles.formButtonText}>{t("agentTaskAddEvidence")}</Text></Pressable></View></> : null}

        {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}

        <View style={styles.timelineHeader}><Text style={styles.sectionTitle}>{t("agentTaskTimeline")}</Text><View style={styles.eventCount}><Text style={styles.eventCountText}>{task.events.length}</Text></View></View>
        <View style={styles.timelineCard}>{task.events.length === 0 ? <Text style={styles.emptyTimeline}>{t("agentTaskTimelineEmpty")}</Text> : task.events.map((event, index) => <View key={event.id} style={styles.event}><View style={styles.eventRail}><View style={[styles.eventDot, event.syncState && styles.eventDotPending]} />{index < task.events.length - 1 ? <View style={styles.eventLine} /> : null}</View><View style={styles.eventBody}><Text style={styles.eventTitle}>{eventLabel(event.type)}</Text><Text style={styles.eventTime}>{formatShortDateTime(event.occurredAt, locale)}{event.syncState ? ` · ${t("agentTaskOfflineQueued")}` : ""}</Text>{event.comment ? <Text style={styles.eventText}>{event.comment}</Text> : null}{evidenceSummary(event) ? <Text style={styles.eventEvidence}>{evidenceSummary(event)}</Text> : null}</View></View>)}</View>

        <View style={styles.bottomActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskCopy")} onPress={() => router.push(`/(app)/field-tasks/new?copyFrom=${task.id}` as never)} style={styles.bottomSecondary}>
            <TabIcon name="copy" color={colors.primary} size={17} />
            <Text style={styles.bottomSecondaryText}>{t("agentTaskCopy")}</Text>
          </Pressable>
          {task.canEditContent && !terminal ? <Pressable accessibilityRole="button" onPress={cancelTask} style={styles.bottomDanger}><Text style={styles.bottomDangerText}>{t("agentTaskCancel")}</Text></Pressable> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function InfoRow({ icon, label, value, danger }: { icon: TabIconName; label: string; value: string; danger?: boolean }) { return <View style={styles.infoRow}><View style={styles.infoIcon}><TabIcon name={icon} color={danger ? colors.missed : colors.primary} size={18} /></View><View style={styles.infoBody}><Text style={styles.infoLabel}>{label}</Text><Text style={[styles.infoValue, danger && styles.infoDanger]}>{value}</Text></View></View> }
function PrimaryAction({ label, busy, success, onPress }: { label: string; busy: boolean; success?: boolean; onPress: () => void }) { return <Pressable disabled={busy} onPress={onPress} style={[styles.mainAction, success && styles.mainActionSuccess, busy && styles.disabled]}><Text style={styles.mainActionText}>{busy ? "…" : label}</Text></Pressable> }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { minHeight: "100%", paddingBottom: 38 }, header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 }, back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }, headerBody: { flex: 1 }, eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.7 }, headerTitle: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: 2 }, copy: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  hero: { marginHorizontal: 14, marginTop: 14, borderRadius: 22, padding: 17, backgroundColor: colors.card, ...cardShadow }, heroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, status: { borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 }, statusText: { fontSize: 9, fontWeight: "900" }, version: { color: colors.faint, fontSize: 8, fontWeight: "800" }, taskTitle: { color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: "900", marginTop: 15 }, description: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 9 }, source: { color: colors.primary, fontSize: 9, fontWeight: "900", marginTop: 14 }, editTitle: { minHeight: 48, marginTop: 12, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 11, color: colors.text, fontSize: 14, fontWeight: "900" }, editDescription: { minHeight: 86, marginTop: 9, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, padding: 11, color: colors.text, fontSize: 12 }, priorityRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 }, priorityChip: { minHeight: 40, borderRadius: radii.pill, paddingHorizontal: 10, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }, priorityChipSelected: { backgroundColor: colors.primary }, priorityChipText: { color: colors.muted, fontSize: 9, fontWeight: "800" }, priorityChipTextSelected: { color: colors.headerText }, editActions: { flexDirection: "row", gap: 8, marginTop: 12 }, secondaryButton: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }, secondaryButtonText: { color: colors.muted, fontSize: 10, fontWeight: "900" }, primaryButton: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, primaryButtonText: { color: colors.headerText, fontSize: 10, fontWeight: "900" },
  infoCard: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, gap: 12 }, infoRow: { flexDirection: "row", alignItems: "center", gap: 10 }, infoIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, infoBody: { flex: 1 }, infoLabel: { color: colors.faint, fontSize: 8, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.4 }, infoValue: { color: colors.text, fontSize: 11, fontWeight: "800", marginTop: 2 }, infoDanger: { color: colors.missed }, syncNotice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.primarySoft }, syncError: { backgroundColor: colors.dangerBg }, syncNoticeText: { color: colors.primary, fontSize: 10, fontWeight: "800" }, syncErrorText: { color: colors.missed }, policy: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.infoBg }, policyText: { color: colors.info, fontSize: 9, lineHeight: 14, fontWeight: "700" },
  actionCard: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.card, padding: 12, backgroundColor: colors.card, ...cardShadow }, mainAction: { minHeight: 50, borderRadius: 15, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, mainActionSuccess: { backgroundColor: colors.success }, mainActionText: { color: colors.headerText, fontSize: 13, fontWeight: "900" }, quickRow: { flexDirection: "row", gap: 7, marginTop: 8 }, quickButton: { flex: 1, minHeight: 44, borderRadius: 11, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }, quickButtonText: { color: colors.primary, fontSize: 9, fontWeight: "900", textAlign: "center" },
  formCard: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.card, padding: 13, backgroundColor: colors.card }, formTitle: { color: colors.text, fontSize: 13, fontWeight: "900" }, textarea: { minHeight: 83, marginTop: 9, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, padding: 11, color: colors.text, fontSize: 11, lineHeight: 17 }, formButton: { alignSelf: "flex-end", minHeight: 44, marginTop: 9, borderRadius: 12, paddingHorizontal: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, evidenceButton: { backgroundColor: colors.info }, formButtonText: { color: colors.headerText, fontSize: 10, fontWeight: "900" }, error: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.dangerBg }, errorText: { color: colors.missed, fontSize: 10, fontWeight: "800" },
  timelineHeader: { marginHorizontal: 16, marginTop: 20, flexDirection: "row", alignItems: "center", gap: 7 }, sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "900" }, eventCount: { minWidth: 23, height: 23, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, eventCountText: { color: colors.primary, fontSize: 9, fontWeight: "900" }, timelineCard: { marginHorizontal: 14, marginTop: 9, borderRadius: radii.card, padding: 14, backgroundColor: colors.card }, event: { flexDirection: "row", gap: 10, minHeight: 54 }, eventRail: { width: 14, alignItems: "center" }, eventDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary, marginTop: 4 }, eventDotPending: { backgroundColor: colors.warning }, eventLine: { width: 2, flex: 1, backgroundColor: colors.border, marginTop: 3 }, eventBody: { flex: 1, paddingBottom: 14 }, eventTitle: { color: colors.text, fontSize: 11, fontWeight: "900" }, eventTime: { color: colors.faint, fontSize: 8, fontWeight: "700", marginTop: 3 }, eventText: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 6 }, eventEvidence: { color: colors.info, fontSize: 10, lineHeight: 15, marginTop: 6, padding: 8, borderRadius: 9, backgroundColor: colors.infoBg }, emptyTimeline: { color: colors.muted, fontSize: 10, textAlign: "center", paddingVertical: 20 },
  bottomActions: { marginHorizontal: 14, marginTop: 12, flexDirection: "row", gap: 8 }, bottomSecondary: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, bottomSecondaryText: { color: colors.primary, fontSize: 10, fontWeight: "900" }, bottomDanger: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: colors.dangerBg, alignItems: "center", justifyContent: "center" }, bottomDangerText: { color: colors.missed, fontSize: 10, fontWeight: "900" }, disabled: { opacity: 0.4 }, missing: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, missingTitle: { color: colors.text, fontSize: 16, fontWeight: "900" }, backButton: { minHeight: 44, marginTop: 15, borderRadius: 13, paddingHorizontal: 18, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, backButtonText: { color: colors.headerText, fontSize: 11, fontWeight: "900" },
})
