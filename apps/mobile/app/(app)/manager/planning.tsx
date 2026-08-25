import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { TabIcon } from "../../../src/components/TabIcon"
import { FieldScreenChrome } from "../../../src/components/FieldScreenChrome"
import { FieldDayNavigator } from "../../../src/field/FieldDayNavigator"
import type { FieldManagerPlanningAgent, FieldManagerPlanningData, FieldManagerPlanningRoute } from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import { routeStatusMeta, shiftDateKey, type RouteStatusTone } from "../../../src/field/week-status"
import { t, useLocale } from "../../../src/i18n"
import { formatCalendarDay } from "../../../src/i18n/date-format"
import { HttpError } from "../../../src/sync/ports-error"
import { cardShadow, colors, radii } from "../../../src/theme"
import { agentRoleLabel } from "../../../src/field/labels"
import { safeFieldBack } from "../../../src/navigation/safe-back"

const knownRouteStatus = new Set(["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "MISSED"])
const RANGE_OPTIONS = [1, 5, 7]
const MANAGER_PAGE_LIMIT = 25

const tones: Record<RouteStatusTone, { background: string; foreground: string }> = {
  draft: { background: colors.draftBg, foreground: colors.draft },
  planned: { background: colors.infoBg, foreground: colors.info },
  inProgress: { background: colors.warningBg, foreground: colors.warning },
  completed: { background: colors.successBg, foreground: colors.successDark },
  cancelled: { background: colors.draftBg, foreground: colors.draft },
  missed: { background: colors.missedBg, foreground: colors.missed },
}

type LoadedPlanningContext = {
  date: string
  rangeDays: number
  search: string
}

type PlanningDayCoverage = {
  date: string
  routes: FieldManagerPlanningRoute[]
  plannedAgentIds: Set<string>
  missingAgents: FieldManagerPlanningAgent[]
}

function routeStatus(route: FieldManagerPlanningRoute): { label: string; background: string; foreground: string } {
  if (!knownRouteStatus.has(route.status)) {
    return { label: t("managerRouteStateUnknown"), background: colors.draftBg, foreground: colors.draft }
  }
  const meta = routeStatusMeta(route.status as "DRAFT" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "MISSED")
  const tone = tones[meta.tone]
  return { label: t(meta.labelKey), ...tone }
}

function routeDateKey(route: FieldManagerPlanningRoute): string | null {
  const date = route.date.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

function mergePlanningData(current: FieldManagerPlanningData, next: FieldManagerPlanningData): FieldManagerPlanningData {
  const agentIds = new Set(current.agents.map((agent) => agent.id))
  const routeIds = new Set(current.routes.map((route) => route.id))
  const routes = [...current.routes, ...next.routes.filter((route) => !routeIds.has(route.id))]
    .sort((left, right) => (
      left.date.localeCompare(right.date) ||
      left.agent.name.localeCompare(right.agent.name) ||
      left.id.localeCompare(right.id)
    ))
  return {
    ...next,
    agents: [...current.agents, ...next.agents.filter((agent) => !agentIds.has(agent.id))],
    routes,
    truncated: current.truncated || next.truncated,
  }
}

export default function ManagerPlanningScreen() {
  const locale = useLocale()
  const field = useField()
  const { date: requestedDate } = useLocalSearchParams<{ date?: string }>()
  const today = field.profile?.todaySummary.date ?? field.week?.today ?? new Date().toISOString().slice(0, 10)
  const initialDate = typeof requestedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate.slice(0, 10))
    ? requestedDate.slice(0, 10)
    : today
  const [date, setDate] = useState(initialDate)
  const [rangeDays, setRangeDays] = useState(1)
  const [search, setSearch] = useState("")
  const [loadedContext, setLoadedContext] = useState<LoadedPlanningContext | null>(null)
  const [data, setData] = useState<FieldManagerPlanningData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const sequence = useRef(0)
  const searchQuery = search.trim()

  const load = useCallback(async (
    nextDate: string,
    nextRangeDays: number,
    query: string,
    page = 1,
    append = false,
  ) => {
    const request = ++sequence.current
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setLoadingMore(false)
    }
    setError(null)
    try {
      const rangeEnd = nextRangeDays > 1 ? shiftDateKey(nextDate, nextRangeDays - 1) : undefined
      const next = await fieldApi.managerPlanning(nextDate, rangeEnd, {
        page,
        limit: MANAGER_PAGE_LIMIT,
        search: query || undefined,
      })
      if (request !== sequence.current) return
      setLoadedContext({ date: nextDate, rangeDays: nextRangeDays, search: query })
      setData((current) => {
        if (!append || !current || current.from !== next.from || current.to !== next.to) return next
        return mergePlanningData(current, next)
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
    const id = setTimeout(() => void load(date, rangeDays, searchQuery), 300)
    return () => clearTimeout(id)
  }, [date, load, rangeDays, searchQuery])

  const isCurrentContext = loadedContext != null &&
    loadedContext.date === date &&
    loadedContext.rangeDays === rangeDays &&
    loadedContext.search === searchQuery
  const planning = isCurrentContext ? data : null
  const denied = error instanceof HttpError && error.status === 403
  const hasPendingSearch = loadedContext?.search !== searchQuery

  const calendar = formatCalendarDay(date, locale)
  const endDate = shiftDateKey(date, rangeDays - 1)
  const endCalendar = formatCalendarDay(endDate, locale)
  const dateLabel = rangeDays === 1 ? calendar.date : calendar.date + " — " + endCalendar.date
  const navigatorDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => {
      const navigatorDate = shiftDateKey(date, index - 3)
      return { date: navigatorDate, isToday: navigatorDate === today }
    }),
    [date, today],
  )
  const rangeDateKeys = useMemo(
    () => Array.from({ length: rangeDays }, (_, index) => shiftDateKey(date, index)),
    [date, rangeDays],
  )
  const routes = planning?.routes ?? []
  const coverageByDate = useMemo(() => {
    const routesByDate = new Map<string, FieldManagerPlanningRoute[]>()
    for (const day of rangeDateKeys) routesByDate.set(day, [])
    for (const route of routes) {
      const day = routeDateKey(route)
      if (!day || !routesByDate.has(day)) continue
      routesByDate.get(day)?.push(route)
    }
    const agents = planning?.agents ?? []
    return new Map<string, PlanningDayCoverage>(rangeDateKeys.map((day) => {
      const dayRoutes = routesByDate.get(day) ?? []
      const plannedAgentIds = new Set(dayRoutes.map((route) => route.agentId))
      return [day, {
        date: day,
        routes: dayRoutes,
        plannedAgentIds,
        missingAgents: agents.filter((agent) => !plannedAgentIds.has(agent.id)),
      }]
    }))
  }, [planning?.agents, rangeDateKeys, routes])
  const currentDayCoverage = coverageByDate.get(date)
  const noRouteAgents = currentDayCoverage?.missingAgents ?? []

  function beginContextChange() {
    sequence.current += 1
    setLoading(true)
    setLoadingMore(false)
    setError(null)
  }

  function selectDate(nextDate: string) {
    if (nextDate === date) return
    beginContextChange()
    setDate(nextDate)
  }

  function selectRange(nextRangeDays: number) {
    if (nextRangeDays === rangeDays) return
    beginContextChange()
    setRangeDays(nextRangeDays)
  }

  function focusDay(nextDate: string) {
    if (nextDate === date && rangeDays === 1) return
    beginContextChange()
    setDate(nextDate)
    setRangeDays(1)
  }

  function drillIntoDay(nextDate: string) {
    if (nextDate === date && rangeDays === 1) return
    beginContextChange()
    setDate(nextDate)
    setRangeDays(1)
  }

  function planRouteFor(agent: FieldManagerPlanningAgent) {
    router.push({
      pathname: "/(app)/routes/new",
      params: {
        managerPlan: "1",
        managerAgentId: agent.id,
        managerAgentName: agent.name,
        date,
      },
    } as never)
  }

  function openRoute(route: FieldManagerPlanningRoute) {
    router.push({
      pathname: "/(app)/manager/routes/[routeId]",
      params: { routeId: route.id },
    } as never)
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <FieldScreenChrome />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading && !loadingMore} onRefresh={() => void load(date, rangeDays, searchQuery)} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => safeFieldBack("/(app)/manager")} style={styles.back}><TabIcon name="chevronLeft" color={colors.text} size={23} /></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("managerHomeTitle").toUpperCase()}</Text>
            <Text style={styles.title}>{t("managerPlanningTitle")}</Text>
            <Text style={styles.subtitle}>{t("managerPlanningHint")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} accessibilityState={{ busy: loading || loadingMore, disabled: loading || loadingMore }} disabled={loading || loadingMore} onPress={() => void load(date, rangeDays, searchQuery)} style={styles.refresh}><TabIcon name="refresh" color={colors.primary} size={22} /></Pressable>
        </View>

        <FieldDayNavigator
          days={navigatorDays}
          selectedDate={date}
          onSelectDate={focusDay}
          onPrevious={() => selectDate(shiftDateKey(date, -rangeDays))}
          onNext={() => selectDate(shiftDateKey(date, rangeDays))}
          previousLabel={`${t(rangeDays === 1 ? "managerPreviousDay" : "managerPreviousRange")}: ${formatCalendarDay(shiftDateKey(date, -rangeDays), locale).date}`}
          nextLabel={`${t(rangeDays === 1 ? "managerNextDay" : "managerNextRange")}: ${formatCalendarDay(shiftDateKey(date, rangeDays), locale).date}`}
          onCurrent={date !== today || rangeDays !== 1 ? () => focusDay(today) : undefined}
          currentLabel={rangeDays === 1 ? `${calendar.weekday}, ${dateLabel}` : dateLabel}
          currentAccessibilityLabel={dateLabel}
          currentActionLabel={t("tabToday")}
          busy={loading || loadingMore}
          rangeOptions={RANGE_OPTIONS}
          selectedRange={rangeDays}
          onSelectRange={selectRange}
          getRangeLabel={(days) => t("managerPlanningRange", { count: days })}
          dayHint={t("fieldDayNavigatorHint")}
          calendarPicker
          todayDate={today}
        />

        {loading && !planning ? <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>{t("managerLoading")}</Text></View> : null}
        {error && !planning ? (
          <View style={[styles.state, denied && styles.stateWarning]}>
            <View style={styles.stateIcon}><TabIcon name="week" color={denied ? colors.warning : colors.primary} size={25} /></View>
            <Text style={styles.stateTitle}>{denied ? t("managerAccessDeniedTitle") : t("managerUnavailable")}</Text>
            <Text style={styles.stateText}>{denied ? t("managerAccessDeniedBody") : t("managerRetry")}</Text>
            <Pressable accessibilityLabel={t("managerRetry")} accessibilityRole="button" accessibilityState={{ busy: loading }} onPress={() => void load(date, rangeDays, searchQuery)} style={styles.retry}><Text style={styles.retryText}>{t("managerRetry")}</Text></Pressable>
          </View>
        ) : null}

        {planning ? (
          <>
            <View style={styles.scope}>
              <TabIcon name="profile" color={colors.primary} size={18} />
              <Text style={styles.scopeText}>{planning.scope === "ORGANIZATION" ? t("managerScopeOrganization") : t("managerScopeTeam")}</Text>
              {error ? <Text style={styles.staleText}>{t("managerUnavailable")}</Text> : null}
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
            <Text style={styles.pageInfo}>{t("managerLoadedOfTotal", { loaded: planning.agents.length, total: planning.page.total })}</Text>
            {planning.truncated ? <View style={styles.notice}><Text style={styles.noticeText}>{t("managerPlanningTruncated")}</Text></View> : null}

            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.sectionTitle}>{t("managerRoutes")}</Text>
                <Text style={styles.sectionHint}>{t("managerPlanningPageRoutesHint")}</Text>
              </View>
              <Text style={styles.sectionCount}>{routes.length}</Text>
            </View>
            {routes.length === 0 ? (
              <View style={styles.empty}><TabIcon name="route" color={colors.primary} size={25} /><Text style={styles.emptyText}>{planning.agents.length === 0 && searchQuery ? t("managerNoSearchResults") : t("managerNoRoutes")}</Text></View>
            ) : (
              <View style={styles.routeList}>
                {routes.map((route) => {
                  const status = routeStatus(route)
                  const routeDay = routeDateKey(route)
                  const denominator = Math.max(1, route.totalPoints)
                  const progress = Math.max(0, Math.min(100, (route.visitedPoints / denominator) * 100))
                  return (
                    <Pressable
                      key={route.id}
                      accessibilityRole="button"
                      accessibilityHint={t("routeDetails")}
                      accessibilityLabel={t("managerOpenRoute", { name: route.name ?? t("tabRoute"), agent: route.agent.name }) + ". " + status.label + ". " + t("managerStopProgress", { visited: route.visitedPoints, total: route.totalPoints }) + ". " + Math.round(progress) + "%"}
                      onPress={() => openRoute(route)}
                      style={({ pressed }) => [styles.routeCard, pressed && styles.pressed]}
                    >
                      <View style={styles.routeTop}>
                        <View style={styles.routeIcon}><TabIcon name="route" color={colors.primary} size={21} /></View>
                        <View style={styles.routeBody}>
                          <Text style={styles.routeName} numberOfLines={1}>{route.name ?? t("tabRoute")}</Text>
                          <Text style={styles.routeAgent}>{route.agent.name}{rangeDays > 1 && routeDay ? " · " + formatCalendarDay(routeDay, locale).date : ""}</Text>
                        </View>
                        <View style={styles.routeTail}>
                          <View style={[styles.status, { backgroundColor: status.background }]}><Text style={[styles.statusText, { color: status.foreground }]}>{status.label}</Text></View>
                          <TabIcon name="chevronRight" color={colors.primary} size={18} />
                        </View>
                      </View>
                      <View style={styles.progressTop}>
                        <Text style={styles.progressLabel}>{t("managerStopProgress", { visited: route.visitedPoints, total: route.totalPoints })}</Text>
                        <Text style={[styles.progressPercent, { color: status.foreground }]}>{Math.round(progress)}%</Text>
                      </View>
                      <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` as `${number}%`, backgroundColor: status.foreground }]} /></View>
                    </Pressable>
                  )
                })}
              </View>
            )}

            {planning.agents.length === 0 ? (
              <View style={styles.empty}><TabIcon name="profile" color={colors.primary} size={25} /><Text style={styles.emptyText}>{searchQuery ? t("managerNoSearchResults") : t("managerNoTeam")}</Text></View>
            ) : rangeDays > 1 ? (
              <>
                <View style={styles.sectionHeading}>
                  <View><Text style={styles.sectionTitle}>{t("managerPlanningDailyCoverage")}</Text><Text style={styles.sectionHint}>{t("managerPlanningDailyCoverageHint")}</Text></View>
                  <Text style={styles.sectionCount}>{rangeDays}</Text>
                </View>
                <View style={styles.dayList}>
                  {rangeDateKeys.map((day) => {
                    const coverage = coverageByDate.get(day)
                    if (!coverage) return null
                    const dayCalendar = formatCalendarDay(day, locale)
                    const planned = coverage.plannedAgentIds.size
                    const total = planning.agents.length
                    const missing = coverage.missingAgents.length
                    const progress = total > 0 ? (planned / total) * 100 : 0
                    const tone = missing > 0
                      ? { background: colors.warningBg, foreground: colors.warning }
                      : { background: colors.successBg, foreground: colors.successDark }
                    return (
                      <Pressable
                        key={day}
                        accessibilityRole="button"
                        accessibilityHint={t("managerPlanningOpenDayHint")}
                        accessibilityLabel={t("managerPlanningOpenDay", { date: dayCalendar.date }) + ". " + t("managerPlanningDayCoverage", { planned, total }) + ". " + t("managerPlanningDayMissing", { count: missing })}
                        onPress={() => drillIntoDay(day)}
                        style={({ pressed }) => [styles.dayCoverageCard, pressed && styles.pressed]}
                      >
                        <View style={styles.dayCoverageTop}>
                          <View style={[styles.dayCoverageIcon, { backgroundColor: tone.background }]}><TabIcon name="week" color={tone.foreground} size={20} /></View>
                          <View style={styles.dayCoverageBody}>
                            <Text style={styles.dayCoverageDay}>{dayCalendar.weekday}</Text>
                            <Text style={styles.dayCoverageDate}>{dayCalendar.date}</Text>
                          </View>
                          <View style={[styles.dayCoverageStatus, { backgroundColor: tone.background }]}><Text style={[styles.dayCoverageStatusText, { color: tone.foreground }]}>{t("managerPlanningDayMissing", { count: missing })}</Text></View>
                          <TabIcon name="chevronRight" color={colors.primary} size={18} />
                        </View>
                        <Text style={styles.dayCoverageMeta}>{t("managerPlanningDayCoverage", { planned, total })}</Text>
                        <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` as `${number}%`, backgroundColor: tone.foreground }]} /></View>
                      </Pressable>
                    )
                  })}
                </View>
              </>
            ) : (
              <>
                <View style={styles.sectionHeading}>
                  <View><Text style={styles.sectionTitle}>{t("managerNoRouteAgents")}</Text><Text style={styles.sectionHint}>{t("managerNoRouteAgentsHint")}</Text></View>
                  <Text style={styles.sectionCount}>{noRouteAgents.length}</Text>
                </View>
                {noRouteAgents.length === 0 ? (
                  <View style={styles.empty}><TabIcon name="visit" color={colors.successDark} size={25} /><Text style={styles.emptyText}>{t("managerAllAgentsPlanned")}</Text></View>
                ) : (
                  <View style={styles.agentCard}>
                    {noRouteAgents.map((agent, index) => (
                      <Pressable
                        key={agent.id}
                        accessibilityRole="button"
                        accessibilityHint={t("managerPlanRoute")}
                        accessibilityLabel={t("managerPlanRouteFor", { name: agent.name })}
                        onPress={() => planRouteFor(agent)}
                        style={({ pressed }) => [styles.agentRow, index > 0 && styles.agentBorder, pressed && styles.pressed]}
                      >
                        <View style={styles.agentAvatar}><Text style={styles.agentAvatarText}>{agent.name.charAt(0).toUpperCase()}</Text></View>
                        <View style={styles.agentBody}><Text style={styles.agentName}>{agent.name}</Text><Text style={styles.agentRole}>{agentRoleLabel(agent.role)}</Text></View>
                        <View style={styles.agentPlan}><Text style={styles.agentPlanText}>{t("managerPlanRoute")}</Text><TabIcon name="chevronRight" color={colors.primary} size={17} /></View>
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            )}

            {planning.page.hasMore && !hasPendingSearch ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={loadingMore ? t("fieldLoadingMore") : t("fieldLoadMore")}
                accessibilityState={{ busy: loadingMore, disabled: loading || loadingMore }}
                disabled={loading || loadingMore}
                onPress={() => void load(date, rangeDays, searchQuery, planning.page.number + 1, true)}
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
  scope: { minHeight: 44, marginHorizontal: 14, marginTop: 13, borderRadius: radii.inner, backgroundColor: colors.primarySoft, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 8 },
  scopeText: { flex: 1, color: colors.primary, fontSize: 10, fontWeight: "900" },
  staleText: { maxWidth: "42%", color: colors.warning, fontSize: 9, fontWeight: "800", textAlign: "right" },
  searchBox: { minHeight: 48, marginHorizontal: 14, marginTop: 9, borderRadius: radii.inner, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13 },
  searchInput: { flex: 1, minHeight: 46, color: colors.text, fontSize: 12 },
  pageInfo: { marginHorizontal: 16, marginTop: 7, color: colors.muted, fontSize: 9, fontWeight: "800" },
  notice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: "#F6D788", padding: 11 },
  noticeText: { color: colors.warning, fontSize: 10, lineHeight: 15, fontWeight: "800" },
  sectionHeading: { marginHorizontal: 16, marginTop: 22, marginBottom: 7, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  sectionHint: { color: colors.muted, maxWidth: 260, fontSize: 9, lineHeight: 13, marginTop: 3 },
  sectionCount: { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: colors.primarySoft, color: colors.primary, fontSize: 11, lineHeight: 26, textAlign: "center", fontWeight: "900" },
  routeList: { paddingTop: 1 },
  routeCard: { marginHorizontal: 14, marginTop: 9, borderRadius: radii.card, backgroundColor: colors.card, padding: 14, ...cardShadow },
  routeTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  routeIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  routeBody: { flex: 1, minWidth: 0 },
  routeName: { color: colors.text, fontSize: 13, fontWeight: "900" },
  routeAgent: { color: colors.muted, fontSize: 9, marginTop: 3, fontWeight: "800" },
  routeTail: { flexDirection: "row", alignItems: "center", gap: 6 },
  status: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 6 },
  statusText: { fontSize: 8, fontWeight: "900" },
  progressTop: { marginTop: 13, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressLabel: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  progressPercent: { fontSize: 11, fontWeight: "900" },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.bg, overflow: "hidden", marginTop: 6 },
  fill: { height: "100%", borderRadius: 4 },
  dayList: { gap: 9 },
  dayCoverageCard: { marginHorizontal: 14, borderRadius: radii.card, backgroundColor: colors.card, padding: 13, ...cardShadow },
  dayCoverageTop: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 9 },
  dayCoverageIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  dayCoverageBody: { flex: 1, minWidth: 0 },
  dayCoverageDay: { color: colors.text, fontSize: 12, fontWeight: "900" },
  dayCoverageDate: { color: colors.muted, fontSize: 9, fontWeight: "800", marginTop: 2 },
  dayCoverageStatus: { maxWidth: 114, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 6 },
  dayCoverageStatusText: { fontSize: 8, fontWeight: "900", textAlign: "center" },
  dayCoverageMeta: { color: colors.muted, fontSize: 10, fontWeight: "800", marginTop: 11 },
  agentCard: { marginHorizontal: 14, borderRadius: radii.card, backgroundColor: colors.card, paddingHorizontal: 14, ...cardShadow },
  agentRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 10 },
  agentBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  agentAvatar: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.draftBg, alignItems: "center", justifyContent: "center" },
  agentAvatarText: { color: colors.draft, fontSize: 14, fontWeight: "900" },
  agentBody: { flex: 1 },
  agentName: { color: colors.text, fontSize: 12, fontWeight: "900" },
  agentRole: { color: colors.muted, fontSize: 9, marginTop: 2, fontWeight: "800" },
  agentPlan: { flexDirection: "row", alignItems: "center", gap: 3 },
  agentPlanText: { color: colors.primary, fontSize: 9, fontWeight: "900" },
  empty: { minHeight: 112, marginHorizontal: 14, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 18, ...cardShadow },
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
