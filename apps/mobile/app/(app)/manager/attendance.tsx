import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { TabIcon } from "../../../src/components/TabIcon"
import type {
  FieldManagerAttendanceAgent,
  FieldManagerAttendanceData,
  FieldManagerAttendanceDay,
} from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import { agentRoleLabel, workdayStatusLabel } from "../../../src/field/labels"
import { shiftDateKey } from "../../../src/field/week-status"
import { t, useLocale } from "../../../src/i18n"
import { formatCalendarDay, formatTime } from "../../../src/i18n/date-format"
import { HttpError } from "../../../src/sync/ports-error"
import { cardShadow, colors, radii } from "../../../src/theme"
import { safeFieldBack } from "../../../src/navigation/safe-back"

const RANGE_OPTIONS = [1, 7, 30] as const
const MANAGER_PAGE_LIMIT = 25

type LoadedAttendanceContext = {
  from: string
  to: string
  search: string
}

function compactWorkedTime(totalSeconds: number): string {
  const minutes = Math.max(0, Math.floor(totalSeconds / 60))
  const hours = Math.floor(minutes / 60)
  return String(hours).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0")
}

function workdayTone(status: FieldManagerAttendanceDay["status"]): { background: string; color: string } {
  if (status === "COMPLETED") return { background: colors.successBg, color: colors.successDark }
  if (status === "PAUSED") return { background: colors.warningBg, color: colors.warning }
  return { background: colors.infoBg, color: colors.info }
}

/**
 * Keep all loaded people for scrolling, but keep next.pageSummary exactly as
 * returned: it is deliberately the fact of the last server page, not a total
 * inferred in the client.
 */
function mergeAttendanceData(
  current: FieldManagerAttendanceData,
  next: FieldManagerAttendanceData,
): FieldManagerAttendanceData {
  const agentIds = new Set(current.agents.map((agent) => agent.id))
  return {
    ...next,
    agents: [...current.agents, ...next.agents.filter((agent) => !agentIds.has(agent.id))],
  }
}

function AttendanceAgentCard({
  agent,
  timezone,
  expanded,
  onToggle,
}: {
  agent: FieldManagerAttendanceAgent
  timezone: string
  expanded: boolean
  onToggle: () => void
}) {
  const locale = useLocale()
  const attendance = agent.attendance
  return (
    <View style={styles.agentCard}>
      <View style={styles.agentTop}>
        <View style={styles.avatar}><TabIcon name="profile" color={colors.primary} size={21} /></View>
        <View style={styles.agentBody}>
          <Text style={styles.agentName} numberOfLines={1}>{agent.name}</Text>
          <Text style={styles.agentRole}>{agentRoleLabel(agent.role)}</Text>
        </View>
        <View accessible accessibilityRole="summary" accessibilityLabel={`${t("managerAttendanceRecordedOnly")}: ${attendance.recordedDays}`} style={styles.recordBadge}>
          <Text style={styles.recordBadgeValue}>{attendance.recordedDays}</Text>
          <Text numberOfLines={2} style={styles.recordBadgeText}>{t("managerAttendanceRecordedShort")}</Text>
        </View>
      </View>

      <View style={styles.agentStats}>
        <View accessible accessibilityRole="summary" accessibilityLabel={`${t("managerAttendanceRecordedOnly")}: ${attendance.recordedDays}`} style={styles.agentStat}><Text style={styles.agentStatValue}>{attendance.recordedDays}</Text><Text numberOfLines={2} style={styles.agentStatLabel}>{t("managerAttendanceRecordedShort")}</Text></View>
        <View accessible accessibilityRole="summary" accessibilityLabel={`${t("managerWorkingNow")}: ${attendance.activeDays}`} style={styles.agentStat}><Text style={[styles.agentStatValue, { color: colors.info }]}>{attendance.activeDays}</Text><Text numberOfLines={2} style={styles.agentStatLabel}>{t("managerAttendanceActiveShort")}</Text></View>
        <View accessible accessibilityRole="summary" accessibilityLabel={`${t("managerCompleted")}: ${attendance.completedDays}`} style={styles.agentStat}><Text style={[styles.agentStatValue, { color: colors.successDark }]}>{attendance.completedDays}</Text><Text numberOfLines={2} style={styles.agentStatLabel}>{t("managerAttendanceCompletedShort")}</Text></View>
        <View accessible accessibilityRole="summary" accessibilityLabel={`${t("managerAttendanceWorked")}: ${compactWorkedTime(attendance.workedSeconds)}`} style={styles.agentStat}><Text style={[styles.agentStatValue, { color: colors.primary }]}>{compactWorkedTime(attendance.workedSeconds)}</Text><Text numberOfLines={2} style={styles.agentStatLabel}>{t("managerAttendanceWorkedShort")}</Text></View>
      </View>

      {attendance.recordedDays === 0 ? (
        <Text style={styles.noRecords}>{t("managerAttendanceNoRecords")}</Text>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={`${agent.name}: ${expanded ? t("managerAttendanceCloseDays") : t("managerAttendanceOpenDays")}`}
            onPress={onToggle}
            style={({ pressed }) => [styles.daysToggle, pressed && styles.pressed]}
          >
            <Text style={styles.daysToggleText}>{expanded ? t("managerAttendanceCloseDays") : t("managerAttendanceOpenDays")}</Text>
            <TabIcon name={expanded ? "chevronDown" : "chevronRight"} color={colors.primary} size={18} />
          </Pressable>
          {expanded ? (
            <View style={styles.daysList}>
              {attendance.days.map((day, index) => {
                const calendar = formatCalendarDay(day.date, locale)
                const tone = workdayTone(day.status)
                return (
                  <View key={day.id} style={[styles.dayRow, index > 0 && styles.dayRowBorder]}>
                    <View style={styles.dayTop}>
                      <View style={styles.dayDate}><Text style={styles.dayWeekday}>{calendar.weekday}</Text><Text style={styles.dayDateText}>{calendar.date}</Text></View>
                      <View style={[styles.dayStatus, { backgroundColor: tone.background }]}><Text style={[styles.dayStatusText, { color: tone.color }]}>{workdayStatusLabel(day.status)}</Text></View>
                    </View>
                    <View style={styles.dayFacts}>
                      <Text style={styles.dayFact}>{t("managerAttendanceStartAt", { time: formatTime(day.startedAt, timezone) })}</Text>
                      {day.pausedAt ? <Text style={styles.dayFact}>{t("managerAttendancePausedAt", { time: formatTime(day.pausedAt, timezone) })}</Text> : null}
                      {day.completedAt ? <Text style={styles.dayFact}>{t("managerAttendanceCompletedAt", { time: formatTime(day.completedAt, timezone) })}</Text> : null}
                      <Text style={styles.dayWorked}>{t("managerWorkedTime", { time: compactWorkedTime(day.workedSeconds) })}</Text>
                    </View>
                  </View>
                )
              })}
            </View>
          ) : null}
        </>
      )}
    </View>
  )
}

export default function ManagerAttendanceScreen() {
  const locale = useLocale()
  const field = useField()
  const today = field.profile?.todaySummary.date ?? field.week?.today ?? new Date().toISOString().slice(0, 10)
  const initialEndDate = today
  const [endDate, setEndDate] = useState(initialEndDate)
  const [rangeDays, setRangeDays] = useState<number>(1)
  const [search, setSearch] = useState("")
  const [loadedContext, setLoadedContext] = useState<LoadedAttendanceContext | null>(null)
  const [data, setData] = useState<FieldManagerAttendanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null)
  const sequence = useRef(0)
  const searchQuery = search.trim()
  const from = shiftDateKey(endDate, -(rangeDays - 1))
  const to = endDate

  const load = useCallback(async (
    nextEndDate: string,
    nextRangeDays: number,
    query: string,
    page = 1,
    append = false,
  ) => {
    const request = ++sequence.current
    const nextFrom = shiftDateKey(nextEndDate, -(nextRangeDays - 1))
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setLoadingMore(false)
    }
    setError(null)
    try {
      const next = await fieldApi.managerAttendance(nextFrom, nextEndDate, {
        page,
        limit: MANAGER_PAGE_LIMIT,
        search: query || undefined,
      })
      if (request !== sequence.current) return
      setLoadedContext({ from: nextFrom, to: nextEndDate, search: query })
      setData((current) => {
        if (!append || !current || current.from !== next.from || current.to !== next.to) return next
        return mergeAttendanceData(current, next)
      })
    } catch (reason) {
      if (request === sequence.current) setError(reason)
    } finally {
      if (request === sequence.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => void load(endDate, rangeDays, searchQuery), 300)
    return () => clearTimeout(id)
  }, [endDate, load, rangeDays, searchQuery])

  const isCurrentContext = loadedContext != null &&
    loadedContext.from === from &&
    loadedContext.to === to &&
    loadedContext.search === searchQuery
  const attendance = isCurrentContext ? data : null
  const denied = error instanceof HttpError && error.status === 403
  const hasPendingContext = !isCurrentContext
  const startCalendar = formatCalendarDay(from, locale)
  const endCalendar = formatCalendarDay(to, locale)
  const dateLabel = rangeDays === 1 ? endCalendar.date : startCalendar.date + " — " + endCalendar.date
  const isTodayContext = endDate === today

  function beginContextChange() {
    sequence.current += 1
    setLoading(true)
    setLoadingMore(false)
    setError(null)
    setExpandedAgentId(null)
  }

  function selectEndDate(nextDate: string) {
    if (nextDate === endDate) return
    beginContextChange()
    setEndDate(nextDate)
  }

  function selectRange(nextRangeDays: number) {
    if (nextRangeDays === rangeDays) return
    beginContextChange()
    setRangeDays(nextRangeDays)
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading && !loadingMore} onRefresh={() => void load(endDate, rangeDays, searchQuery)} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => safeFieldBack("/(app)/manager")} style={styles.back}><TabIcon name="chevronLeft" color={colors.text} size={23} /></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("managerHomeTitle").toUpperCase()}</Text>
            <Text style={styles.title}>{t("managerAttendanceTitle")}</Text>
            <Text style={styles.subtitle}>{t("managerAttendanceHint")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} accessibilityState={{ busy: loading || loadingMore, disabled: loading || loadingMore }} disabled={loading || loadingMore} onPress={() => void load(endDate, rangeDays, searchQuery)} style={styles.refresh}><TabIcon name="refresh" color={colors.primary} size={22} /></Pressable>
        </View>

        <View style={styles.dateNavigator}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${t("managerAttendancePreviousPeriod")}: ${formatCalendarDay(shiftDateKey(endDate, -rangeDays), locale).date}`} accessibilityState={{ busy: loading }} onPress={() => selectEndDate(shiftDateKey(endDate, -rangeDays))} style={styles.dateArrow}><TabIcon name="chevronLeft" color={colors.headerText} size={23} /></Pressable>
          <View style={styles.dateCenter}>
            <Text style={styles.dateWeekday}>{rangeDays === 1 ? endCalendar.weekday : t("managerPlanningRange", { count: rangeDays })}</Text>
            <Text style={styles.dateLabel}>{dateLabel}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${t("managerAttendanceNextPeriod")}: ${formatCalendarDay(shiftDateKey(endDate, rangeDays), locale).date}`} accessibilityState={{ busy: loading }} onPress={() => selectEndDate(shiftDateKey(endDate, rangeDays))} style={styles.dateArrow}><TabIcon name="chevronRight" color={colors.headerText} size={23} /></Pressable>
        </View>
        {!isTodayContext ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("tabToday")}: ${formatCalendarDay(today, locale).date}`}
            accessibilityState={{ busy: loading }}
            onPress={() => selectEndDate(today)}
            style={({ pressed }) => [styles.todayAction, pressed && styles.pressed]}
          >
            <TabIcon name="today" color={colors.primary} size={17} />
            <Text style={styles.todayActionText}>{t("tabToday")}</Text>
          </Pressable>
        ) : null}
        <View style={styles.rangePicker}>
          {RANGE_OPTIONS.map((days) => (
            <Pressable key={days} accessibilityRole="button" accessibilityLabel={t("managerPlanningRange", { count: days })} accessibilityState={{ busy: loading, selected: rangeDays === days }} onPress={() => selectRange(days)} style={[styles.rangeChoice, rangeDays === days && styles.rangeChoiceSelected]}>
              <View style={styles.rangeChoiceContent}>
                <Text style={[styles.rangeChoiceText, rangeDays === days && styles.rangeChoiceTextSelected]}>{t("managerPlanningRange", { count: days })}</Text>
                {rangeDays === days ? <TabIcon name="check" color={colors.headerText} size={14} /> : null}
              </View>
            </Pressable>
          ))}
        </View>

        {loading && !attendance ? <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>{t("managerLoading")}</Text></View> : null}
        {error && !attendance ? (
          <View style={[styles.state, denied && styles.stateWarning]}>
            <View style={styles.stateIcon}><TabIcon name="week" color={denied ? colors.warning : colors.primary} size={25} /></View>
            <Text style={styles.stateTitle}>{denied ? t("managerAccessDeniedTitle") : t("managerUnavailable")}</Text>
            <Text style={styles.stateText}>{denied ? t("managerAccessDeniedBody") : t("managerRetry")}</Text>
            <Pressable accessibilityLabel={t("managerRetry")} accessibilityRole="button" accessibilityState={{ busy: loading }} onPress={() => void load(endDate, rangeDays, searchQuery)} style={styles.retry}><Text style={styles.retryText}>{t("managerRetry")}</Text></Pressable>
          </View>
        ) : null}

        {attendance ? (
          <>
            <View style={styles.scope}>
              <TabIcon name="profile" color={colors.primary} size={18} />
              <Text style={styles.scopeText}>{attendance.scope === "ORGANIZATION" ? t("managerScopeOrganization") : t("managerScopeTeam")}</Text>
              {error ? <Text style={styles.staleText}>{t("managerAttendanceStale")}</Text> : null}
            </View>
            <View style={styles.recordedOnlyCard}>
              <View style={styles.recordedOnlyIcon}><TabIcon name="info" color={colors.info} size={19} /></View>
              <View style={styles.recordedOnlyBody}>
                <Text style={styles.recordedOnlyTitle}>{t("managerAttendanceRecordedOnly")}</Text>
                <Text style={styles.recordedOnlyText}>{t("managerAttendanceRecordedOnlyHint")}</Text>
                <Text style={styles.timezone}>{t("managerAttendanceTimezone", { timezone: attendance.timezone })}</Text>
              </View>
            </View>
            <View style={styles.searchBox}>
              <TabIcon name="search" color={colors.faint} size={20} />
              <TextInput
                accessibilityLabel={t("managerSearch")}
                accessibilityHint={t("managerSearchHint")}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={120}
                onChangeText={(value) => {
                  beginContextChange()
                  setSearch(value)
                }}
                placeholder={t("managerSearchHint")}
                placeholderTextColor={colors.faint}
                returnKeyType="search"
                style={styles.searchInput}
                value={search}
              />
            </View>
            <Text style={styles.pageInfo}>{t("managerLoadedOfTotal", { loaded: attendance.agents.length, total: attendance.page.total })}</Text>
            <View style={styles.pageSummary}>
              <Text style={styles.pageSummaryTitle}>{t("managerAttendancePageFact")}</Text>
              <Text style={styles.pageSummaryText}>{t("managerAttendancePageSummary", {
                agents: attendance.pageSummary.agentsLoaded,
                days: attendance.pageSummary.recordedDays,
                time: compactWorkedTime(attendance.pageSummary.workedSeconds),
              })}</Text>
            </View>

            {attendance.agents.length === 0 ? (
              <View style={styles.empty}><TabIcon name="week" color={colors.primary} size={25} /><Text style={styles.emptyText}>{searchQuery ? t("managerNoSearchResults") : t("managerAttendanceNoRecords")}</Text></View>
            ) : (
              <View style={styles.agentList}>
                {attendance.agents.map((agent) => (
                  <AttendanceAgentCard
                    key={agent.id}
                    agent={agent}
                    timezone={attendance.timezone}
                    expanded={expandedAgentId === agent.id}
                    onToggle={() => setExpandedAgentId((current) => current === agent.id ? null : agent.id)}
                  />
                ))}
              </View>
            )}
            {attendance.page.hasMore && !hasPendingContext ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={loadingMore ? t("fieldLoadingMore") : t("fieldLoadMore")}
                accessibilityState={{ busy: loadingMore, disabled: loading || loadingMore }}
                disabled={loading || loadingMore}
                onPress={() => void load(endDate, rangeDays, searchQuery, attendance.page.number + 1, true)}
                style={[styles.loadMore, (loading || loadingMore) && styles.disabled]}
              >
                <Text style={styles.loadMoreText}>{loadingMore ? t("fieldLoadingMore") : t("fieldLoadMore")}</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 32 },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.9 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  refresh: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  dateNavigator: { marginHorizontal: 14, marginTop: 16, minHeight: 74, borderRadius: radii.card, backgroundColor: colors.navy, padding: 11, flexDirection: "row", alignItems: "center", justifyContent: "space-between", ...cardShadow },
  dateArrow: { width: 44, height: 44, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  dateCenter: { alignItems: "center", flex: 1 },
  dateWeekday: { color: colors.headerSubtext, fontSize: 9, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  dateLabel: { color: colors.headerText, fontSize: 16, fontWeight: "900", marginTop: 3 },
  todayAction: { minHeight: 44, marginHorizontal: 14, marginTop: 9, borderRadius: radii.inner, backgroundColor: colors.primarySoft, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  todayActionText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  rangePicker: { marginHorizontal: 14, marginTop: 9, flexDirection: "row", gap: 7 },
  rangeChoice: { flex: 1, minHeight: 44, borderRadius: radii.inner, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  rangeChoiceSelected: { borderWidth: 2, backgroundColor: colors.primary, borderColor: colors.primary },
  rangeChoiceContent: { flexDirection: "row", alignItems: "center", gap: 5 },
  rangeChoiceText: { color: colors.muted, fontSize: 10, fontWeight: "900" },
  rangeChoiceTextSelected: { color: colors.headerText },
  scope: { minHeight: 44, marginHorizontal: 14, marginTop: 13, borderRadius: radii.inner, backgroundColor: colors.primarySoft, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 8 },
  scopeText: { flex: 1, color: colors.primary, fontSize: 10, fontWeight: "900" },
  staleText: { maxWidth: "42%", color: colors.warning, fontSize: 9, fontWeight: "800", textAlign: "right" },
  recordedOnlyCard: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginHorizontal: 14, marginTop: 10, padding: 12, borderRadius: radii.inner, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder },
  recordedOnlyIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.cardOverlay, alignItems: "center", justifyContent: "center" },
  recordedOnlyBody: { flex: 1, minWidth: 0 },
  recordedOnlyTitle: { color: colors.info, fontSize: 11, fontWeight: "900" },
  recordedOnlyText: { color: colors.info, fontSize: 9, lineHeight: 13, marginTop: 2, fontWeight: "700" },
  timezone: { color: colors.muted, fontSize: 8, lineHeight: 12, marginTop: 4, fontWeight: "800" },
  searchBox: { minHeight: 48, marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13 },
  searchInput: { flex: 1, minHeight: 46, color: colors.text, fontSize: 12 },
  pageInfo: { marginHorizontal: 16, marginTop: 7, color: colors.muted, fontSize: 9, fontWeight: "800" },
  pageSummary: { marginHorizontal: 14, marginTop: 9, padding: 12, borderRadius: radii.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, ...cardShadow },
  pageSummaryTitle: { color: colors.text, fontSize: 11, fontWeight: "900" },
  pageSummaryText: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 3, fontWeight: "800" },
  agentList: { paddingTop: 1 },
  agentCard: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, backgroundColor: colors.card, padding: 13, ...cardShadow },
  agentTop: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 9 },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  agentBody: { flex: 1, minWidth: 0 },
  agentName: { color: colors.text, fontSize: 13, fontWeight: "900" },
  agentRole: { color: colors.muted, fontSize: 9, fontWeight: "800", marginTop: 2 },
  recordBadge: { maxWidth: 82, alignItems: "flex-end" },
  recordBadgeValue: { color: colors.primary, fontSize: 20, lineHeight: 21, fontWeight: "900", fontVariant: ["tabular-nums"] },
  recordBadgeText: { color: colors.faint, fontSize: 8, lineHeight: 10, textAlign: "right", fontWeight: "800" },
  agentStats: { marginTop: 12, paddingTop: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, flexDirection: "row" },
  agentStat: { flex: 1, alignItems: "center", paddingHorizontal: 2 },
  agentStatValue: { color: colors.text, fontSize: 15, lineHeight: 18, fontWeight: "900", fontVariant: ["tabular-nums"] },
  agentStatLabel: { color: colors.muted, fontSize: 9, lineHeight: 12, marginTop: 2, textAlign: "center", fontWeight: "800" },
  noRecords: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 12, fontWeight: "800" },
  daysToggle: { minHeight: 44, marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  daysToggleText: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  daysList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 8 },
  dayRow: { paddingVertical: 9 },
  dayRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  dayTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  dayDate: { flex: 1, minWidth: 0 },
  dayWeekday: { color: colors.text, fontSize: 10, fontWeight: "900" },
  dayDateText: { color: colors.muted, fontSize: 9, fontWeight: "800", marginTop: 2 },
  dayStatus: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 6 },
  dayStatusText: { fontSize: 8, fontWeight: "900" },
  dayFacts: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 7 },
  dayFact: { color: colors.muted, fontSize: 8, fontWeight: "800" },
  dayWorked: { color: colors.primary, fontSize: 8, fontWeight: "900" },
  empty: { minHeight: 112, marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 18, ...cardShadow },
  emptyText: { color: colors.muted, fontSize: 11, fontWeight: "800", textAlign: "center" },
  state: { minHeight: 230, margin: 14, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", padding: 24, ...cardShadow },
  stateWarning: { backgroundColor: colors.warningBg, borderWidth: 1, borderColor: "#F6D788" },
  stateIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  stateTitle: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "center" },
  stateText: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 7 },
  retry: { minHeight: 44, marginTop: 16, borderRadius: 13, paddingHorizontal: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  retryText: { color: colors.headerText, fontSize: 11, fontWeight: "900" },
  loadMore: { minHeight: 44, marginHorizontal: 14, marginTop: 16, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  loadMoreText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
})
