import { useEffect, useMemo, useState } from "react"
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import * as Crypto from "expo-crypto"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import {
  enqueueFieldVisitAction,
  enqueueFieldVisitUpdate,
  fieldOutboxResult,
  readFieldCache,
  writeFieldCache,
} from "../../../src/db/local-store"
import type {
  FieldVisitRequirement,
  FieldVisitWorkspaceData,
} from "../../../src/field/contracts"
import type {
  FieldVisitOutcome,
  FieldVisitPotential,
} from "../../../src/field/execution-outbox"
import { useField } from "../../../src/field/field-context"
import {
  completeOptimisticFieldVisit,
  findFieldVisit,
  setOptimisticFieldVisitSyncState,
} from "../../../src/field/visit-cache"
import {
  addOptimisticVisitAction,
  localFieldVisitWorkspace,
  mergeServerVisitWorkspace,
  missingRequiredVisitActions,
  setVisitActionSyncState,
  visitRequirementProgress,
} from "../../../src/field/visit-workspace"
import { getCurrentDeviceLocation } from "../../../src/location/device-location"
import { useSync } from "../../../src/sync/sync-context"
import { t, type MessageKey, useLocale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"

const outcomes: FieldVisitOutcome[] = ["SUCCESSFUL", "PARTIAL", "NO_CONTACT", "RESCHEDULE"]
const potentials: FieldVisitPotential[] = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"]

function tomorrowDateKey(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return date.toISOString().slice(0, 10)
}

function actionLabel(requirement: FieldVisitRequirement): string {
  return t(`visitAction_${requirement.actionKey}` as MessageKey)
}

export default function FieldVisitWorkspaceScreen() {
  useLocale()
  const { visitId } = useLocalSearchParams<{ visitId: string }>()
  const field = useField()
  const { sync } = useSync()
  const cacheKey = `field.visit.workspace.${visitId}`
  const cached = readFieldCache<FieldVisitWorkspaceData>(cacheKey)?.value ?? null
  const local = localFieldVisitWorkspace(field.week, visitId, field.profile?.agent.id ?? "")
  const [workspace, setWorkspace] = useState<FieldVisitWorkspaceData | null>(cached ?? local)
  const [activeRequirement, setActiveRequirement] = useState<FieldVisitRequirement | null>(null)
  const [evidence, setEvidence] = useState("")
  const [nextDueDate, setNextDueDate] = useState(tomorrowDateKey)
  const [outcome, setOutcome] = useState<FieldVisitOutcome>("SUCCESSFUL")
  const [potential, setPotential] = useState<FieldVisitPotential>("UNKNOWN")
  const [resultNote, setResultNote] = useState("")
  const [saving, setSaving] = useState(false)

  const weekVisit = findFieldVisit(field.week, visitId)
  const requirements = workspace?.visit.requirementSnapshot?.requirements
    .filter((requirement) => requirement.mode !== "HIDDEN") ?? []
  const missing = useMemo(
    () => workspace ? missingRequiredVisitActions(workspace) : [],
    [workspace],
  )

  function persist(next: FieldVisitWorkspaceData) {
    setWorkspace(next)
    writeFieldCache(cacheKey, next)
  }

  async function refreshWorkspace(base: FieldVisitWorkspaceData | null = workspace) {
    try {
      const server = await fieldApi.visitWorkspace(visitId)
      const next = mergeServerVisitWorkspace(base, server)
      persist(next)
    } catch {
      if (!base && local) persist(local)
    }
  }

  useEffect(() => {
    if (!workspace && local) persist(local)
    void refreshWorkspace()
  // Initial cache/server hydration is tied to the visit id.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId])

  async function saveAction(status: "COMPLETED" | "WAIVED") {
    if (!activeRequirement || !workspace) return
    if (activeRequirement.actionKey === "PHOTO") {
      Alert.alert(t("photoActionComing"))
      return
    }
    const trimmed = evidence.trim()
    if (trimmed.length < 2) return
    if (status === "WAIVED" && !activeRequirement.allowWaiver) return
    setSaving(true)
    try {
      const completedAt = new Date().toISOString()
      const actionResultId = `field-action-${Crypto.randomUUID()}`
      const payload = {
        actionResultId,
        visitId,
        actionKey: activeRequirement.actionKey,
        status,
        evidence: activeRequirement.actionKey === "NEXT_ACTION"
          ? { title: trimmed, dueDate: `${nextDueDate}T09:00:00.000Z`, priority: "MEDIUM" }
          : { note: trimmed },
        completedAt,
      } as const
      const queued = enqueueFieldVisitAction(payload)
      const optimistic = addOptimisticVisitAction(workspace, payload)
      persist(optimistic)
      setActiveRequirement(null)
      setEvidence("")
      await sync()
      const result = fieldOutboxResult(queued.clientOpId)
      if (result?.status === "conflict" || result?.status === "rejected") {
        persist(setVisitActionSyncState(
          optimistic,
          actionResultId,
          result.status === "conflict" ? "CONFLICT" : "REJECTED",
        ))
        Alert.alert(t("syncNeedsAttention"))
      } else if (result?.status === "applied") {
        await refreshWorkspace(optimistic)
      } else {
        Alert.alert(t("fieldVisitActionQueued"))
      }
    } finally {
      setSaving(false)
    }
  }

  function checkout() {
    if (!workspace || !field.week) return
    if (missing.length > 0) {
      Alert.alert(t("fieldVisitMissingActions", { actions: missing.map(actionLabel).join(", ") }))
      return
    }
    Alert.alert(t("fieldVisitCheckout"), t("fieldVisitCheckoutConfirm"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("fieldVisitCheckout"), onPress: () => void submitCheckout() },
    ])
  }

  async function submitCheckout() {
    if (!workspace || !field.week) return
    setSaving(true)
    try {
      const location = await getCurrentDeviceLocation()
      if (!location) {
        Alert.alert(t("locationPermissionDenied"))
        return
      }
      const checkOutAt = new Date().toISOString()
      const queued = enqueueFieldVisitUpdate({
        visitId,
        status: "CHECKED_OUT",
        checkOutAt,
        checkOutLat: location.latitude,
        checkOutLng: location.longitude,
        outcome,
        potential,
        resultNotes: resultNote.trim() || null,
      })
      const optimisticWeek = completeOptimisticFieldVisit(field.week, {
        visitId,
        checkOutAt,
        outcome,
        potential,
        resultNotes: resultNote.trim() || null,
      })
      field.applyLocalWeek(optimisticWeek)
      persist({
        ...workspace,
        visit: {
          ...workspace.visit,
          status: "CHECKED_OUT",
          checkOutAt,
          outcome,
          potential,
          resultNotes: resultNote.trim() || null,
          syncState: "PENDING",
        },
      })
      await sync()
      const result = fieldOutboxResult(queued.clientOpId)
      if (result?.status === "conflict" || result?.status === "rejected") {
        field.applyLocalWeek(setOptimisticFieldVisitSyncState(
          optimisticWeek,
          visitId,
          result.status === "conflict" ? "CONFLICT" : "REJECTED",
        ))
        Alert.alert(t("syncNeedsAttention"))
        return
      }
      if (result?.status !== "applied") Alert.alert(t("fieldVisitResultQueued"))
      router.replace(`/(app)/routes/${workspace.visit.routeId}` as never)
    } catch (error) {
      Alert.alert(t("locationUnavailable"), error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  if (!workspace || !weekVisit) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.missing}>
          <Text style={styles.title}>{t("fieldDataError")}</Text>
          <Pressable onPress={() => router.back()} style={styles.primaryButton}><Text style={styles.primaryText}>{t("back")}</Text></Pressable>
        </View>
      </SafeAreaView>
    )
  }

  const customerName = workspace.visit.contact?.displayName ?? workspace.visit.customer.name
  const isCompleted = workspace.visit.status === "CHECKED_OUT"

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("fieldVisitTitle").toUpperCase()}</Text>
            <Text style={styles.title}>{customerName}</Text>
            {workspace.visit.contact ? <Text style={styles.subtitle}>{workspace.visit.customer.name}</Text> : null}
          </View>
          <View style={[styles.livePill, isCompleted && styles.donePill]}>
            <Text style={[styles.liveText, isCompleted && styles.doneText]}>{isCompleted ? t("fieldVisitDone") : t("visitInProgress")}</Text>
          </View>
        </View>

        <View style={styles.summaryCard}>
          <View><Text style={styles.summaryLabel}>CHECK-IN</Text><Text style={styles.summaryValue}>{new Date(workspace.visit.checkInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text></View>
          <View style={styles.summaryDivider} />
          <View><Text style={styles.summaryLabel}>{t("fieldVisitPolicy")}</Text><Text style={styles.summaryValue}>{requirements.length}</Text></View>
          <View style={styles.summaryDivider} />
          <View><Text style={styles.summaryLabel}>{t("fieldVisitDone")}</Text><Text style={styles.summaryValue}>{requirements.filter((item) => visitRequirementProgress(workspace, item).satisfied).length}</Text></View>
        </View>

        <View style={styles.sectionHeader}>
          <View><Text style={styles.sectionTitle}>{t("fieldVisitActions")}</Text><Text style={styles.sectionHint}>{workspace.visit.requirementSnapshot?.sourcePolicy?.name ?? t("fieldVisitPolicy")}</Text></View>
          {missing.length ? <View style={styles.requiredCount}><Text style={styles.requiredCountText}>{missing.length}</Text></View> : null}
        </View>

        {requirements.map((requirement) => {
          const progress = visitRequirementProgress(workspace, requirement)
          return (
            <Pressable
              key={requirement.actionKey}
              disabled={isCompleted}
              onPress={() => { setActiveRequirement(requirement); setEvidence("") }}
              style={({ pressed }) => [styles.actionCard, progress.satisfied && styles.actionCardDone, pressed && styles.pressed]}
            >
              <View style={[styles.actionMark, progress.satisfied && styles.actionMarkDone]}><Text style={[styles.actionMarkText, progress.satisfied && styles.actionMarkTextDone]}>{progress.satisfied ? "✓" : requirement.mode === "REQUIRED" ? "!" : "+"}</Text></View>
              <View style={styles.actionBody}>
                <Text style={styles.actionTitle}>{actionLabel(requirement)}</Text>
                <Text style={styles.actionMeta}>{requirement.mode === "REQUIRED" ? t("fieldVisitRequired") : t("fieldVisitOptional")} · {progress.completed}/{progress.required}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )
        })}

        {activeRequirement ? (
          <View style={styles.editorCard}>
            <Text style={styles.editorTitle}>{actionLabel(activeRequirement)}</Text>
            {activeRequirement.actionKey === "PHOTO" ? (
              <Text style={styles.editorHint}>{t("photoActionComing")}</Text>
            ) : (
              <>
                <Text style={styles.label}>{t("fieldVisitEvidence")}</Text>
                <TextInput value={evidence} onChangeText={setEvidence} multiline textAlignVertical="top" style={styles.textarea} />
                {activeRequirement.actionKey === "NEXT_ACTION" ? (
                  <>
                    <Text style={styles.label}>{t("due")}</Text>
                    <TextInput value={nextDueDate} onChangeText={setNextDueDate} placeholder="YYYY-MM-DD" style={styles.input} />
                  </>
                ) : null}
              </>
            )}
            <View style={styles.editorActions}>
              <Pressable onPress={() => setActiveRequirement(null)} style={styles.secondaryButton}><Text style={styles.secondaryText}>{t("cancel")}</Text></Pressable>
              {activeRequirement.allowWaiver ? <Pressable disabled={saving || evidence.trim().length < 2} onPress={() => void saveAction("WAIVED")} style={styles.waiveButton}><Text style={styles.waiveText}>{t("fieldVisitWaiveAction")}</Text></Pressable> : null}
              <Pressable disabled={saving || evidence.trim().length < 2 || activeRequirement.actionKey === "PHOTO"} onPress={() => void saveAction("COMPLETED")} style={[styles.primaryButton, (saving || evidence.trim().length < 2 || activeRequirement.actionKey === "PHOTO") && styles.disabled]}><Text style={styles.primaryText}>{t("fieldVisitSaveAction")}</Text></Pressable>
            </View>
          </View>
        ) : null}

        {!isCompleted ? (
          <View style={styles.resultCard}>
            <Text style={styles.sectionTitle}>{t("fieldVisitCheckout")}</Text>
            <Text style={styles.label}>{t("fieldVisitOutcome")}</Text>
            <View style={styles.chips}>{outcomes.map((item) => <Pressable key={item} onPress={() => setOutcome(item)} style={[styles.chip, outcome === item && styles.chipSelected]}><Text style={[styles.chipText, outcome === item && styles.chipTextSelected]}>{t(`visitOutcome_${item}` as MessageKey)}</Text></Pressable>)}</View>
            <Text style={styles.label}>{t("fieldVisitPotential")}</Text>
            <View style={styles.chips}>{potentials.map((item) => <Pressable key={item} onPress={() => setPotential(item)} style={[styles.chip, potential === item && styles.chipSelected]}><Text style={[styles.chipText, potential === item && styles.chipTextSelected]}>{t(`visitPotential_${item}` as MessageKey)}</Text></Pressable>)}</View>
            <Text style={styles.label}>{t("fieldVisitResultNote")}</Text>
            <TextInput value={resultNote} onChangeText={setResultNote} multiline textAlignVertical="top" style={styles.textarea} />
            <Pressable disabled={saving || missing.length > 0} onPress={checkout} style={[styles.checkoutButton, (saving || missing.length > 0) && styles.disabled]}><Text style={styles.checkoutText}>{missing.length ? t("fieldVisitMissingActions", { actions: String(missing.length) }) : t("fieldVisitCheckout")}</Text></Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 34 },
  header: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  backText: { color: colors.text, fontSize: 30, lineHeight: 31 },
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 10, marginTop: 2 },
  livePill: { maxWidth: 92, borderRadius: radii.pill, backgroundColor: colors.warningBg, paddingHorizontal: 9, paddingVertical: 7 },
  liveText: { color: colors.warning, fontSize: 8, fontWeight: "900", textAlign: "center" },
  donePill: { backgroundColor: colors.successBg }, doneText: { color: colors.successDark },
  summaryCard: { marginHorizontal: 14, marginTop: 10, minHeight: 76, borderRadius: radii.card, padding: 14, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "space-around", ...cardShadow },
  summaryLabel: { color: colors.headerSubtext, fontSize: 8, fontWeight: "900", textTransform: "uppercase", textAlign: "center" },
  summaryValue: { color: colors.headerText, fontSize: 18, fontWeight: "900", textAlign: "center", marginTop: 4 },
  summaryDivider: { width: 1, height: 34, backgroundColor: "rgba(255,255,255,0.2)" },
  sectionHeader: { marginHorizontal: 16, marginTop: 22, marginBottom: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  sectionHint: { color: colors.muted, fontSize: 9, marginTop: 3 },
  requiredCount: { minWidth: 28, height: 28, borderRadius: 14, backgroundColor: colors.missedBg, alignItems: "center", justifyContent: "center" },
  requiredCountText: { color: colors.missed, fontSize: 11, fontWeight: "900" },
  actionCard: { marginHorizontal: 14, marginTop: 8, minHeight: 70, borderRadius: radii.card, padding: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 11 },
  actionCardDone: { borderColor: colors.successBorder, backgroundColor: colors.successBg },
  actionMark: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.warningBg, alignItems: "center", justifyContent: "center" },
  actionMarkDone: { backgroundColor: colors.card },
  actionMarkText: { color: colors.warning, fontSize: 16, fontWeight: "900" }, actionMarkTextDone: { color: colors.successDark },
  actionBody: { flex: 1 }, actionTitle: { color: colors.text, fontSize: 13, fontWeight: "900" }, actionMeta: { color: colors.muted, fontSize: 9, marginTop: 4 }, chevron: { color: colors.faint, fontSize: 24 },
  editorCard: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary, ...cardShadow },
  editorTitle: { color: colors.text, fontSize: 15, fontWeight: "900" }, editorHint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  label: { color: colors.text, fontSize: 11, fontWeight: "800", marginTop: 13, marginBottom: 6 },
  input: { minHeight: 46, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, color: colors.text, backgroundColor: colors.bg },
  textarea: { minHeight: 88, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, padding: 12, color: colors.text, backgroundColor: colors.bg },
  editorActions: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 7, marginTop: 12 },
  secondaryButton: { minHeight: 42, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" }, secondaryText: { color: colors.text, fontSize: 10, fontWeight: "800" },
  waiveButton: { minHeight: 42, borderRadius: radii.inner, backgroundColor: colors.warningBg, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" }, waiveText: { color: colors.warning, fontSize: 10, fontWeight: "900" },
  primaryButton: { minHeight: 42, borderRadius: radii.inner, backgroundColor: colors.primary, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" }, primaryText: { color: colors.headerText, fontSize: 10, fontWeight: "900" },
  resultCard: { marginHorizontal: 14, marginTop: 20, borderRadius: radii.card, padding: 15, backgroundColor: colors.card, ...cardShadow },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, chip: { minHeight: 38, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }, chipSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary }, chipText: { color: colors.muted, fontSize: 9, fontWeight: "800" }, chipTextSelected: { color: colors.primary },
  checkoutButton: { minHeight: 52, borderRadius: radii.inner, backgroundColor: colors.success, alignItems: "center", justifyContent: "center", marginTop: 15, paddingHorizontal: 12 }, checkoutText: { color: colors.headerText, fontSize: 13, fontWeight: "900", textAlign: "center" },
  pressed: { opacity: 0.72 }, disabled: { opacity: 0.38 },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
})
