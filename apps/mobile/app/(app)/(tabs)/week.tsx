import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { useField } from "../../../src/field/field-context"
import {
  routeStatusMeta,
  FIELD_WEEK_VIEW_RANGES,
  shiftDateKey,
  startOfIsoWeek,
  type FieldWeekViewRange,
  type RouteStatusTone,
  visibleFieldWeekDays,
} from "../../../src/field/week-status"
import { t, useLocale } from "../../../src/i18n"
import { formatCalendarDay, formatCalendarRange } from "../../../src/i18n/date-format"
import { TabIcon } from "../../../src/components/TabIcon"
import { FieldScreenChrome } from "../../../src/components/FieldScreenChrome"
import { FieldDayNavigator } from "../../../src/field/FieldDayNavigator"
import { resolveFieldRouteFlow, type FieldRouteStep } from "../../../src/field/route-flow"
import { objectTypeLabel } from "../../../src/field/labels"
import { colors, cardShadow, radii } from "../../../src/theme"
import { useResponsiveLayout } from "../../../src/layout/responsive"
import type { FieldWeekVisit } from "../../../src/field/contracts"

const tones: Record<RouteStatusTone, { bg: string; border: string; text: string; dot: string }> = {
  draft: { bg: colors.draftBg, border: colors.draftBorder, text: colors.draft, dot: colors.draft },
  planned: { bg: colors.infoBg, border: colors.infoBorder, text: colors.info, dot: colors.info },
  inProgress: { bg: colors.warningBg, border: colors.warningBorder, text: colors.warning, dot: colors.warning },
  completed: { bg: colors.successBg, border: colors.successBorder, text: colors.successDark, dot: colors.success },
  cancelled: { bg: colors.draftBg, border: colors.draftBorder, text: colors.draft, dot: colors.faint },
  missed: { bg: colors.missedBg, border: colors.missedBorder, text: colors.missed, dot: colors.missed },
}

function routeRailTone(state: FieldRouteStep["state"]): { background: string; color: string; line: string } {
  if (state === "completed") return { background: colors.successBg, color: colors.successDark, line: colors.successBorder }
  if (state === "missed") return { background: colors.missedBg, color: colors.missed, line: colors.missedBorder }
  if (state === "active") return { background: colors.primary, color: colors.headerText, line: colors.primary }
  if (state === "next") return { background: colors.primarySoft, color: colors.primary, line: colors.primary }
  return { background: colors.surfaceMuted, color: colors.muted, line: colors.borderStrong }
}

function routeStepLabel(state: FieldRouteStep["state"]): string {
  if (state === "completed") return t("routeCompletedStop")
  if (state === "active") return t("routeCurrentVisit")
  if (state === "next") return t("routeNextStop")
  if (state === "missed") return t("routeMissedStop")
  return t("routeUpcomingStop")
}

function RouteProgressRail({ routeLabel, steps }: { routeLabel: string; steps: FieldRouteStep[] }) {
  if (steps.length < 2) return null
  const activeIndex = steps.findIndex((step) => step.state === "active")
  const nextIndex = steps.findIndex((step) => step.state === "next")
  const focalIndex = activeIndex >= 0 ? activeIndex : nextIndex >= 0 ? nextIndex : steps.length - 1
  const start = Math.max(0, Math.min(focalIndex - 1, steps.length - 4))
  const visibleSteps = steps.slice(start, start + 4)
  const hiddenBefore = start
  const hiddenAfter = Math.max(0, steps.length - start - visibleSteps.length)
  const label = `${routeLabel}. ${t("routeRoadmap")}: ${steps.map((step) => `${step.position} ${routeStepLabel(step.state)}`).join(", ")}`
  return (
    <View accessible accessibilityRole="summary" accessibilityLabel={label} style={styles.roadmapSummary}>
      <Text style={styles.roadmapSummaryTitle}>{t("routeRoadmap")}</Text>
      <View style={styles.roadmapSummaryRail}>
        {hiddenBefore > 0 ? <View style={styles.roadmapSummaryOverflow}><Text style={styles.roadmapSummaryOverflowText}>+{hiddenBefore}</Text></View> : null}
        {visibleSteps.map((step, index) => {
          const tone = routeRailTone(step.state)
          const last = index === visibleSteps.length - 1 && hiddenAfter === 0
          return <View key={step.point.id} style={styles.roadmapSummaryStep}>
            <View style={[styles.roadmapSummaryNode, { backgroundColor: tone.background }]}>
              {step.state === "completed" ? <TabIcon name="check" color={tone.color} size={16} /> : step.state === "missed" ? <TabIcon name="alert" color={tone.color} size={15} /> : step.state === "active" ? <TabIcon name="visit" color={tone.color} size={16} /> : <Text style={[styles.roadmapSummaryNodeText, { color: tone.color }]}>{step.position}</Text>}
            </View>
            {!last ? <View style={[styles.roadmapSummaryLine, { backgroundColor: tone.line }]} /> : null}
          </View>
        })}
        {hiddenAfter > 0 ? <View style={styles.roadmapSummaryOverflow}><Text style={styles.roadmapSummaryOverflowText}>+{hiddenAfter}</Text></View> : null}
      </View>
    </View>
  )
}

export default function WeekTab() {
  const locale = useLocale()
  const field = useField()
  const { date: dateParameter } = useLocalSearchParams<{ date?: string }>()
  const requestedDate = typeof dateParameter === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateParameter)
    ? dateParameter
    : null
  const week = field.week
  const operationalDate = field.operationalDate
  const setOperationalDate = field.setOperationalDate
  const cancelPendingWeekLoad = field.cancelPendingWeekLoad
  const loadWeek = field.loadWeek
  const busy = field.phase === "loading" || field.phase === "refreshing"
  const layout = useResponsiveLayout()
  const isCurrentWeek = Boolean(week && week.weekStart === startOfIsoWeek(week.today))
  const [viewRange, setViewRange] = useState<FieldWeekViewRange>((requestedDate ?? operationalDate) ? 1 : 7)
  const [selectedDate, setSelectedDate] = useState<string | null>(requestedDate ?? operationalDate)
  const [expandedRouteRoadmaps, setExpandedRouteRoadmaps] = useState<Set<string>>(() => new Set())
  const selectedWeekStart = useRef<string | null>(null)
  const requestedDateHandled = useRef<string | null>(null)
  const activeDate = selectedDate ?? week?.days.find((day) => day.isToday)?.date ?? week?.today ?? null
  const visibleDays = useMemo(
    () => visibleFieldWeekDays(week?.days ?? [], activeDate, viewRange),
    [activeDate, viewRange, week?.days],
  )
  const selectedDay = useMemo(
    () => week?.days.find((day) => day.date === activeDate) ?? null,
    [activeDate, week?.days],
  )
  const activeVisit = useMemo<FieldWeekVisit | null>(() => (
    week?.days.flatMap((day) => day.visits.items).find((visit) => visit.status === "CHECKED_IN") ?? null
  ), [week?.days])

  const selectOperationalDay = useCallback((date: string) => {
    setSelectedDate(date)
    setViewRange(1)
    setOperationalDate(date)
    if (week && startOfIsoWeek(date) === week.weekStart) {
      cancelPendingWeekLoad(week.weekStart)
      return
    }
    void loadWeek(startOfIsoWeek(date))
  }, [cancelPendingWeekLoad, loadWeek, setOperationalDate, week])

  useEffect(() => {
    if (!week) return
    if (selectedWeekStart.current === week.weekStart) return
    selectedWeekStart.current = week.weekStart
    const nextDate = selectedDate && week.days.some((day) => day.date === selectedDate)
      ? selectedDate
      : week.days.find((day) => day.isToday)?.date ?? week.days[0]?.date ?? null
    setSelectedDate((current) => (
      current && week.days.some((day) => day.date === current)
        ? current
        : nextDate
    ))
    if (nextDate && nextDate !== operationalDate) setOperationalDate(nextDate)
  }, [operationalDate, selectedDate, setOperationalDate, week])

  useEffect(() => {
    const contextDate = operationalDate
    if (!contextDate || contextDate === selectedDate) return
    setSelectedDate(contextDate)
    setViewRange(1)
    if (week && startOfIsoWeek(contextDate) !== week.weekStart) void loadWeek(startOfIsoWeek(contextDate))
  }, [loadWeek, operationalDate, selectedDate, week])

  useEffect(() => {
    if (!requestedDate || requestedDateHandled.current === requestedDate) return
    requestedDateHandled.current = requestedDate
    selectOperationalDay(requestedDate)
  }, [requestedDate, selectOperationalDay])

  const move = (days: -1 | 1) => {
    if (!week) return
    if (viewRange === 1) {
      const nextDate = shiftDateKey(activeDate ?? week.today, days)
      selectOperationalDay(nextDate)
      return
    }
    void field.loadWeek(shiftDateKey(week.weekStart, days * 7))
  }

  const previousTarget = week
    ? shiftDateKey(viewRange === 1 ? activeDate ?? week.today : week.weekStart, viewRange === 1 ? -1 : -7)
    : null
  const nextTarget = week
    ? shiftDateKey(viewRange === 1 ? activeDate ?? week.today : week.weekStart, viewRange === 1 ? 1 : 7)
    : null
  const navigationLabel = viewRange === 1 ? t("weekPreviousDay") : t("previousWeek")
  const nextNavigationLabel = viewRange === 1 ? t("weekNextDay") : t("nextWeek")
  const currentNavigationLabel = viewRange === 1 && activeDate
    ? formatCalendarDay(activeDate, locale).date
    : week ? formatCalendarRange(week.weekStart, week.weekEndExclusive, locale) : t("currentWeek")
  const currentNavigationAccessibilityLabel = viewRange === 1 && activeDate
    ? (() => {
        const day = formatCalendarDay(activeDate, locale)
        return `${day.weekday}, ${day.date}`
      })()
    : currentNavigationLabel
  const canReturnToToday = Boolean(week && (!isCurrentWeek || activeDate !== week.today || viewRange !== 1))

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <FieldScreenChrome />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void field.refresh()} />}
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow}>{t("tabWeek").toUpperCase()}</Text>
          <Text accessibilityRole="header" style={styles.title}>{t("weekSchedule")}</Text>
        </View>

        {week ? (
          <FieldDayNavigator
            days={visibleDays.map((day) => {
              const formatted = formatCalendarDay(day.date, locale)
              const route = day.routes[0]
              const routeDot = route ? tones[routeStatusMeta(route.effectiveStatus).tone].dot : null
              return {
                date: day.date,
                isToday: day.isToday,
                isWorkingDay: day.isWorkingDay,
                dotColor: routeDot ?? (!day.isWorkingDay ? colors.holiday : undefined),
                accessibilityLabel: [
                  formatted.weekday,
                  formatted.date,
                  day.isToday ? t("tabToday") : null,
                  day.routes.length > 0 ? `${day.routes.length} ${t("tabRoute")}` : null,
                  day.tasks.total > 0 ? `${day.tasks.completed}/${day.tasks.total} ${t("dayTasks")}` : null,
                  !day.isWorkingDay ? day.nonWorkingReason ?? t("dayOff") : null,
                ].filter(Boolean).join(", "),
              }
            })}
            selectedDate={activeDate}
            onSelectDate={selectOperationalDay}
            onPrevious={() => move(-1)}
            onNext={() => move(1)}
            previousLabel={previousTarget ? `${navigationLabel}: ${formatCalendarDay(previousTarget, locale).date}` : navigationLabel}
            nextLabel={nextTarget ? `${nextNavigationLabel}: ${formatCalendarDay(nextTarget, locale).date}` : nextNavigationLabel}
            onCurrent={canReturnToToday ? () => {
              selectOperationalDay(week.today)
            } : undefined}
            currentLabel={currentNavigationLabel}
            currentAccessibilityLabel={currentNavigationAccessibilityLabel}
            currentActionLabel={t("tabToday")}
            busy={busy}
            rangeOptions={FIELD_WEEK_VIEW_RANGES}
            selectedRange={viewRange}
            onSelectRange={(range) => setViewRange(range as FieldWeekViewRange)}
            getRangeLabel={(days) => t("weekRange", { count: days })}
            dayHint={t("dailyMission")}
            visibleHint={viewRange === 1 ? undefined : t("fieldDayNavigatorHint")}
            calendarPicker
            todayDate={week.today}
          />
        ) : null}

        {field.phase === "stale" || field.phase === "error" ? (
          <View style={styles.offlineNotice}>
            <Text accessibilityLiveRegion="polite" style={styles.offlineText}>{field.phase === "error" ? t("fieldDataError") : t("fieldDataStale")}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("refresh")}
              accessibilityHint={t("weekSchedule")}
              accessibilityState={{ disabled: false, busy }}
              onPress={() => void field.refresh()}
              style={({ pressed }) => [styles.retryAction, pressed && styles.pressed]}
            >
              <Text style={styles.retry}>{t("refresh")}</Text>
            </Pressable>
          </View>
        ) : null}

        {!week && !busy ? (
          <View style={styles.emptyCard}>
            <Text accessibilityLiveRegion="polite" style={styles.emptyTitle}>{t("fieldDataError")}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("refresh")}
              accessibilityHint={t("weekSchedule")}
              accessibilityState={{ disabled: false, busy: false }}
              onPress={() => void field.refresh()}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.primaryText}>{t("refresh")}</Text>
            </Pressable>
          </View>
        ) : null}

        {selectedDay ? (() => {
          const formatted = formatCalendarDay(selectedDay.date, locale)
          const isDayOff = !selectedDay.isWorkingDay
          const dayLabel = [formatted.weekday, formatted.date, selectedDay.isToday ? t("tabToday") : null, isDayOff ? selectedDay.nonWorkingReason ?? t("dayOff") : null].filter(Boolean).join(", ")
          const missionLabel = [
            t("dailyMission"),
            selectedDay.tasks.total > 0 ? `${selectedDay.tasks.completed}/${selectedDay.tasks.total} ${t("dayTasks")}` : null,
            selectedDay.visits.total > 0 ? `${selectedDay.visits.completed}/${selectedDay.visits.total} ${t("dayVisits")}` : null,
          ].filter(Boolean).join(", ")
          return (
            <View style={[styles.missionSurface, layout.isTablet && styles.missionSurfaceTablet, isDayOff && styles.missionSurfaceDayOff]}>
              <View accessible accessibilityRole="header" accessibilityLabel={dayLabel} style={styles.missionHeader}>
                <View style={styles.missionHeading}>
                  <Text style={styles.missionEyebrow}>{t("dailyMission")}</Text>
                  <Text style={styles.missionDate}>{formatted.weekday}, {formatted.date}</Text>
                </View>
                {selectedDay.isToday ? <View style={styles.todayPill}><Text style={styles.todayPillText}>{t("tabToday")}</Text></View> : null}
              </View>

              {isDayOff ? (
                <View accessible accessibilityRole="summary" accessibilityLabel={dayLabel} style={styles.dayOffLine}>
                  <View style={styles.holidayDot} />
                  <Text style={styles.dayOffText}>{selectedDay.nonWorkingReason ?? t("dayOff")}</Text>
                </View>
              ) : null}

              {selectedDay.tasks.total > 0 || selectedDay.visits.total > 0 ? (
                <View accessible accessibilityRole="summary" accessibilityLabel={missionLabel} style={styles.missionMetrics}>
                  {selectedDay.tasks.total > 0 ? (
                    <View style={styles.missionMetric}>
                      <TabIcon name="tasks" color={colors.primary} size={17} />
                      <Text style={styles.missionMetricText}>{selectedDay.tasks.completed}/{selectedDay.tasks.total} {t("dayTasks")}</Text>
                    </View>
                  ) : null}
                  {selectedDay.visits.total > 0 ? (
                    <View style={styles.missionMetric}>
                      <TabIcon name="visit" color={colors.successDark} size={17} />
                      <Text style={styles.missionMetricText}>{selectedDay.visits.completed}/{selectedDay.visits.total} {t("dayVisits")}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {selectedDay.routes.length === 0 ? (
                <View style={styles.emptyDay}>
                  <Text accessibilityLabel={`${dayLabel}. ${t("noPlansForSelectedDay")}`} style={styles.noPlans}>{t("noPlansForSelectedDay")}</Text>
                  {selectedDay.routePlanningAllowed ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("createRoute")}
                      accessibilityHint={dayLabel}
                      accessibilityState={{ disabled: false, busy: false }}
                      onPress={() => router.push(("/(app)/routes/new?date=" + encodeURIComponent(selectedDay.date)) as never)}
                      style={({ pressed }) => [styles.createRouteAction, pressed && styles.pressed]}
                    >
                      <Text style={styles.createRouteActionText}>{t("createRoute")}</Text>
                      <TabIcon name="chevronRight" color={colors.headerText} size={19} />
                    </Pressable>
                  ) : !isDayOff ? (
                    <View accessible accessibilityRole="summary" accessibilityLabel={`${dayLabel}. ${t("routePlanningDateUnavailable")}`} style={styles.routeUnavailable}>
                      <TabIcon name="info" color={colors.info} size={16} />
                      <Text style={styles.routeUnavailableText}>{t("routePlanningDateUnavailable")}</Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.routeList}>
                  {selectedDay.routes.map((route) => {
                    const meta = routeStatusMeta(route.effectiveStatus)
                    const tone = tones[meta.tone]
                    const activeVisitForRoute = activeVisit?.routeId === route.id ? activeVisit : null
                    const routeFlow = resolveFieldRouteFlow(route, activeVisitForRoute)
                    const primaryPoint = routeFlow.primaryPoint
                    const roadmapExpanded = expandedRouteRoadmaps.has(route.id)
                    const percent = route.totalPoints ? Math.round((route.visitedPoints / route.totalPoints) * 100) : 0
                    const progressPercent = Math.min(100, percent)
                    const routeLabel = route.name ?? t("tabRoute")
                    const routeProgressLabel = `${route.visitedPoints}/${route.totalPoints} ${t("routePointsLabel")}`
                    const routeActionLabel = route.canEdit
                      ? t("editRoute")
                      : activeVisitForRoute
                        ? t("continueFieldVisit")
                        : t("openRoute")
                    const primaryPointName = primaryPoint?.contact?.displayName ?? primaryPoint?.customer.name ?? null
                    const primaryPointMeta = primaryPoint
                      ? primaryPoint.customer.address ?? primaryPoint.customer.city ?? objectTypeLabel(primaryPoint.customer.objectType)
                      : null
                    return (
                      <View key={route.id} style={styles.routeCard}>
                        <View style={styles.routeTop}>
                          <View style={styles.routeBody}>
                            <Text style={styles.routeName}>{routeLabel}</Text>
                            <Text style={styles.routeMeta}>{route.totalPoints} {t("routePointsLabel")} · {route.visitedPoints} {t("routeVisitedLabel")}</Text>
                          </View>
                          <View accessible accessibilityRole="summary" accessibilityLabel={t(meta.labelKey)} style={[styles.statusPill, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                            <View style={[styles.statusDot, { backgroundColor: tone.dot }]} />
                            <Text style={[styles.statusText, { color: tone.text }]}>{t(meta.labelKey)}</Text>
                          </View>
                        </View>
                        <View
                          accessible
                          accessibilityRole="progressbar"
                          accessibilityLabel={`${routeLabel}. ${routeProgressLabel}`}
                          accessibilityValue={{ min: 0, max: 100, now: progressPercent, text: `${progressPercent}%` }}
                          style={styles.progressTrack}
                        >
                          <View style={[styles.progressFill, { width: `${progressPercent}%`, backgroundColor: tone.dot }]} />
                        </View>
                        <RouteProgressRail routeLabel={routeLabel} steps={routeFlow.steps} />
                        {primaryPointName ? (
                          <View style={[styles.nextStopSurface, activeVisitForRoute && styles.nextStopSurfaceActive]}>
                            <View style={[styles.nextStopIcon, activeVisitForRoute && styles.nextStopIconActive]}><TabIcon name="visit" color={activeVisitForRoute ? colors.successDark : colors.primary} size={19} /></View>
                            <View style={styles.nextStopBody}>
                              <Text style={[styles.nextStopLabel, activeVisitForRoute && styles.nextStopLabelActive]}>{activeVisitForRoute ? t("routeCurrentVisit") : t("routeNextStop")}</Text>
                              <Text style={styles.nextStopName} numberOfLines={1}>{primaryPointName}</Text>
                              {primaryPointMeta ? <Text style={styles.nextStopMeta} numberOfLines={1}>{primaryPointMeta}</Text> : null}
                            </View>
                          </View>
                        ) : null}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${routeActionLabel}: ${routeLabel}`}
                          accessibilityHint={`${t(meta.labelKey)}. ${routeProgressLabel}`}
                          accessibilityState={{ disabled: false, busy: route.syncState === "PENDING" }}
                          onPress={() => {
                            if (activeVisitForRoute) {
                              router.push(`/(app)/field-visits/${activeVisitForRoute.id}` as never)
                            } else {
                              router.push(`/(app)/routes/${route.id}` as never)
                            }
                          }}
                          style={({ pressed }) => [styles.routeAction, pressed && styles.pressed]}
                        >
                          <Text style={styles.routeActionText}>{routeActionLabel}</Text>
                          <TabIcon name="chevronRight" color={colors.headerText} size={19} />
                        </Pressable>
                        {route.points.length > 1 ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`${roadmapExpanded ? t("routeHideStops") : t("routeShowStops")}: ${t("routeRoadmap")}`}
                            accessibilityState={{ expanded: roadmapExpanded }}
                            onPress={() => setExpandedRouteRoadmaps((current) => {
                              const next = new Set(current)
                              if (next.has(route.id)) next.delete(route.id)
                              else next.add(route.id)
                              return next
                            })}
                            style={({ pressed }) => [styles.roadmapToggle, pressed && styles.pressed]}
                          >
                            <View style={styles.roadmapToggleBody}><Text style={styles.roadmapToggleTitle}>{t("routeRoadmap")}</Text><Text style={styles.roadmapToggleHint}>{route.points.length} {t("routePointsLabel")}</Text></View>
                            <TabIcon name={roadmapExpanded ? "chevronUp" : "chevronDown"} color={colors.primary} size={19} />
                          </Pressable>
                        ) : null}
                        {roadmapExpanded ? (
                          <View style={styles.routeRoadmap}>
                            {routeFlow.steps.map(({ point, position }) => (
                              <View key={point.id} style={styles.roadmapRow}>
                                <View style={styles.roadmapMarkerColumn}>
                                  <View style={[styles.pointIndex, point.effectiveStatus === "VISITED" && styles.pointVisited, point.effectiveStatus === "MISSED" && styles.pointMissed]}>
                                    <Text style={styles.pointIndexText}>{position}</Text>
                                  </View>
                                  {position < routeFlow.steps.length ? <View style={styles.roadmapLine} /> : null}
                                </View>
                                <View style={styles.pointBody}>
                                  <Text style={styles.pointName} numberOfLines={1}>{point.customer.name}</Text>
                                  <Text style={styles.pointMeta} numberOfLines={1}>{point.customer.address ?? point.customer.city ?? objectTypeLabel(point.customer.objectType)}</Text>
                                </View>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    )
                  })}
                </View>
              )}
            </View>
          )
        })() : null}

        {week && visibleDays.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text accessibilityLiveRegion="polite" style={styles.emptyTitle}>{busy ? t("weekLoadingDay") : t("fieldDataError")}</Text>
            {!busy ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("refresh")}
                accessibilityHint={t("weekSchedule")}
                onPress={() => void field.refresh()}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.primaryText}>{t("refresh")}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 28 },
  header: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  title: { color: colors.text, fontSize: 27, fontWeight: "900", marginTop: 4, letterSpacing: -0.6 },
  range: { color: colors.muted, fontSize: 13, marginTop: 4 },
  navigator: { marginHorizontal: 14, marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.card, borderRadius: radii.card, padding: 7, ...cardShadow },
  navButton: { width: 48, height: 44, borderRadius: radii.inner, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  currentButton: { minHeight: 44, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  currentText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  rangePicker: { marginHorizontal: 14, marginTop: 10, padding: 4, borderRadius: radii.card, flexDirection: "row", gap: 4, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  rangeChoice: { flex: 1, minHeight: 44, borderRadius: radii.inner, alignItems: "center", justifyContent: "center" },
  rangeChoiceSelected: { backgroundColor: colors.primary },
  rangeChoiceText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  rangeChoiceTextSelected: { color: colors.headerText },
  calendarPanel: { marginHorizontal: 14, marginTop: 10, padding: 8, borderRadius: radii.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  calendarPanelTablet: { alignSelf: "center", width: "94%", maxWidth: 780, marginHorizontal: 0 },
  calendarStrip: { flexDirection: "row", gap: 4 },
  calendarDay: { flex: 1, minWidth: 44, minHeight: 72, borderRadius: radii.inner, alignItems: "center", justifyContent: "center", gap: 2 },
  calendarDaySelected: { backgroundColor: colors.primary },
  calendarDayOff: { opacity: 0.66 },
  calendarWeekday: { color: colors.muted, fontSize: 10, fontWeight: "900" },
  calendarWeekdaySelected: { color: colors.headerText },
  calendarDate: { color: colors.text, fontSize: 18, fontWeight: "900" },
  calendarDateSelected: { color: colors.headerText },
  calendarDayStatus: { height: 8, alignItems: "center", justifyContent: "center" },
  calendarDayDot: { width: 6, height: 6, borderRadius: radii.pill },
  legendCard: { marginHorizontal: 14, marginTop: 12, backgroundColor: colors.card, borderRadius: radii.card, padding: 13, borderWidth: 1, borderColor: colors.border },
  legendTitle: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 9 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.text, fontSize: 11, fontWeight: "600" },
  offlineNotice: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.inner, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.warningBorder, padding: 11, flexDirection: "row", justifyContent: "space-between", gap: 10 },
  offlineText: { flex: 1, color: colors.warning, fontSize: 12, fontWeight: "700" },
  retryAction: { minHeight: 44, minWidth: 44, marginVertical: -11, marginRight: -11, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  retry: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  emptyCard: { margin: 14, padding: 24, backgroundColor: colors.card, borderRadius: radii.card, alignItems: "center", ...cardShadow },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "800", textAlign: "center" },
  primaryButton: { minHeight: 44, marginTop: 14, backgroundColor: colors.primary, borderRadius: radii.pill, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  primaryText: { color: colors.headerText, fontSize: 13, fontWeight: "800" },
  missionSurface: { marginHorizontal: 14, marginTop: 14, padding: 16, backgroundColor: colors.card, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border },
  missionSurfaceTablet: { alignSelf: "center", width: "94%", maxWidth: 780, marginHorizontal: 0 },
  missionSurfaceDayOff: { backgroundColor: colors.holidayBg, borderColor: colors.holidayBorder },
  missionHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  missionHeading: { flex: 1, minWidth: 0 },
  missionEyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  missionDate: { color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: "900", marginTop: 3, textTransform: "capitalize" },
  missionMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  missionMetric: { flexDirection: "row", alignItems: "center", gap: 6 },
  missionMetricText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  dayCard: { marginHorizontal: 14, marginTop: 13, backgroundColor: colors.card, borderRadius: radii.card, padding: 14, borderWidth: 1, borderColor: colors.border, ...cardShadow },
  todayCard: { borderColor: colors.primary, borderWidth: 1.5 },
  dayOffCard: { backgroundColor: colors.holidayBg, borderColor: colors.holidayBorder },
  dayHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  dateBadge: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  todayBadge: { backgroundColor: colors.primary },
  dayOffBadge: { backgroundColor: colors.holidayBorder },
  dateBadgeText: { color: colors.text, fontSize: 17, fontWeight: "900" },
  todayBadgeText: { color: colors.headerText },
  dayOffBadgeText: { color: colors.holiday },
  dayHeaderBody: { flex: 1 },
  weekday: { color: colors.text, fontSize: 15, fontWeight: "900", textTransform: "capitalize" },
  dayDate: { color: colors.muted, fontSize: 11, marginTop: 2 },
  todayPill: { backgroundColor: colors.primarySoft, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 5 },
  todayPillText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  dayOffLine: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 11, padding: 9, borderRadius: radii.inner, backgroundColor: "rgba(255,255,255,0.58)" },
  holidayDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.holiday },
  dayOffText: { color: colors.holiday, fontSize: 12, fontWeight: "800" },
  dayMission: { marginTop: 11, padding: 10, borderRadius: radii.inner, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: "rgba(255,90,0,0.14)" },
  dayMissionTitle: { color: colors.primary, fontSize: 9, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.7 },
  dayMissionStats: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 7 },
  dayMissionStat: { flexDirection: "row", alignItems: "center", gap: 5 },
  dayMissionText: { color: colors.text, fontSize: 10, fontWeight: "800" },
  emptyDay: { paddingTop: 6 },
  noPlans: { color: colors.muted, fontSize: 13, paddingVertical: 11, textAlign: "center" },
  createRouteAction: { minHeight: 44, marginTop: 2, borderRadius: radii.inner, backgroundColor: colors.primary, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  createRouteActionText: { color: colors.headerText, fontSize: 12, fontWeight: "900" },
  routeUnavailable: { flexDirection: "row", alignItems: "flex-start", gap: 7, marginTop: 2, padding: 10, borderRadius: radii.inner, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder },
  routeUnavailableText: { flex: 1, color: colors.info, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  routeList: { marginTop: 18, gap: 18 },
  routeCard: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 },
  routeTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  routeBody: { flex: 1 },
  routeName: { color: colors.text, fontSize: 14, fontWeight: "900" },
  routeMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: "900" },
  progressTrack: { height: 5, borderRadius: radii.pill, backgroundColor: colors.skeleton, overflow: "hidden", marginTop: 10, marginBottom: 7 },
  progressFill: { height: "100%", borderRadius: radii.pill },
  roadmapSummary: { marginTop: 12, borderRadius: radii.inner, padding: 10, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  roadmapSummaryTitle: { color: colors.muted, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 },
  roadmapSummaryRail: { minHeight: 34, marginTop: 8, flexDirection: "row", alignItems: "center" },
  roadmapSummaryStep: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" },
  roadmapSummaryNode: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  roadmapSummaryNodeText: { fontSize: 11, fontWeight: "900" },
  roadmapSummaryLine: { flex: 1, height: 2, borderRadius: radii.pill, marginHorizontal: 4 },
  roadmapSummaryOverflow: { minWidth: 30, height: 30, borderRadius: 10, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  roadmapSummaryOverflowText: { color: colors.muted, fontSize: 11, fontWeight: "900" },
  routeRoadmap: { marginTop: 12, gap: 2 },
  roadmapRow: { flexDirection: "row", gap: 10, minHeight: 44 },
  roadmapMarkerColumn: { width: 26, alignItems: "center" },
  roadmapLine: { width: 1, flex: 1, minHeight: 8, marginVertical: 4, backgroundColor: colors.borderStrong },
  pointRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.border },
  pointIndex: { width: 25, height: 25, borderRadius: 9, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" },
  pointVisited: { backgroundColor: colors.successBg },
  pointMissed: { backgroundColor: colors.missedBg },
  pointIndexText: { color: colors.text, fontSize: 11, fontWeight: "900" },
  pointBody: { flex: 1 },
  pointName: { color: colors.text, fontSize: 12, fontWeight: "800" },
  pointMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  morePoints: { color: colors.primary, fontSize: 11, fontWeight: "800", marginTop: 5 },
  nextStopSurface: { minHeight: 68, marginTop: 12, borderRadius: radii.inner, padding: 10, backgroundColor: colors.primarySoft, flexDirection: "row", alignItems: "center", gap: 9 },
  nextStopSurfaceActive: { backgroundColor: colors.successBg },
  nextStopIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  nextStopIconActive: { backgroundColor: colors.card },
  nextStopBody: { flex: 1, minWidth: 0 },
  nextStopLabel: { color: colors.primary, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 },
  nextStopLabelActive: { color: colors.successDark },
  nextStopName: { color: colors.text, fontSize: 14, fontWeight: "900", marginTop: 2 },
  nextStopMeta: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  routeAction: { marginTop: 10, minHeight: 46, borderRadius: radii.inner, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 13 },
  routeActionText: { color: colors.headerText, fontSize: 12, fontWeight: "900" },
  roadmapToggle: { minHeight: 48, marginTop: 10, borderRadius: radii.inner, paddingHorizontal: 12, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 9 },
  roadmapToggleBody: { flex: 1, minWidth: 0 },
  roadmapToggleTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  roadmapToggleHint: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.46 },
  dayGrid: { width: "100%" },
  dayGridTablet: { flexDirection: "row", flexWrap: "wrap", gap: 14, paddingHorizontal: 14, alignItems: "flex-start" },
  dayCardTablet: { flexBasis: "48%", flexGrow: 1, marginHorizontal: 0, marginTop: 0 },
})
