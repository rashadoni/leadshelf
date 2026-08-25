import { useEffect, useMemo, useRef, useState } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { enqueueFieldTaskCreate, readFieldCache } from "../../../src/db/local-store"
import type { FieldAgentTaskPriority, FieldAgentTaskRecurrence, FieldAgentTasksData } from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import { FIELD_AGENT_TASKS_CACHE_KEY, type FieldTaskCustomerPreview } from "../../../src/field/task-cache"
import { fieldErrorMessage, FIELD_TASK_ERROR_OVERRIDES } from "../../../src/field/error-message"
import { objectTypeLabel } from "../../../src/field/labels"
import { fieldTaskDateOptions, fieldTaskDueDateTime, resolveFieldTaskToday } from "../../../src/field/task-time"
import { shiftDateKey } from "../../../src/field/route-time"
import { t, useLocale } from "../../../src/i18n"
import { formatCalendarDay } from "../../../src/i18n/date-format"
import { safeFieldBack } from "../../../src/navigation/safe-back"
import { useSync } from "../../../src/sync/sync-context"
import { colors, cardShadow, radii } from "../../../src/theme"
import { TabIcon } from "../../../src/components/TabIcon"
import { FieldDayNavigator } from "../../../src/field/FieldDayNavigator"

export default function NewAgentTaskScreen() {
  const locale = useLocale()
  const { copyFrom } = useLocalSearchParams<{ copyFrom?: string }>()
  const field = useField()
  const { sync } = useSync()
  const insets = useSafeAreaInsets()
  const tenantTimeZone = field.week?.timezone ?? field.workday?.timezone ?? field.profile?.todaySummary.timezone ?? "UTC"
  const tenantToday = resolveFieldTaskToday(
    field.week?.today ?? field.workday?.today ?? field.profile?.todaySummary.date,
    tenantTimeZone,
  )
  const copySource = field.agentTasks?.tasks.find((task) => task.id === copyFrom) ?? null
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<FieldAgentTaskPriority>("MEDIUM")
  // Keep the default derived from the tenant calendar until the user makes a
  // selection; Field context can hydrate after this screen first renders.
  const [selectedDate, setSelectedDate] = useState<string | null | undefined>(undefined)
  const [time, setTime] = useState("09:00")
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerSearch, setCustomerSearch] = useState("")
  const [searchedCustomers, setSearchedCustomers] = useState<FieldTaskCustomerPreview[]>([])
  const [customerLoading, setCustomerLoading] = useState(false)
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null)
  const [recurrence, setRecurrence] = useState<FieldAgentTaskRecurrence | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const customerSearchSequence = useRef(0)
  const hydratedCopyId = useRef<string | null>(null)

  const defaultSelectedDate = fieldTaskDateOptions(tenantToday, 2)[1]?.key ?? tenantToday
  const effectiveSelectedDate = selectedDate === undefined ? defaultSelectedDate : selectedDate
  const selectedTaskDate = effectiveSelectedDate ? formatCalendarDay(effectiveSelectedDate, locale) : null
  const taskDateLabel = selectedTaskDate
    ? `${selectedTaskDate.weekday}, ${selectedTaskDate.date}`
    : t("agentTaskDueNone")
  const taskCalendarDays = useMemo(() => {
    const anchor = effectiveSelectedDate ?? tenantToday
    return Array.from({ length: 7 }, (_, index) => {
      const date = shiftDateKey(anchor, index - 3)
      return {
        date,
        isToday: date === tenantToday,
        disabled: date < tenantToday,
        accessibilityLabel: `${formatCalendarDay(date, locale).weekday}, ${formatCalendarDay(date, locale).date}`,
      }
    })
  }, [effectiveSelectedDate, locale, tenantToday])
  const hasInitialInput = Boolean(
    title || description || priority !== "MEDIUM" || effectiveSelectedDate !== defaultSelectedDate ||
    time !== "09:00" || customerId || recurrence,
  )

  const plannedCustomers = useMemo(() => {
    const map = new Map<string, FieldTaskCustomerPreview>()
    for (const point of field.week?.days.flatMap((day) => day.routes.flatMap((route) => route.points)) ?? []) {
      if (!map.has(point.customer.id)) {
        map.set(point.customer.id, {
          id: point.customer.id,
          name: point.customer.name,
          objectType: point.customer.objectType,
          address: point.customer.address,
          city: point.customer.city,
        })
      }
    }
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name))
  }, [field.week])

  const customers = useMemo(() => {
    const map = new Map<string, FieldTaskCustomerPreview>()
    for (const customer of plannedCustomers) map.set(customer.id, customer)
    for (const customer of searchedCustomers) map.set(customer.id, customer)
    if (copySource?.customer && !map.has(copySource.customer.id)) {
      map.set(copySource.customer.id, copySource.customer)
    }
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name))
  }, [copySource?.customer, plannedCustomers, searchedCustomers])

  const customerQuery = customerSearch.trim()
  const visibleCustomers = useMemo(() => {
    const normalized = customerQuery.toLocaleLowerCase()
    const matches = normalized
      ? customers.filter((customer) => [customer.name, customer.address, customer.city].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalized))
      : plannedCustomers
    return matches.slice(0, 12)
  }, [customerQuery, customers, plannedCustomers])
  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null

  useEffect(() => {
    if (!copySource || hydratedCopyId.current === copySource.id) return
    // A slow Field refresh must not overwrite a task the agent already began
    // to enter while the optional copy source was still hydrating.
    if (hasInitialInput) {
      hydratedCopyId.current = copySource.id
      return
    }
    setTitle(copySource.title)
    setDescription(copySource.description ?? "")
    setPriority(copySource.priority)
    setCustomerId(copySource.customerId)
    setRecurrence(copySource.recurrenceRule)
    hydratedCopyId.current = copySource.id
  }, [copySource, hasInitialInput])

  useEffect(() => {
    const query = customerSearch.trim()
    const request = ++customerSearchSequence.current
    if (query.length < 2) {
      setSearchedCustomers([])
      setCustomerLoading(false)
      setCustomerSearchError(null)
      return
    }
    const timeout = setTimeout(() => {
      void fieldApi.organizations(query)
        .then((data) => {
          if (request !== customerSearchSequence.current) return
          setSearchedCustomers(data.organizations.map((organization) => ({
            id: organization.id,
            name: organization.name,
            objectType: organization.objectType,
            address: organization.address,
            city: organization.city,
          })))
          setCustomerSearchError(null)
        })
        .catch(() => {
          if (request !== customerSearchSequence.current) return
          setSearchedCustomers([])
          setCustomerSearchError(t("agentTaskCustomerSearchFailed"))
        })
        .finally(() => {
          if (request === customerSearchSequence.current) setCustomerLoading(false)
        })
    }, 350)
    setCustomerLoading(true)
    setCustomerSearchError(null)
    return () => clearTimeout(timeout)
  }, [customerSearch])

  function chooseCustomer(id: string | null) {
    setCustomerId(id)
    setCustomerSearch("")
  }

  function selectTaskDate(date: string) {
    if (date < tenantToday) return
    setSelectedDate(date)
  }

  function moveTaskDate(days: -1 | 1) {
    const current = effectiveSelectedDate ?? tenantToday
    const next = shiftDateKey(current, days)
    if (next < tenantToday) return
    selectTaskDate(next)
  }

  async function create() {
    const normalizedTitle = title.trim()
    const dueDate = fieldTaskDueDateTime(effectiveSelectedDate, time, tenantTimeZone)
    if (!normalizedTitle || (effectiveSelectedDate && !dueDate) || (recurrence && !effectiveSelectedDate)) {
      setError(t("agentTaskCreateRequired"))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const customer = customers.find((item) => item.id === customerId) ?? copySource?.customer ?? null
      const queued = enqueueFieldTaskCreate({
        title: normalizedTitle,
        description: description.trim() || null,
        customerId,
        visitId: null,
        priority,
        dueDate,
        copiedFromId: copySource?.id ?? null,
        recurrence: recurrence ? { rule: recurrence, interval: 1, until: null } : null,
      }, customer)
      const cached = readFieldCache<FieldAgentTasksData>(FIELD_AGENT_TASKS_CACHE_KEY)
      if (cached) field.applyLocalAgentTasks(cached.value)
      Alert.alert(t("agentTaskCreated"))
      router.replace(`/(app)/field-tasks/${queued.taskId}` as never)
      void sync().then(() => field.refreshAgentTasks()).catch(() => {})
    } catch (cause) {
      setError(fieldErrorMessage(cause, "agentTaskActionFailed", FIELD_TASK_ERROR_OVERRIDES))
    } finally {
      setSaving(false)
    }
  }

  const createDisabled = field.agentTasks?.capabilities.createSelfTask === false
  const hasDraft = copySource
    ? title !== copySource.title ||
      description !== (copySource.description ?? "") ||
      priority !== copySource.priority ||
      customerId !== copySource.customerId ||
      recurrence !== copySource.recurrenceRule ||
      effectiveSelectedDate !== defaultSelectedDate ||
      time !== "09:00"
    : hasInitialInput

  function goBack() {
    if (saving) return
    if (!hasDraft) {
      safeFieldBack("/(app)/field-tasks")
      return
    }
    Alert.alert(t("agentTaskDiscardCreateTitle"), t("agentTaskDiscardCreateBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("agentTaskDiscardCreateConfirm"), style: "destructive", onPress: () => safeFieldBack("/(app)/field-tasks") },
    ])
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 20) + 94 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} accessibilityState={{ disabled: saving }} disabled={saving} onPress={goBack} style={[styles.back, saving && styles.disabled]}><TabIcon name="chevronLeft" color={colors.text} size={23} /></Pressable>
          <View style={styles.headerBody}><Text style={styles.eyebrow}>{t("agentTasksTitle").toUpperCase()}</Text><Text style={styles.title}>{copySource ? t("agentTaskCopy") : t("agentTaskCreateTitle")}</Text></View>
        </View>
        <Text style={styles.intro}>{t("agentTaskCreateHint")}</Text>

        <View style={styles.formCard}>
          <Input label={t("agentTaskTitleLabel")} value={title} onChangeText={setTitle} required />
          <Input label={t("agentTaskDescriptionLabel")} value={description} onChangeText={setDescription} multiline />
        </View>

        <SectionTitle>{t("agentTaskPriorityLabel")}</SectionTitle>
        <View style={styles.wrapChips}>
          {(["LOW", "MEDIUM", "HIGH", "URGENT"] as FieldAgentTaskPriority[]).map((value) => <ChoiceChip key={value} selected={priority === value} label={priorityLabel(value)} onPress={() => setPriority(value)} />)}
        </View>

        <SectionTitle>{t("agentTaskDueLabel")}</SectionTitle>
        <FieldDayNavigator
          days={taskCalendarDays}
          selectedDate={effectiveSelectedDate}
          onSelectDate={selectTaskDate}
          onPrevious={() => moveTaskDate(-1)}
          onNext={() => moveTaskDate(1)}
          previousLabel={t("weekPreviousDay")}
          nextLabel={t("weekNextDay")}
          onCurrent={() => selectTaskDate(tenantToday)}
          currentActionLabel={t("tabToday")}
          currentLabel={taskDateLabel}
          currentAccessibilityLabel={taskDateLabel}
          calendarPicker
          todayDate={tenantToday}
          compactDay
          isCalendarDateDisabled={(date) => date < tenantToday}
        />
        <View style={styles.dueSecondaryRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("agentTaskDueNone")}
            accessibilityState={{ selected: effectiveSelectedDate === null }}
            onPress={() => { setSelectedDate(null); setRecurrence(null) }}
            style={({ pressed }) => [styles.noDate, effectiveSelectedDate === null && styles.noDateSelected, pressed && styles.pressed]}
          >
            <TabIcon name="close" color={effectiveSelectedDate === null ? colors.primary : colors.muted} size={16} />
            <Text style={[styles.noDateText, effectiveSelectedDate === null && styles.noDateTextSelected]}>{t("agentTaskDueNone")}</Text>
          </Pressable>
        </View>
        {effectiveSelectedDate ? <View style={styles.timeCard}><Text style={styles.timeLabel}>{t("agentTaskTimeLabel")}</Text><TextInput accessibilityLabel={t("agentTaskTimeLabel")} value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" maxLength={5} placeholder="09:00" placeholderTextColor={colors.faint} style={styles.timeInput} /><View style={styles.timePresets}>{["09:00", "12:00", "15:00", "18:00"].map((value) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${t("agentTaskTimeLabel")}: ${value}`} accessibilityState={{ selected: time === value }} onPress={() => setTime(value)} style={[styles.timePreset, time === value && styles.timePresetSelected]}><Text style={[styles.timePresetText, time === value && styles.timePresetTextSelected]}>{value}</Text></Pressable>)}</View></View> : null}

        <SectionTitle>{t("agentTaskCustomerLabel")}</SectionTitle>
        <View style={styles.customerPicker}>
          <View style={styles.customerSearchBox}>
            <TabIcon name="search" color={colors.faint} size={20} />
            <TextInput
              accessibilityLabel={t("agentTaskCustomerSearch")}
              autoCorrect={false}
              onChangeText={setCustomerSearch}
              placeholder={t("agentTaskCustomerSearch")}
              placeholderTextColor={colors.faint}
              style={styles.customerSearchInput}
              value={customerSearch}
            />
          </View>
          <Text style={styles.customerHint}>{t("agentTaskCustomerSearchHint")}</Text>
          {selectedCustomer ? (
            <View style={styles.selectedCustomer}>
              <View style={styles.selectedCustomerMark}><Text style={styles.selectedCustomerMarkText}>{selectedCustomer.name.charAt(0).toUpperCase()}</Text></View>
              <View style={styles.selectedCustomerBody}>
                <Text style={styles.selectedCustomerEyebrow}>{t("agentTaskCustomerSelected")}</Text>
                <Text style={styles.selectedCustomerName} numberOfLines={1}>{selectedCustomer.name}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskNoCustomerChoice")} onPress={() => chooseCustomer(null)} style={styles.clearCustomer}><TabIcon name="close" color={colors.primary} size={20} /></Pressable>
            </View>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskNoCustomerChoice")} accessibilityState={{ selected: customerId === null }} onPress={() => chooseCustomer(null)} style={[styles.noCustomerChoice, customerId === null && styles.noCustomerChoiceSelected]}>
            <Text style={[styles.noCustomerChoiceText, customerId === null && styles.noCustomerChoiceTextSelected]}>{t("agentTaskNoCustomerChoice")}</Text>
          </Pressable>
          {customerLoading ? <Text style={styles.customerState}>{t("agentTaskCustomerLoading")}</Text> : null}
          {customerSearchError ? <Text style={styles.customerError}>{customerSearchError}</Text> : null}
          {visibleCustomers.map((customer) => (
            <Pressable key={customer.id} accessibilityRole="button" accessibilityLabel={customer.name} accessibilityState={{ selected: customerId === customer.id }} onPress={() => chooseCustomer(customer.id)} style={[styles.customerChoice, customerId === customer.id && styles.customerChoiceSelected]}>
              <View style={[styles.customerMark, customerId === customer.id && styles.customerMarkSelected]}><Text style={[styles.customerMarkText, customerId === customer.id && styles.customerMarkTextSelected]}>{customer.name.charAt(0).toUpperCase()}</Text></View>
              <View style={styles.customerChoiceBody}>
                <Text style={[styles.customerChoiceName, customerId === customer.id && styles.customerChoiceNameSelected]} numberOfLines={1}>{customer.name}</Text>
                <Text style={[styles.customerChoiceMeta, customerId === customer.id && styles.customerChoiceMetaSelected]} numberOfLines={1}>{[objectTypeLabel(customer.objectType), customer.city, customer.address].filter(Boolean).join(" · ")}</Text>
              </View>
              {customerId === customer.id ? <TabIcon name="check" color={colors.primary} size={20} /> : null}
            </Pressable>
          ))}
          {customerQuery.length >= 2 && !customerLoading && !customerSearchError && visibleCustomers.length === 0 ? <Text style={styles.customerState}>{t("agentTaskCustomerNoMatches")}</Text> : null}
        </View>

        {field.agentTasks?.capabilities.recurringTasks !== false && effectiveSelectedDate ? <><SectionTitle>{t("agentTaskRecurrenceLabel")}</SectionTitle><View style={styles.wrapChips}><ChoiceChip selected={recurrence === null} label={t("agentTaskRecurrenceNone")} onPress={() => setRecurrence(null)} /><ChoiceChip selected={recurrence === "DAILY"} label={t("agentTaskRecurrenceDaily")} onPress={() => setRecurrence("DAILY")} /><ChoiceChip selected={recurrence === "WEEKLY"} label={t("agentTaskRecurrenceWeekly")} onPress={() => setRecurrence("WEEKLY")} /><ChoiceChip selected={recurrence === "MONTHLY"} label={t("agentTaskRecurrenceMonthly")} onPress={() => setRecurrence("MONTHLY")} /></View></> : null}

        {copySource ? <View style={styles.copyNotice}><Text style={styles.copyNoticeText}>{t("agentTaskPersonalHint")}</Text></View> : null}
        {createDisabled ? <View style={styles.error}><Text style={styles.errorText}>{t("agentTaskManagerHint")}</Text></View> : null}
        {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
      </ScrollView>
      <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom, 10) + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("agentTaskCreate")} accessibilityState={{ disabled: saving || createDisabled, busy: saving }} disabled={saving || createDisabled} onPress={() => void create()} style={[styles.submit, (saving || createDisabled) && styles.disabled]}><Text style={styles.submitText}>{saving ? "…" : t("agentTaskCreate")}</Text></Pressable>
      </View>
    </SafeAreaView>
  )
}

function priorityLabel(priority: FieldAgentTaskPriority): string {
  if (priority === "LOW") return t("agentTaskPriority_LOW")
  if (priority === "MEDIUM") return t("agentTaskPriority_MEDIUM")
  if (priority === "HIGH") return t("agentTaskPriority_HIGH")
  return t("agentTaskPriority_URGENT")
}

function SectionTitle({ children }: { children: string }) { return <Text style={styles.sectionTitle}>{children}</Text> }
function ChoiceChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>{label}</Text></Pressable> }
function Input({ label, required, multiline, ...props }: { label: string; required?: boolean; multiline?: boolean; value: string; onChangeText: (value: string) => void }) { return <View><Text style={styles.inputLabel}>{label}{required ? " *" : ""}</Text><TextInput accessibilityLabel={label} {...props} multiline={multiline} textAlignVertical={multiline ? "top" : "center"} placeholderTextColor={colors.faint} style={[styles.input, multiline && styles.textarea]} /></View> }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { minHeight: "100%", paddingBottom: 34 }, header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 }, back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }, headerBody: { flex: 1 }, eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.7 }, title: { color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 2 }, intro: { marginHorizontal: 16, marginTop: 12, color: colors.muted, fontSize: 11, lineHeight: 17 },
  formCard: { marginHorizontal: 14, marginTop: 15, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, gap: 13, ...cardShadow }, inputLabel: { color: colors.muted, fontSize: 9, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.45, marginBottom: 6 }, input: { minHeight: 47, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, paddingHorizontal: 12, color: colors.text, fontSize: 13 }, textarea: { minHeight: 92, paddingTop: 11, lineHeight: 18 }, sectionTitle: { marginHorizontal: 16, marginTop: 20, marginBottom: 9, color: colors.text, fontSize: 14, fontWeight: "900" }, wrapChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14 }, chip: { maxWidth: 210, minHeight: 44, borderRadius: radii.pill, paddingHorizontal: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }, chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary }, chipText: { color: colors.muted, fontSize: 10, fontWeight: "900" }, chipTextSelected: { color: colors.headerText },
  dueSecondaryRow: { marginHorizontal: 14, marginTop: 8, alignItems: "flex-start" }, noDate: { minHeight: 44, borderRadius: radii.pill, paddingHorizontal: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }, noDateSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary }, noDateText: { color: colors.muted, fontSize: 11, fontWeight: "900" }, noDateTextSelected: { color: colors.primary }, timeCard: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, padding: 12, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 9 }, timeLabel: { color: colors.muted, fontSize: 10, fontWeight: "900" }, timeInput: { width: 76, minHeight: 44, borderRadius: 11, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 13, fontWeight: "900", textAlign: "center" }, timePresets: { width: "100%", flexDirection: "row", gap: 6 }, timePreset: { flex: 1, minHeight: 44, borderRadius: 10, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }, timePresetSelected: { backgroundColor: colors.primarySoft }, timePresetText: { color: colors.muted, fontSize: 9, fontWeight: "800" }, timePresetTextSelected: { color: colors.primary },
  customerPicker: { marginHorizontal: 14, borderRadius: radii.card, padding: 12, backgroundColor: colors.card, gap: 8, ...cardShadow }, customerSearchBox: { minHeight: 46, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, flexDirection: "row", alignItems: "center", paddingHorizontal: 11, gap: 7 }, customerSearchInput: { flex: 1, minHeight: 44, color: colors.text, fontSize: 13 }, customerHint: { color: colors.muted, fontSize: 9, lineHeight: 13, fontWeight: "700" }, noCustomerChoice: { minHeight: 44, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }, noCustomerChoiceSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, noCustomerChoiceText: { color: colors.muted, fontSize: 10, fontWeight: "900" }, noCustomerChoiceTextSelected: { color: colors.primary }, selectedCustomer: { minHeight: 52, borderRadius: radii.inner, backgroundColor: colors.primarySoft, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 9 }, selectedCustomerMark: { width: 31, height: 31, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, selectedCustomerMarkText: { color: colors.headerText, fontSize: 13, fontWeight: "900" }, selectedCustomerBody: { flex: 1, minWidth: 0 }, selectedCustomerEyebrow: { color: colors.primary, fontSize: 8, lineHeight: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 }, selectedCustomerName: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: "900", marginTop: 1 }, clearCustomer: { width: 44, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" }, customerChoice: { minHeight: 55, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 9 }, customerChoiceSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary }, customerMark: { width: 33, height: 33, borderRadius: 11, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" }, customerMarkSelected: { backgroundColor: colors.primary }, customerMarkText: { color: colors.info, fontSize: 13, fontWeight: "900" }, customerMarkTextSelected: { color: colors.headerText }, customerChoiceBody: { flex: 1, minWidth: 0 }, customerChoiceName: { color: colors.text, fontSize: 11, fontWeight: "900" }, customerChoiceNameSelected: { color: colors.primary }, customerChoiceMeta: { color: colors.muted, fontSize: 9, marginTop: 2, fontWeight: "700" }, customerChoiceMetaSelected: { color: colors.primary }, customerState: { color: colors.muted, fontSize: 10, lineHeight: 15, textAlign: "center", paddingVertical: 5, fontWeight: "800" }, customerError: { color: colors.missed, fontSize: 10, lineHeight: 15, paddingVertical: 4, fontWeight: "800" },
  copyNotice: { marginHorizontal: 14, marginTop: 18, borderRadius: radii.inner, padding: 11, backgroundColor: colors.infoBg }, copyNoticeText: { color: colors.info, fontSize: 10, lineHeight: 15, fontWeight: "700" }, error: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.inner, padding: 11, backgroundColor: colors.dangerBg }, errorText: { color: colors.missed, fontSize: 10, lineHeight: 15, fontWeight: "800" }, stickyFooter: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 14, paddingTop: 10 }, submit: { minHeight: 52, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, submitText: { color: colors.headerText, fontSize: 13, fontWeight: "900" }, disabled: { opacity: 0.4 },
})
