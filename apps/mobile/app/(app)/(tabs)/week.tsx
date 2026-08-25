import { useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
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
import { colors, cardShadow, radii } from "../../../src/theme"
import { useResponsiveLayout } from "../../../src/layout/responsive"

const tones: Record<RouteStatusTone, { bg: string; border: string; text: string; dot: string }> = {
  draft: { bg: colors.draftBg, border: colors.draftBorder, text: colors.draft, dot: colors.draft },
  planned: { bg: colors.infoBg, border: colors.infoBorder, text: colors.info, dot: colors.info },
  inProgress: { bg: colors.warningBg, border: "#F6D788", text: colors.warning, dot: "#D97706" },
  completed: { bg: colors.successBg, border: colors.successBorder, text: colors.successDark, dot: colors.success },
  cancelled: { bg: colors.draftBg, border: colors.draftBorder, text: colors.draft, dot: colors.faint },
  missed: { bg: colors.missedBg, border: colors.missedBorder, text: colors.missed, dot: colors.missed },
}

export default function WeekTab() {
  const locale = useLocale()
  const field = useField()
  const week = field.week
  const busy = field.phase === "loading" || field.phase === "refreshing"
  const layout = useResponsiveLayout()
  const isCurrentWeek = Boolean(week && week.weekStart === startOfIsoWeek(week.today))
  const [viewRange, setViewRange] = useState<FieldWeekViewRange>(7)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const activeDate = selectedDate ?? week?.days.find((day) => day.isToday)?.date ?? week?.today ?? null
  const visibleDays = useMemo(
    () => visibleFieldWeekDays(week?.days ?? [], activeDate, viewRange),
    [activeDate, viewRange, week?.days],
  )

  useEffect(() => {
    if (!week) return
    setSelectedDate((current) => (
      current && week.days.some((day) => day.date === current)
        ? current
        : week.days.find((day) => day.isToday)?.date ?? week.today
    ))
  }, [week?.weekStart])

  const move = (days: -1 | 1) => {
    if (!week) return
    if (viewRange === 1) {
      const nextDate = shiftDateKey(activeDate ?? week.today, days)
      setSelectedDate(nextDate)
      if (startOfIsoWeek(nextDate) !== week.weekStart) void field.loadWeek(startOfIsoWeek(nextDate))
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
  const currentNavigationLabel = viewRange === 1 ? t("tabToday") : t("currentWeek")
  const isCurrentContext = viewRange === 1 ? activeDate === week?.today : isCurrentWeek
  const headerRange = viewRange === 1 && activeDate
    ? (() => {
        const day = formatCalendarDay(activeDate, locale)
        return `${day.weekday}, ${day.date}`
      })()
    : week ? formatCalendarRange(week.weekStart, week.weekEndExclusive, locale) : null

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void field.refresh()} />}
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow}>{t("tabWeek").toUpperCase()}</Text>
          <Text accessibilityRole="header" style={styles.title}>{t("weekSchedule")}</Text>
          {headerRange ? <Text style={styles.range}>{headerRange}</Text> : null}
        </View>

        <View style={styles.navigator}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={previousTarget ? `${navigationLabel}: ${formatCalendarDay(previousTarget, locale).date}` : navigationLabel}
            accessibilityHint={t("weekSchedule")}
            accessibilityState={{ disabled: !week, busy }}
            disabled={!week}
            onPress={() => move(-1)}
            style={({ pressed }) => [styles.navButton, !week && styles.disabled, pressed && week && styles.pressed]}
          >
            <TabIcon name="chevronLeft" color={colors.primary} size={23} />
          </Pressable>
          <Pressable
            disabled={!week}
            accessibilityRole="button"
            accessibilityLabel={currentNavigationLabel}
            accessibilityHint={t("weekSchedule")}
            accessibilityState={{ disabled: !week, busy, selected: isCurrentContext }}
            onPress={() => {
              if (!week) return
              setSelectedDate(week.today)
              void field.loadWeek(startOfIsoWeek(week.today))
            }}
            style={({ pressed }) => [styles.currentButton, !week && styles.disabled, pressed && week && styles.pressed]}
          >
            <Text style={styles.currentText}>{currentNavigationLabel}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={nextTarget ? `${nextNavigationLabel}: ${formatCalendarDay(nextTarget, locale).date}` : nextNavigationLabel}
            accessibilityHint={t("weekSchedule")}
            accessibilityState={{ disabled: !week, busy }}
            disabled={!week}
            onPress={() => move(1)}
            style={({ pressed }) => [styles.navButton, !week && styles.disabled, pressed && week && styles.pressed]}
          >
            <TabIcon name="chevronRight" color={colors.primary} size={23} />
          </Pressable>
        </View>

        <View style={styles.rangePicker}>
          {FIELD_WEEK_VIEW_RANGES.map((days) => (
            <Pressable
              key={days}
              accessibilityRole="button"
              accessibilityLabel={t("weekRange", { count: days })}
              accessibilityState={{ selected: viewRange === days, busy }}
              onPress={() => setViewRange(days)}
              style={({ pressed }) => [styles.rangeChoice, viewRange === days && styles.rangeChoiceSelected, pressed && styles.pressed]}
            >
              <Text style={[styles.rangeChoiceText, viewRange === days && styles.rangeChoiceTextSelected]}>{t("weekRange", { count: days })}</Text>
              {viewRange === days ? <TabIcon name="check" color={colors.headerText} size={14} /> : null}
            </Pressable>
          ))}
        </View>

        <View style={styles.legendCard}>
          <Text style={styles.legendTitle}>{t("statusLegend")}</Text>
          <View style={styles.legendRow}>
            {(["PLANNED", "IN_PROGRESS", "COMPLETED", "MISSED"] as const).map((status) => {
              const meta = routeStatusMeta(status)
              return (
                <View key={status} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: tones[meta.tone].dot }]} />
                  <Text style={styles.legendText}>{t(meta.labelKey)}</Text>
                </View>
              )
            })}
          </View>
        </View>

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

        <View style={[styles.dayGrid, layout.isTablet && styles.dayGridTablet]}>
        {visibleDays.map((day) => {
          const formatted = formatCalendarDay(day.date, locale)
          const isDayOff = !day.isWorkingDay
          const dayLabel = [formatted.weekday, formatted.date, day.isToday ? t("tabToday") : null, isDayOff ? day.nonWorkingReason ?? t("dayOff") : null].filter(Boolean).join(", ")
          const missionLabel = [
            t("dailyMission"),
            day.tasks.total > 0 ? `${day.tasks.completed}/${day.tasks.total} ${t("dayTasks")}` : null,
            day.visits.total > 0 ? `${day.visits.completed}/${day.visits.total} ${t("dayVisits")}` : null,
          ].filter(Boolean).join(", ")
          return (
            <View key={day.date} style={[styles.dayCard, layout.isTablet && styles.dayCardTablet, day.isToday && styles.todayCard, isDayOff && styles.dayOffCard]}>
              <View accessible accessibilityRole="header" accessibilityLabel={dayLabel} style={styles.dayHeader}>
                <View style={[styles.dateBadge, day.isToday && styles.todayBadge, isDayOff && styles.dayOffBadge]}>
                  <Text style={[styles.dateBadgeText, day.isToday && styles.todayBadgeText, isDayOff && styles.dayOffBadgeText]}>{formatted.day}</Text>
                </View>
                <View style={styles.dayHeaderBody}>
                  <Text style={styles.weekday}>{formatted.weekday}</Text>
                  <Text style={styles.dayDate}>{formatted.date}</Text>
                </View>
                {day.isToday ? <View style={styles.todayPill}><Text style={styles.todayPillText}>{t("tabToday")}</Text></View> : null}
              </View>

              {isDayOff ? (
                <View accessible accessibilityRole="summary" accessibilityLabel={dayLabel} style={styles.dayOffLine}>
                  <View style={styles.holidayDot} />
                  <Text style={styles.dayOffText}>{day.nonWorkingReason ?? t("dayOff")}</Text>
                </View>
              ) : null}

              {day.tasks.total > 0 || day.visits.total > 0 ? (
                <View accessible accessibilityRole="summary" accessibilityLabel={missionLabel} style={styles.dayMission}>
                  <Text style={styles.dayMissionTitle}>{t("dailyMission")}</Text>
                  <View style={styles.dayMissionStats}>
                    {day.tasks.total > 0 ? (
                      <View style={styles.dayMissionStat}>
                        <TabIcon name="tasks" color={colors.primary} size={15} />
                        <Text style={styles.dayMissionText}>{day.tasks.completed}/{day.tasks.total} {t("dayTasks")}</Text>
                      </View>
                    ) : null}
                    {day.visits.total > 0 ? (
                      <View style={styles.dayMissionStat}>
                        <TabIcon name="visit" color={colors.successDark} size={15} />
                        <Text style={styles.dayMissionText}>{day.visits.completed}/{day.visits.total} {t("dayVisits")}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {day.routes.length === 0 ? (
                <View style={styles.emptyDay}>
                  <Text accessibilityLabel={`${dayLabel}. ${t("noPlansForDay")}`} style={styles.noPlans}>{t("noPlansForDay")}</Text>
                  {day.routePlanningAllowed ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("createRoute")}
                      accessibilityHint={dayLabel}
                      accessibilityState={{ disabled: false, busy: false }}
                      onPress={() => router.push(("/(app)/routes/new?date=" + encodeURIComponent(day.date)) as never)}
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
                  {day.routes.map((route) => {
                    const meta = routeStatusMeta(route.effectiveStatus)
                    const tone = tones[meta.tone]
                    const percent = route.totalPoints ? Math.round((route.visitedPoints / route.totalPoints) * 100) : 0
                    const progressPercent = Math.min(100, percent)
                    const routeLabel = route.name ?? t("tabRoute")
                    const routeProgressLabel = `${route.visitedPoints}/${route.totalPoints} ${t("routePointsLabel")}`
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
                        {route.points.slice(0, 3).map((point, pointIndex) => (
                          <View key={point.id} style={styles.pointRow}>
                            <View style={[styles.pointIndex, point.effectiveStatus === "VISITED" && styles.pointVisited, point.effectiveStatus === "MISSED" && styles.pointMissed]}>
                              <Text style={styles.pointIndexText}>{pointIndex + 1}</Text>
                            </View>
                            <View style={styles.pointBody}>
                              <Text style={styles.pointName} numberOfLines={1}>{point.customer.name}</Text>
                              <Text style={styles.pointMeta} numberOfLines={1}>{point.customer.address ?? point.customer.city ?? point.customer.objectType}</Text>
                            </View>
                          </View>
                        ))}
                        {route.points.length > 3 ? <Text style={styles.morePoints}>+{route.points.length - 3} {t("routePointsLabel")}</Text> : null}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${route.canEdit ? t("editRoute") : t("openRoute")}: ${routeLabel}`}
                          accessibilityHint={`${t(meta.labelKey)}. ${routeProgressLabel}`}
                          accessibilityState={{ disabled: false, busy: route.syncState === "PENDING" }}
                          onPress={() => router.push(`/(app)/routes/${route.id}` as never)}
                          style={({ pressed }) => [styles.routeAction, pressed && styles.pressed]}
                        >
                          <Text style={styles.routeActionText}>{route.canEdit ? t("editRoute") : t("openRoute")}</Text>
                          <TabIcon name="chevronRight" color={colors.primary} size={19} />
                        </Pressable>
                      </View>
                    )
                  })}
                </View>
              )}
            </View>
          )
        })}
        </View>

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
  legendCard: { marginHorizontal: 14, marginTop: 12, backgroundColor: colors.card, borderRadius: radii.card, padding: 13, borderWidth: 1, borderColor: colors.border },
  legendTitle: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 9 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.text, fontSize: 11, fontWeight: "600" },
  offlineNotice: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.inner, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: "#F6D788", padding: 11, flexDirection: "row", justifyContent: "space-between", gap: 10 },
  offlineText: { flex: 1, color: colors.warning, fontSize: 12, fontWeight: "700" },
  retryAction: { minHeight: 44, minWidth: 44, marginVertical: -11, marginRight: -11, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  retry: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  emptyCard: { margin: 14, padding: 24, backgroundColor: colors.card, borderRadius: radii.card, alignItems: "center", ...cardShadow },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "800", textAlign: "center" },
  primaryButton: { minHeight: 44, marginTop: 14, backgroundColor: colors.primary, borderRadius: radii.pill, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  primaryText: { color: colors.headerText, fontSize: 13, fontWeight: "800" },
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
  todayPillText: { color: colors.primary, fontSize: 10, fontWeight: "900" },
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
  routeUnavailableText: { flex: 1, color: colors.info, fontSize: 10, lineHeight: 14, fontWeight: "800" },
  routeList: { marginTop: 12, gap: 11 },
  routeCard: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: radii.inner, padding: 12 },
  routeTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  routeBody: { flex: 1 },
  routeName: { color: colors.text, fontSize: 14, fontWeight: "900" },
  routeMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 9, fontWeight: "900" },
  progressTrack: { height: 5, borderRadius: radii.pill, backgroundColor: colors.skeleton, overflow: "hidden", marginTop: 10, marginBottom: 7 },
  progressFill: { height: "100%", borderRadius: radii.pill },
  pointRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.border },
  pointIndex: { width: 25, height: 25, borderRadius: 9, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" },
  pointVisited: { backgroundColor: colors.successBg },
  pointMissed: { backgroundColor: colors.missedBg },
  pointIndexText: { color: colors.text, fontSize: 10, fontWeight: "900" },
  pointBody: { flex: 1 },
  pointName: { color: colors.text, fontSize: 12, fontWeight: "800" },
  pointMeta: { color: colors.muted, fontSize: 10, marginTop: 2 },
  morePoints: { color: colors.primary, fontSize: 11, fontWeight: "800", marginTop: 5 },
  routeAction: { marginTop: 10, minHeight: 44, borderRadius: radii.inner, backgroundColor: colors.primarySoft, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 13 },
  routeActionText: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.46 },
  dayGrid: { width: "100%" },
  dayGridTablet: { flexDirection: "row", flexWrap: "wrap", gap: 14, paddingHorizontal: 14, alignItems: "flex-start" },
  dayCardTablet: { flexBasis: "48%", flexGrow: 1, marginHorizontal: 0, marginTop: 0 },
})
