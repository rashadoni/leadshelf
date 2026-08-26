import { useEffect, useMemo, useState } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"
import { useField } from "../../../src/field/field-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { RouteTargetPicker, type RouteTarget } from "../../../src/field/route-target-picker"
import {
  addMinutesToRouteTime,
  findRouteTimeConflicts,
  formatRouteTime,
  isValidRouteTime,
  routePlannedTime,
  shiftDateKey,
} from "../../../src/field/route-time"
import type { FieldWeekRoute } from "../../../src/field/contracts"
import { addOptimisticRoute } from "../../../src/field/route-cache"
import { enqueueFieldRouteCreate, fieldRouteOutboxResult } from "../../../src/db/local-store"
import { useSync } from "../../../src/sync/sync-context"
import { t, useLocale } from "../../../src/i18n"
import { formatCalendarDay } from "../../../src/i18n/date-format"
import { TabIcon } from "../../../src/components/TabIcon"
import { FieldScreenChrome } from "../../../src/components/FieldScreenChrome"
import { FieldDayNavigator } from "../../../src/field/FieldDayNavigator"
import { colors, cardShadow, radii } from "../../../src/theme"
import { useResponsiveLayout } from "../../../src/layout/responsive"
import { contactTypeLabel, objectTypeLabel } from "../../../src/field/labels"
import { fieldRouteConflictMessage, fieldRouteMutationErrorMessage } from "../../../src/field/error-message"
import { parseFieldRouteMutationConflict, type FieldRouteMutationConflict } from "../../../src/field/route-conflict"
import { isRouteDraftDateAllowed, resolveRouteDraftDate } from "../../../src/field/route-planning-date"
import { isRouteDraftDirty } from "../../../src/field/route-draft-state"
import { startOfIsoWeek } from "../../../src/field/week-status"
import { hasFieldManagerRole } from "../../../src/field/manager-access"
import { safeFieldBack } from "../../../src/navigation/safe-back"

function reorder<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  if (!moved) return items
  next.splice(to, 0, moved)
  return next
}

type RouteDraftTarget = RouteTarget & { time: string }
type RouteDraftStep = 1 | 2 | 3

function targetMeta(target: RouteDraftTarget): string {
  if (target.contact) {
    return [target.contact.specialtyName ?? contactTypeLabel(target.contact.type), target.customer.name].join(" · ")
  }
  return target.customer.address ?? target.customer.city ?? objectTypeLabel(target.customer.objectType)
}

function targetAccessibilityName(target: RouteDraftTarget): string {
  return [target.contact?.displayName ?? target.customer.name, targetMeta(target)].filter(Boolean).join(", ")
}

const ROUTE_WIZARD_STEPS = [
  { id: 1, label: "routeWizardStepDate", icon: "today" },
  { id: 2, label: "routeWizardStepStops", icon: "organizations" },
  { id: 3, label: "routeWizardStepReview", icon: "route" },
] as const

export default function NewRouteScreen() {
  const locale = useLocale()
  const {
    copyFrom,
    date: requestedDate,
    managerPlan,
    managerAgentId,
    managerAgentName,
  } = useLocalSearchParams<{
    copyFrom?: string
    date?: string
    managerPlan?: string
    managerAgentId?: string
    managerAgentName?: string
  }>()
  const field = useField()
  const { sync } = useSync()
  const insets = useSafeAreaInsets()
  const layout = useResponsiveLayout()
  const availableDays = field.week?.days ?? []
  const requestedDateKey = typeof requestedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate.slice(0, 10))
    ? requestedDate.slice(0, 10)
    : null
  // Route parameters only preserve context from Manager Planning. They never
  // grant a manager flow or immediate PLANNED publish to an agent who opens a
  // copied/deep link; the scoped server endpoint remains the final authority.
  const managerMode = hasFieldManagerRole(field.profile?.agent.role) && managerPlan === "1" && Boolean(
    requestedDateKey &&
    typeof managerAgentId === "string" && managerAgentId &&
    typeof managerAgentName === "string" && managerAgentName,
  )
  const canCreateRoute = managerMode || field.week?.capabilities.createOwnDraft === true
  const calendarDate = requestedDateKey
  const initialDate = calendarDate ?? availableDays.find((day) => day.isToday && day.routePlanningAllowed)?.date ?? availableDays.find((day) => day.routePlanningAllowed)?.date ?? null
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate)
  // A month-picker selection may belong to a week that has not arrived yet.
  // Keep the exact day while its server eligibility is loading; otherwise the
  // generic seven-day resolver would silently replace it with an old week day.
  const [pendingDateLoad, setPendingDateLoad] = useState<string | null>(null)
  const [preserveSelectedDate, setPreserveSelectedDate] = useState(false)
  const [name, setName] = useState("")
  const [notes, setNotes] = useState("")
  const [targets, setTargets] = useState<RouteDraftTarget[]>([])
  const [copySource, setCopySource] = useState<FieldWeekRoute | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [expandedTargetKey, setExpandedTargetKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [routeConflict, setRouteConflict] = useState<FieldRouteMutationConflict | null>(null)
  const [step, setStep] = useState<RouteDraftStep>(1)
  const excluded = useMemo(() => new Set(targets.map((target) => target.key)), [targets])
  const localTimeConflicts = useMemo(() => findRouteTimeConflicts(targets.map((target) => target.time)), [targets])
  const conflictingTargetIndexes = useMemo(
    () => new Set(localTimeConflicts.flatMap((conflict) => conflict.indexes)),
    [localTimeConflicts],
  )
  const selectedCalendarDate = selectedDate ? formatCalendarDay(selectedDate, locale) : null
  const excludedDate = copySource?.date.slice(0, 10) ?? null
  const selectedWeekIsLoading = Boolean(
    !managerMode &&
    pendingDateLoad &&
    (!field.week || startOfIsoWeek(pendingDateLoad) !== field.week.weekStart),
  )
  const selectedDateAllowed = managerMode || isRouteDraftDateAllowed(selectedDate, availableDays, excludedDate)
  const selectedDateUnavailable = !managerMode && !selectedWeekIsLoading && Boolean(selectedDate && field.week && !selectedDateAllowed)
  const selectedDateLabel = selectedCalendarDate
    ? selectedCalendarDate.weekday + ", " + selectedCalendarDate.date
    : null
  const selectedAgent = managerMode
    ? { id: managerAgentId as string, name: managerAgentName as string }
    : field.profile?.agent
  const submitDisabled = saving || (step === 1 && (selectedWeekIsLoading || selectedDateUnavailable))
  const submitLabel = step === 3
    ? copySource
      ? t("copyRoute")
      : managerMode
        ? t("managerRoutePublish")
        : t("createRoute")
    : t("routeWizardContinue")
  const hasUnsavedDraft = isRouteDraftDirty({
    initialDate,
    selectedDate,
    name,
    notes,
    targetCount: targets.length,
  })
  const routeHubFallback = managerMode && requestedDateKey
    ? `/(app)/manager/planning?date=${encodeURIComponent(requestedDateKey)}`
    : "/(app)/routes"

  useEffect(() => {
    if (managerMode && requestedDateKey) {
      if (selectedDate !== requestedDateKey) setSelectedDate(requestedDateKey)
      return
    }
    if (pendingDateLoad && (!field.week || startOfIsoWeek(pendingDateLoad) !== field.week.weekStart)) return
    if (pendingDateLoad) {
      setPendingDateLoad(null)
      return
    }
    if (preserveSelectedDate) return
    const nextDate = resolveRouteDraftDate(selectedDate, requestedDateKey, availableDays, excludedDate)
    if (nextDate !== selectedDate) {
      setSelectedDate(nextDate)
    }
  }, [availableDays, excludedDate, field.week, managerMode, pendingDateLoad, preserveSelectedDate, requestedDateKey, selectedDate])

  useEffect(() => {
    if (!pendingDateLoad || (field.phase !== "error" && field.phase !== "stale")) return
    setPendingDateLoad(null)
    setError(t("fieldDataError"))
  }, [field.phase, pendingDateLoad])

  useEffect(() => {
    if (!copyFrom || copySource || !field.week) return
    const source = field.week.days.flatMap((day) => day.routes).find((route) => route.id === copyFrom)
    if (!source) return
    setCopySource(source)
    setName(`${source.name ?? t("tabRoute")} — ${t("routeCopySuffix")}`)
    setNotes(source.notes ?? "")
    setTargets(source.points.map((point) => ({
      key: point.contactId ? `contact:${point.contactId}` : `customer:${point.customerId}`,
      customer: point.customer,
      contact: point.contact,
      time: formatRouteTime(point.plannedTime, field.week?.timezone ?? "UTC"),
    })))
    setSelectedDate(null)
    setPendingDateLoad(null)
    setPreserveSelectedDate(false)
  }, [copyFrom, copySource, field.week])

  function moveDate(days: -1 | 1) {
    const currentDate = selectedDate ?? field.week?.today ?? availableDays[0]?.date
    if (!currentDate) return
    selectDate(shiftDateKey(currentDate, days))
  }

  function autoSchedule() {
    setTargets((current) => current.map((target, index) => ({
      ...target,
      time: addMinutesToRouteTime("09:00", index * 30),
    })))
    setRouteConflict(null)
    setError(null)
  }

  function selectDate(date: string) {
    setSelectedDate(date)
    setPreserveSelectedDate(true)
    setError(null)
    setRouteConflict(null)
    if (field.week && startOfIsoWeek(date) !== field.week.weekStart) {
      setPendingDateLoad(date)
      void field.loadWeek(startOfIsoWeek(date))
    } else {
      setPendingDateLoad(null)
      if (field.week) field.cancelPendingWeekLoad(field.week.weekStart)
    }
  }

  function goBack() {
    if (saving) return
    if (pickerOpen) {
      setPickerOpen(false)
      return
    }
    if (step > 1) {
      setStep((current) => (current - 1) as RouteDraftStep)
      setError(null)
      return
    }
    if (!hasUnsavedDraft) {
      safeFieldBack(routeHubFallback)
      return
    }
    Alert.alert(t("routeDiscardDraftTitle"), t("routeDiscardDraftBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("routeDiscardDraftConfirm"), style: "destructive", onPress: () => safeFieldBack(routeHubFallback) },
    ])
  }

  function goForward() {
    if (!canCreateRoute) {
      setError(t("routePlanningUnavailable"))
      return
    }
    if (selectedDateUnavailable) {
      setError(t("routePlanningDateUnavailable"))
      return
    }
    if (step === 1) {
      if (!selectedDate || !selectedAgent?.id) {
        setError(t("routeCreateRequired"))
        return
      }
      setError(null)
      setRouteConflict(null)
      setStep(2)
      return
    }
    if (step === 2) {
      if (targets.length === 0) {
        setError(t("routeCreateRequired"))
        return
      }
      setError(null)
      setRouteConflict(null)
      setStep(3)
      return
    }
    void create()
  }

  async function create() {
    if (!canCreateRoute) {
      setError(t("routePlanningUnavailable"))
      return
    }
    if (selectedDateUnavailable) {
      setError(t("routePlanningDateUnavailable"))
      return
    }
    const agentId = selectedAgent?.id
    const timezone = field.profile?.todaySummary.timezone ?? field.week?.timezone ?? "UTC"
    const plannedTimes = targets.map((target) => (
      target.time ? routePlannedTime(selectedDate ?? "", target.time, timezone) : null
    ))
    const invalidTime = targets.some((target, index) => (
      !isValidRouteTime(target.time) || Boolean(target.time && !plannedTimes[index])
    ))
    const localTimeConflict = localTimeConflicts[0]
    if (
      !agentId ||
      !selectedDate ||
      targets.length === 0 ||
      invalidTime
    ) {
      setError(invalidTime ? t("invalidRouteTime") : t("routeCreateRequired"))
      return
    }
    if (localTimeConflict) {
      setError(t("routeConflictTime", {
        points: localTimeConflict.indexes.map((index) => index + 1).join(", "),
        time: localTimeConflict.time,
      }))
      return
    }
    setSaving(true)
    setError(null)
    setRouteConflict(null)
    try {
      const input = {
        agentId,
        date: `${selectedDate}T00:00:00.000Z`,
        name: name.trim() || null,
        notes: notes.trim() || null,
        points: targets.map((target, index) => ({
          customerId: target.customer.id,
          contactId: target.contact?.id ?? null,
          plannedTime: plannedTimes[index] ?? null,
        })),
      }
      if (managerMode) {
        await fieldApi.createRoute({ ...input, status: "PLANNED" })
        Alert.alert(t("managerRoutePublished"), undefined, [{
          text: t("ok"),
          onPress: () => router.replace({ pathname: "/(app)/manager/planning", params: { date: selectedDate } } as never),
        }])
        return
      }
      const queued = enqueueFieldRouteCreate(input)
      const week = field.week!
      field.applyLocalWeek(addOptimisticRoute(week, {
        id: queued.localRouteId,
        agentId,
        date: selectedDate,
        name: input.name,
        notes: input.notes,
        points: targets.map((target, index) => ({
          id: `${queued.localRouteId}-point-${index}`,
          customerId: target.customer.id,
          contactId: target.contact?.id ?? null,
          orderIndex: index,
          status: "PENDING",
          effectiveStatus: "PENDING",
          plannedTime: plannedTimes[index] ?? null,
          visitedAt: null,
          notes: null,
          customer: target.customer,
          contact: target.contact,
          visitPolicy: null,
        })),
      }))
      await sync()
      const result = fieldRouteOutboxResult(queued.clientOpId)
      if (result?.status === "applied" && result.routeId) {
        await field.loadWeek(week.weekStart)
        router.replace(`/(app)/routes/${result.routeId}` as never)
      } else if (result?.status === "conflict" || result?.status === "rejected") {
        setRouteConflict(parseFieldRouteMutationConflict(result.detail))
        setError(fieldRouteConflictMessage(result.detail, "fieldDataError", timezone))
      } else {
        Alert.alert(t("routeQueued"))
        router.replace("/(app)/routes" as never)
      }
    } catch (cause) {
      setRouteConflict(parseFieldRouteMutationConflict(
        cause && typeof cause === "object" && "detail" in cause ? (cause as { detail?: unknown }).detail : null,
      ))
      setError(fieldRouteMutationErrorMessage(cause, managerMode ? "managerRoutePublishFailed" : "fieldDataError", timezone))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <FieldScreenChrome />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 20) + 94 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.content, layout.isTablet && styles.contentTablet]}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("back")}
            accessibilityState={{ disabled: saving, busy: saving }}
            disabled={saving}
            onPress={goBack}
            style={[styles.back, saving && styles.disabled]}
          >
            <TabIcon name="chevronLeft" color={colors.text} size={23} />
          </Pressable>
          <View style={styles.headerBody}><Text style={styles.eyebrow}>{(managerMode ? t("managerPlanningTitle") : t("routeHubTitle")).toUpperCase()}</Text><Text style={styles.title}>{copySource ? t("copyRoute") : managerMode ? t("managerPlanRoute") : t("createRoute")}</Text></View>
        </View>

        {!canCreateRoute && field.week ? <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{t("routePlanningUnavailable")}</Text></View> : null}

        <View style={styles.stepper}>
          {ROUTE_WIZARD_STEPS.map((item) => {
            const isActive = item.id === step
            const isComplete = item.id < step
            const stepDisabled = item.id >= step
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={t(item.label)}
                accessibilityState={{ selected: isActive, disabled: stepDisabled }}
                disabled={stepDisabled}
                onPress={() => {
                  setPickerOpen(false)
                  setError(null)
                  setStep(item.id)
                }}
                style={[styles.stepItem, stepDisabled && !isActive && styles.stepItemDisabled]}
              >
                <View style={[styles.stepMarker, isActive && styles.stepMarkerActive, isComplete && styles.stepMarkerComplete]}>
                  {isComplete ? <TabIcon name="check" color={colors.headerText} size={16} /> : <TabIcon name={item.icon} color={isActive ? colors.headerText : colors.primary} size={16} />}
                </View>
                <Text numberOfLines={2} style={[styles.stepText, isActive && styles.stepTextActive]}>{t(item.label)}</Text>
              </Pressable>
            )
          })}
        </View>

        {step === 1 ? (
          <>
            <View style={styles.wizardIntro}>
              <Text style={styles.sectionTitle}>{t("routeWizardStepDate")}</Text>
              <Text style={styles.wizardHint}>{t("routeWizardDateHint")}</Text>
            </View>
            <View style={styles.agentCard}>
              <View style={styles.agentIcon}><TabIcon name="profile" color={colors.primary} size={20} /></View>
              <View style={styles.agentBody}>
                <Text style={styles.agentLabel}>{t("routeWizardAgent")}</Text>
                <Text style={styles.agentName}>{selectedAgent?.name ?? t("fieldDataError")}</Text>
                <Text style={styles.agentHint}>{t(managerMode ? "managerRouteWizardAgentHint" : "routeWizardAgentHint")}</Text>
              </View>
            </View>
            <Text style={styles.sectionTitle}>{t("routeDate")}</Text>
            {selectedWeekIsLoading ? (
              <View accessible accessibilityLiveRegion="polite" style={styles.dateChecking}>
                <TabIcon name="refresh" color={colors.info} size={18} />
                <Text style={styles.dateCheckingText}>{t("routePlanningDateChecking")}</Text>
              </View>
            ) : null}
            {selectedDateUnavailable ? (
              <View accessibilityRole="alert" style={styles.dateUnavailable}>
                <TabIcon name="info" color={colors.info} size={18} />
                <Text style={styles.dateUnavailableText}>{t("routePlanningDateUnavailable")}</Text>
              </View>
            ) : null}
            {managerMode ? (
              <>
                <Text style={styles.managerSelectionHint}>{t("managerRouteWizardDateHint")}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("managerChangeRouteSelection")}
                  accessibilityHint={t("managerRouteWizardDateHint")}
                  accessibilityState={{ disabled: false }}
                  onPress={() => router.replace({ pathname: "/(app)/manager/planning", params: { date: selectedDate ?? "" } } as never)}
                  style={styles.managerChangeSelection}
                >
                  <TabIcon name="week" color={colors.primary} size={17} />
                  <Text style={styles.managerChangeSelectionText}>{t("managerChangeRouteSelection")}</Text>
                </Pressable>
              </>
              ) : (
                <FieldDayNavigator
                  days={availableDays.map((day) => {
                    const calendarDay = formatCalendarDay(day.date, locale)
                    const disabled = !day.routePlanningAllowed || day.date === copySource?.date.slice(0, 10)
                    return {
                      date: day.date,
                      isToday: day.isToday,
                      isWorkingDay: day.isWorkingDay,
                      disabled,
                      accessibilityLabel: [calendarDay.weekday, calendarDay.date, !day.isWorkingDay ? t("dayOff") : null].filter(Boolean).join(", "),
                    }
                  })}
                  selectedDate={selectedDate}
                  onSelectDate={selectDate}
                  onPrevious={() => moveDate(-1)}
                  onNext={() => moveDate(1)}
                  previousLabel={t("weekPreviousDay")}
                  nextLabel={t("weekNextDay")}
                  onCurrent={field.week ? () => selectDate(field.week!.today) : undefined}
                  currentActionLabel={t("tabToday")}
                  currentLabel={selectedDateLabel ?? t("routeDate")}
                  currentAccessibilityLabel={selectedDateLabel ?? t("routeDate")}
                  busy={saving || selectedWeekIsLoading}
                  dayHint={t("routeWizardDateHint")}
                  calendarPicker
                  todayDate={field.week?.today}
                  compactDay
                />
              )}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <View style={styles.wizardIntro}>
              <Text style={styles.sectionTitle}>{t("routeWizardStepStops")}</Text>
              <Text style={styles.wizardHint}>{t("routeWizardStopsHint")}</Text>
            </View>
            <View style={styles.pointsHeader}>
              <Text style={styles.sectionTitleInline}>{t("routeWizardSelectedStops")}</Text>
              <Text style={styles.count}>{targets.length}</Text>
            </View>
            {targets.length === 0 ? (
              <View style={styles.emptySelection}><TabIcon name="organizations" color={colors.primary} size={24} /><Text style={styles.emptySelectionText}>{t("routeWizardNoStops")}</Text></View>
            ) : targets.map((target, index) => (
              <View key={target.key} style={styles.selectionCard}>
                <View style={styles.index}><Text style={styles.indexText}>{index + 1}</Text></View>
                <View style={styles.targetBody}>
                  <Text style={styles.targetName}>{target.contact?.displayName ?? target.customer.name}</Text>
                  <Text style={styles.targetMeta}>{targetMeta(target)}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t("removeStop")}: ${targetAccessibilityName(target)}`}
                  accessibilityState={{ disabled: false }}
                  onPress={() => setTargets((current) => current.filter((item) => item.key !== target.key))}
                  style={[styles.iconButton, styles.remove]}
                >
                  <TabIcon name="close" color={colors.missed} size={20} />
                </Pressable>
              </View>
            ))}
            {!pickerOpen ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t("addStop")} accessibilityHint={t("chooseStop")} accessibilityState={{ disabled: false }} onPress={() => setPickerOpen(true)} style={styles.addTarget}><View style={styles.addTargetIcon}><TabIcon name="add" color={colors.headerText} size={22} /></View><View style={styles.addTargetBody}><Text style={styles.addTargetTitle}>{t("addStop")}</Text><Text style={styles.addTargetHint}>{t("chooseStop")}</Text></View></Pressable>
            ) : selectedAgent?.id && selectedDate ? (
              <RouteTargetPicker
                excluded={excluded}
                agentId={selectedAgent.id}
                agentName={selectedAgent.name}
                date={selectedDate}
                onSelect={(target) => { setTargets((current) => [...current, { ...target, time: "" }]); setError(null) }}
                onCancel={() => setPickerOpen(false)}
              />
            ) : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <View style={styles.wizardIntro}>
              <Text style={styles.sectionTitle}>{t("routeWizardStepReview")}</Text>
              <Text style={styles.wizardHint}>{t("routeWizardReviewHint")}</Text>
            </View>
            <View style={styles.reviewSummary}>
              <View style={styles.reviewRow}><TabIcon name="profile" color={colors.primary} size={18} /><Text style={styles.reviewValue}>{selectedAgent?.name ?? t("fieldDataError")}</Text></View>
              {selectedDateLabel ? <View style={styles.reviewRow}><TabIcon name="today" color={colors.primary} size={18} /><Text style={styles.reviewValue}>{selectedDateLabel}</Text></View> : null}
              <View style={styles.reviewRow}><TabIcon name="organizations" color={colors.primary} size={18} /><Text style={styles.reviewValue}>{targets.length} {t("routePointsLabel")}</Text></View>
            </View>
            <View style={styles.card}>
              <Text style={styles.label}>{t("routeName")}</Text>
              <TextInput accessibilityLabel={t("routeName")} accessibilityState={{ disabled: false }} value={name} onChangeText={setName} style={styles.input} placeholder={t("createRoute")} placeholderTextColor={colors.faint} />
              <Text style={styles.label}>{t("routeNotes")}</Text>
              <TextInput accessibilityLabel={t("routeNotes")} accessibilityState={{ disabled: false }} value={notes} onChangeText={setNotes} style={[styles.input, styles.notes]} multiline textAlignVertical="top" placeholderTextColor={colors.faint} />
            </View>
            {managerMode ? <View style={styles.managerPublishNotice}><TabIcon name="info" color={colors.info} size={18} /><Text style={styles.managerPublishNoticeText}>{t("managerRouteOnlineRequired")}</Text></View> : null}
            <View style={styles.pointsHeader}><Text style={styles.sectionTitleInline}>{t("routeRoadmap")}</Text><Text style={styles.count}>{targets.length}</Text></View>
            {targets.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={t("autoSchedule")} accessibilityState={{ disabled: false }} onPress={autoSchedule} style={styles.autoSchedule}><Text style={styles.autoScheduleText}>{t("autoSchedule")}</Text></Pressable> : null}
            {targets.map((target, index) => {
              const expanded = expandedTargetKey === target.key
              const targetTimeConflict = localTimeConflicts.find((conflict) => conflict.indexes.includes(index))
              const targetTimeHint = !isValidRouteTime(target.time)
                ? t("invalidRouteTime")
                : targetTimeConflict
                  ? t("routeConflictTime", {
                    points: targetTimeConflict.indexes.map((conflictIndex) => conflictIndex + 1).join(", "),
                    time: targetTimeConflict.time,
                  })
                  : t("plannedTimeHint")
              return (
                <View key={target.key} style={[styles.targetCard, expanded && styles.targetCardExpanded]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${expanded ? t("routeHideStopSettings") : t("routeEditStopSettings")}: ${targetAccessibilityName(target)}. ${t("plannedTime")}: ${target.time || t("routeTimeNotSet")}`}
                    accessibilityState={{ expanded }}
                    onPress={() => setExpandedTargetKey((current) => current === target.key ? null : target.key)}
                    style={({ pressed }) => [styles.targetSummary, pressed && styles.pressed]}
                  >
                    <View style={styles.index}><Text style={styles.indexText}>{index + 1}</Text></View>
                    <View style={styles.targetBody}>
                      <Text numberOfLines={1} style={styles.targetName}>{target.contact?.displayName ?? target.customer.name}</Text>
                      <View style={styles.targetMetaRow}>
                        <Text numberOfLines={1} style={styles.targetMeta}>{targetMeta(target)}</Text>
                        <View accessible={false} style={[styles.targetTimePill, !isValidRouteTime(target.time) && styles.targetTimePillAttention]}>
                          <TabIcon name="week" color={!isValidRouteTime(target.time) ? colors.missed : colors.primary} size={13} />
                          <Text style={[styles.targetTimeText, !isValidRouteTime(target.time) && styles.targetTimeTextAttention]}>{target.time || t("routeTimeNotSet")}</Text>
                        </View>
                      </View>
                    </View>
                    <View accessible={false} style={styles.targetExpandControl}><TabIcon name={expanded ? "chevronUp" : "chevronDown"} color={colors.primary} size={19} /></View>
                  </Pressable>
                  {expanded ? <View style={styles.targetEditor}>
                    <View style={styles.targetActions}>
                      <Pressable accessibilityRole="button" accessibilityLabel={`${t("moveUp")}: ${targetAccessibilityName(target)}`} accessibilityState={{ disabled: index === 0 }} disabled={index === 0} onPress={() => setTargets((current) => reorder(current, index, index - 1))} style={[styles.targetAction, index === 0 && styles.disabled]}><TabIcon name="chevronUp" color={colors.primary} size={18} /><Text style={styles.targetActionText}>{t("moveUp")}</Text></Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={`${t("moveDown")}: ${targetAccessibilityName(target)}`} accessibilityState={{ disabled: index === targets.length - 1 }} disabled={index === targets.length - 1} onPress={() => setTargets((current) => reorder(current, index, index + 1))} style={[styles.targetAction, index === targets.length - 1 && styles.disabled]}><TabIcon name="chevronDown" color={colors.primary} size={18} /><Text style={styles.targetActionText}>{t("moveDown")}</Text></Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={`${t("removeStop")}: ${targetAccessibilityName(target)}`} accessibilityState={{ disabled: false }} onPress={() => { setTargets((current) => current.filter((item) => item.key !== target.key)); setExpandedTargetKey(null) }} style={[styles.targetAction, styles.targetActionRemove]}><TabIcon name="close" color={colors.missed} size={18} /><Text style={styles.targetActionRemoveText}>{t("removeStop")}</Text></Pressable>
                    </View>
                    <View style={styles.timeBlock}>
                      <Text style={styles.timeLabel}>{t("plannedTime")}</Text>
                      <TextInput
                        accessibilityLabel={`${t("plannedTime")}: ${targetAccessibilityName(target)}`}
                        accessibilityHint={targetTimeHint}
                        accessibilityState={{ disabled: false }}
                        accessibilityValue={{ text: target.time || t("plannedTimeHint") }}
                        value={target.time}
                        onChangeText={(value) => {
                          setTargets((current) => current.map((item) => item.key === target.key ? { ...item, time: value } : item))
                          setRouteConflict(null)
                          setError(null)
                        }}
                        placeholder="09:30"
                        placeholderTextColor={colors.faint}
                        keyboardType="numbers-and-punctuation"
                        maxLength={5}
                        style={[
                          styles.timeInput,
                          !isValidRouteTime(target.time) && styles.timeInputInvalid,
                          conflictingTargetIndexes.has(index) && styles.timeInputConflict,
                        ]}
                      />
                    </View>
                  </View> : null}
                </View>
              )
            })}
          </>
        ) : null}

        {error ? <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
        {routeConflict?.kind === "duplicate" && routeConflict.duplicateRouteId ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("openRoute")} accessibilityState={{ disabled: false }} onPress={() => router.replace(`/(app)/routes/${routeConflict.duplicateRouteId}` as never)} style={styles.openConflictRoute}>
            <Text style={styles.openConflictRouteText}>{t("openRoute")}</Text>
          </Pressable>
        ) : null}
        </View>
      </ScrollView>
      <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom, 10) + 8 }]}>
        <View style={[styles.footer, layout.isTablet && styles.contentTablet]}>
          {step > 1 ? <Pressable accessibilityRole="button" accessibilityLabel={t("back")} accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={goBack} style={[styles.footerBack, saving && styles.disabled]}><Text style={styles.footerBackText}>{t("back")}</Text></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={saving ? t("saving") : submitLabel} accessibilityState={{ disabled: submitDisabled, busy: saving }} disabled={submitDisabled} onPress={goForward} style={[styles.submit, step > 1 && styles.submitCompact, submitDisabled && styles.disabled]}><Text style={styles.submitText}>{saving ? t("saving") : submitLabel}</Text></Pressable>
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 34 },
  content: { width: "100%" },
  contentTablet: { maxWidth: 1_060, alignSelf: "center" },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 2 },
  stepper: { marginHorizontal: 14, marginTop: 14, flexDirection: "row", alignItems: "flex-start", gap: 4 },
  stepItem: { flex: 1, minHeight: 58, alignItems: "center", gap: 6, paddingHorizontal: 2 },
  stepItemDisabled: { opacity: 0.42 },
  stepMarker: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.primary },
  stepMarkerActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepMarkerComplete: { backgroundColor: colors.success, borderColor: colors.success },
  stepText: { color: colors.muted, fontSize: 11, lineHeight: 14, fontWeight: "800", textAlign: "center" },
  stepTextActive: { color: colors.text },
  wizardIntro: {},
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900", marginHorizontal: 16, marginTop: 20, marginBottom: 4 },
  wizardHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginHorizontal: 16 },
  agentCard: { marginHorizontal: 14, marginTop: 13, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "flex-start", gap: 11, ...cardShadow },
  agentIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  agentBody: { flex: 1, minWidth: 0 },
  agentLabel: { color: colors.primary, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.7 },
  agentName: { color: colors.text, fontSize: 14, fontWeight: "900", marginTop: 2 },
  agentHint: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  selectedDate: { color: colors.primary, fontSize: 12, fontWeight: "800", marginHorizontal: 16, marginBottom: 10 },
  dateChecking: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 14, marginBottom: 10, padding: 10, borderRadius: radii.inner, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder },
  dateCheckingText: { flex: 1, color: colors.info, fontSize: 12, lineHeight: 17, fontWeight: "800" },
  dateUnavailable: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginHorizontal: 14, marginBottom: 10, padding: 10, borderRadius: radii.inner, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder },
  dateUnavailableText: { flex: 1, color: colors.info, fontSize: 12, lineHeight: 17, fontWeight: "800" },
  managerSelectionHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginHorizontal: 16, marginBottom: 10 },
  managerChangeSelection: { minHeight: 46, marginHorizontal: 14, borderRadius: 13, paddingHorizontal: 13, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  managerChangeSelectionText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  days: { paddingHorizontal: 14, gap: 8 },
  day: { width: 57, height: 65, borderRadius: 16, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  daySelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayDisabled: { opacity: 0.32 },
  dayNumber: { color: colors.text, fontSize: 17, fontWeight: "900" },
  dayNumberSelected: { color: colors.headerText },
  dayMonth: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  dayMonthSelected: { color: colors.headerSubtext },
  dayOffDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.holiday, marginTop: 3 },
  dayOffDotSelected: { backgroundColor: colors.headerSubtext },
  weekNavigation: { marginHorizontal: 14, marginTop: 9, flexDirection: "row", gap: 8 },
  weekButton: { flex: 1, minHeight: 44, borderRadius: 11, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5, paddingHorizontal: 8 },
  weekButtonText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  pointsHeader: { marginHorizontal: 16, marginTop: 20, marginBottom: 5, flexDirection: "row", alignItems: "center", gap: 7 },
  sectionTitleInline: { color: colors.text, fontSize: 15, fontWeight: "900" },
  count: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: colors.primarySoft, color: colors.primary, fontSize: 11, fontWeight: "900", lineHeight: 24, textAlign: "center" },
  emptySelection: { marginHorizontal: 14, marginTop: 9, minHeight: 112, borderRadius: radii.card, padding: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", gap: 9 },
  emptySelectionText: { color: colors.muted, fontSize: 12, lineHeight: 17, fontWeight: "700", textAlign: "center", maxWidth: 290 },
  selectionCard: { marginHorizontal: 14, marginTop: 9, minHeight: 64, borderRadius: radii.card, padding: 10, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: colors.border },
  card: { marginHorizontal: 14, marginTop: 15, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, ...cardShadow },
  reviewSummary: { marginHorizontal: 14, marginTop: 13, borderRadius: radii.card, padding: 13, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  reviewRow: { minHeight: 30, flexDirection: "row", alignItems: "center", gap: 9 },
  reviewValue: { flex: 1, minWidth: 0, color: colors.text, fontSize: 12, fontWeight: "800" },
  managerPublishNotice: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.inner, padding: 11, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  managerPublishNoticeText: { flex: 1, color: colors.info, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  label: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 5, marginBottom: 6 },
  input: { minHeight: 46, borderRadius: radii.inner, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, color: colors.text, fontSize: 13 },
  notes: { minHeight: 80, paddingTop: 11 },
  targetCard: { marginHorizontal: 14, marginTop: 9, minHeight: 66, borderRadius: radii.card, padding: 11, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  targetCardExpanded: { borderColor: colors.primary, backgroundColor: colors.card },
  targetSummary: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 9 },
  index: { width: 31, height: 31, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  indexText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  targetBody: { flex: 1, minWidth: 0 },
  targetName: { color: colors.text, fontSize: 13, fontWeight: "900" },
  targetMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  targetMeta: { flex: 1, minWidth: 0, color: colors.muted, fontSize: 11, lineHeight: 15 },
  targetTimePill: { minHeight: 24, borderRadius: radii.pill, paddingHorizontal: 7, backgroundColor: colors.primarySoft, flexDirection: "row", alignItems: "center", gap: 3 },
  targetTimePillAttention: { backgroundColor: colors.missedBg },
  targetTimeText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  targetTimeTextAttention: { color: colors.missed },
  targetExpandControl: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  targetEditor: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 },
  targetActions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  targetAction: { minHeight: 44, borderRadius: 11, paddingHorizontal: 11, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 },
  targetActionText: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  targetActionRemove: { backgroundColor: colors.missedBg },
  targetActionRemoveText: { color: colors.missed, fontSize: 12, fontWeight: "900" },
  iconButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  remove: { backgroundColor: colors.missedBg },
  timeBlock: { flexDirection: "row", alignItems: "center", gap: 8 },
  timeLabel: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  timeInput: { width: 78, height: 44, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, color: colors.text, fontSize: 12, fontWeight: "900", textAlign: "center" },
  timeInputInvalid: { borderColor: colors.missed, backgroundColor: colors.missedBg },
  timeInputConflict: { borderColor: colors.warning, backgroundColor: colors.warningBg },
  autoSchedule: { alignSelf: "flex-start", marginHorizontal: 14, marginTop: 5, minHeight: 44, borderRadius: 11, paddingHorizontal: 12, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" },
  autoScheduleText: { color: colors.info, fontSize: 12, fontWeight: "900" },
  addTarget: { marginHorizontal: 14, marginTop: 9, minHeight: 64, borderRadius: radii.card, borderWidth: 1, borderStyle: "dashed", borderColor: colors.primary, backgroundColor: colors.primarySoft, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  addTargetIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  addTargetBody: { flex: 1 },
  addTargetTitle: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  addTargetHint: { color: colors.muted, fontSize: 11, marginTop: 3 },
  error: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.inner, padding: 11, backgroundColor: colors.dangerBg },
  errorText: { color: colors.missed, fontSize: 11, fontWeight: "800" },
  openConflictRoute: { marginHorizontal: 14, marginTop: 9, minHeight: 46, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.infoBorder, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" },
  openConflictRouteText: { color: colors.info, fontSize: 12, fontWeight: "900" },
  stickyFooter: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 14, paddingTop: 10 },
  footer: { width: "100%", flexDirection: "row", gap: 8 },
  footerBack: { minWidth: 96, minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  footerBackText: { color: colors.text, fontSize: 13, fontWeight: "900" },
  submit: { flex: 1, minHeight: 52, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  submitCompact: { flex: 1 },
  submitText: { color: colors.headerText, fontSize: 14, fontWeight: "900" },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.38 },
})
