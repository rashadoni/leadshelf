import { useCallback, useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { TabIcon, type TabIconName } from "../../../src/components/TabIcon"
import { FieldScreenChrome } from "../../../src/components/FieldScreenChrome"
import type {
  FieldManagerApprovalsData,
  FieldManagerAttendanceData,
  FieldManagerLocationsData,
  FieldManagerPlanningData,
  FieldManagerTeamData,
} from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import { formatCalendarDay } from "../../../src/i18n/date-format"
import { t, useLocale } from "../../../src/i18n"
import { HttpError } from "../../../src/sync/ports-error"
import { cardShadow, colors, radii } from "../../../src/theme"
import { useResponsiveLayout } from "../../../src/layout/responsive"
import { safeFieldBack } from "../../../src/navigation/safe-back"

type SectionState<T> = {
  data: T | null
  error: unknown | null
}

type ManagerAttention = {
  title: string
  detail: string
  count: number
  icon: TabIconName
  href: string
}

function failed<T>(reason: unknown): SectionState<T> {
  return { data: null, error: reason }
}

function ready<T>(data: T): SectionState<T> {
  return { data, error: null }
}

function isForbidden(reason: unknown): boolean {
  return reason instanceof HttpError && reason.status === 403
}

function compactWorkedTime(totalSeconds: number): string {
  const minutes = Math.max(0, Math.floor(totalSeconds / 60))
  const hours = Math.floor(minutes / 60)
  return String(hours).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0")
}

function ManagerCard({
  title,
  hint,
  icon,
  value,
  detail,
  tone = "primary",
  error,
  loading,
  href,
  wide = false,
  tablet = false,
}: {
  title: string
  hint: string
  icon: TabIconName
  value: string
  detail: string
  tone?: "primary" | "success" | "warning" | "info"
  error: unknown | null
  loading: boolean
  href: string
  wide?: boolean
  tablet?: boolean
}) {
  const iconColor = tone === "warning" ? colors.warning : colors.primary
  const cardAccessibilityDetail = loading && !error
    ? t("managerLoading")
    : error
      ? isForbidden(error) ? t("managerAccessDeniedBody") : t("managerUnavailable")
      : value + ". " + detail
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={hint}
      accessibilityLabel={title + ". " + cardAccessibilityDetail}
      accessibilityState={{ busy: loading && !error }}
      onPress={() => router.push(href as never)}
      style={({ pressed }) => [styles.actionRow, tablet && styles.actionRowTablet, wide && styles.actionRowWide, pressed && styles.pressed]}
    >
      <View style={[styles.cardIcon, tone === "warning" ? styles.cardIconWarning : tone === "success" ? styles.cardIconSuccess : tone === "info" ? styles.cardIconInfo : styles.cardIconPrimary]}>
        <TabIcon name={icon} color={iconColor} size={21} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        {loading && !error ? (
          <ActivityIndicator size="small" color={colors.primary} style={styles.cardSpinner} />
        ) : error ? (
          <Text style={styles.cardError}>{isForbidden(error) ? t("managerAccessDeniedBody") : t("managerUnavailable")}</Text>
        ) : (
          <Text style={styles.cardDetail} numberOfLines={2}>{detail}</Text>
        )}
      </View>
      {!loading && !error ? (
        <View style={styles.cardMetric}>
          <Text style={styles.cardValue}>{value}</Text>
          <Text style={styles.cardHint} numberOfLines={1}>{hint}</Text>
        </View>
      ) : null}
      <TabIcon name="chevronRight" color={colors.muted} size={20} />
    </Pressable>
  )
}

export default function ManagerHomeScreen() {
  const locale = useLocale()
  const field = useField()
  const layout = useResponsiveLayout()
  const selectedDate = field.profile?.todaySummary.date ?? field.week?.today ?? new Date().toISOString().slice(0, 10)
  const [team, setTeam] = useState<SectionState<FieldManagerTeamData>>({ data: null, error: null })
  const [locations, setLocations] = useState<SectionState<FieldManagerLocationsData>>({ data: null, error: null })
  const [planning, setPlanning] = useState<SectionState<FieldManagerPlanningData>>({ data: null, error: null })
  const [approvals, setApprovals] = useState<SectionState<FieldManagerApprovalsData>>({ data: null, error: null })
  const [attendance, setAttendance] = useState<SectionState<FieldManagerAttendanceData>>({ data: null, error: null })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const results = await Promise.allSettled([
      fieldApi.managerTeam({ page: 1, limit: 25 }),
      fieldApi.managerLocations({ page: 1, limit: 25 }),
      fieldApi.managerPlanning(selectedDate, undefined, { page: 1, limit: 25 }),
      fieldApi.managerApprovals(),
      fieldApi.managerAttendance(selectedDate, selectedDate, { page: 1, limit: 25 }),
    ])
    const [teamResult, locationsResult, planningResult, approvalsResult, attendanceResult] = results
    if (teamResult.status === "fulfilled") setTeam(ready(teamResult.value))
    else setTeam(failed(teamResult.reason))
    if (locationsResult.status === "fulfilled") setLocations(ready(locationsResult.value))
    else setLocations(failed(locationsResult.reason))
    if (planningResult.status === "fulfilled") setPlanning(ready(planningResult.value))
    else setPlanning(failed(planningResult.reason))
    if (approvalsResult.status === "fulfilled") setApprovals(ready(approvalsResult.value))
    else setApprovals(failed(approvalsResult.reason))
    if (attendanceResult.status === "fulfilled") setAttendance(ready(attendanceResult.value))
    else setAttendance(failed(attendanceResult.reason))
    setLoading(false)
  }, [selectedDate])

  useEffect(() => {
    void load()
  }, [load])

  const deniedEverywhere = [team.error, locations.error, planning.error, approvals.error, attendance.error]
    .every((reason) => reason != null && isForbidden(reason))
  const hasPartialFailure = [team.error, locations.error, planning.error, approvals.error, attendance.error]
    .some((reason) => reason != null)
  const teamAgents = team.data?.agents ?? []
  const teamTotal = team.data?.page.total ?? teamAgents.length
  const supportsTodayContract = team.data?.today != null
  const activeWorkdays = teamAgents.filter((agent) => (
    supportsTodayContract
      ? agent.todayWorkday?.status === "STARTED"
      : agent.workday?.status === "STARTED"
  )).length
  const pausedWorkdays = teamAgents.filter((agent) => (
    supportsTodayContract
      ? agent.todayWorkday?.status === "PAUSED"
      : agent.workday?.status === "PAUSED"
  )).length
  const completedWorkdays = supportsTodayContract
    ? teamAgents.filter((agent) => agent.todayWorkday?.status === "COMPLETED").length
    : 0
  const locationAgents = locations.data?.locations ?? []
  const locationTotal = locations.data?.page.total ?? locationAgents.length
  const liveLocations = locationAgents.filter((agent) => agent.freshness === "ONLINE").length
  const lastKnownLocations = locationAgents.filter((agent) => agent.freshness === "DELAYED" || agent.freshness === "STALE").length
  const noLocations = locationAgents.filter((agent) => agent.freshness === "NO_LOCATION").length
  const routes = planning.data?.routes ?? []
  const plannedAgentIds = useMemo(() => new Set(routes.map((route) => route.agentId)), [routes])
  const planningAgents = planning.data?.agents ?? []
  const planningTotal = planning.data?.page.total ?? planningAgents.length
  const withoutRoute = planningAgents.filter((agent) => !plannedAgentIds.has(agent.id)).length
  const loadedApprovals = approvals.data
    ? approvals.data.counts.hrm + approvals.data.counts.routeChanges + approvals.data.counts.customers + approvals.data.counts.contactChanges
    : 0
  const attendanceSummary = attendance.data?.pageSummary
  const attendanceScheduleSummary = attendance.data?.schedulePageSummary
  const attendanceScheduleIssues = attendanceScheduleSummary
    ? attendanceScheduleSummary.lateDays + attendanceScheduleSummary.absentDays +
      attendanceScheduleSummary.unclosedDays + attendanceScheduleSummary.earlyFinishDays +
      attendanceScheduleSummary.unresolvedDays + attendanceScheduleSummary.dataConflictDays
    : 0
  const calendar = formatCalendarDay(selectedDate, locale)
  const scope = team.data?.scope ?? locations.data?.scope ?? planning.data?.scope ?? approvals.data?.scope ?? attendance.data?.scope ?? null
  const attentionItems: ManagerAttention[] = [
    !approvals.error && loadedApprovals > 0
      ? { title: t("managerApprovalsCardTitle"), detail: t("managerApprovalsCardHint"), count: loadedApprovals, icon: "inbox", href: "/(app)/manager/approvals" }
      : null,
    !planning.error && withoutRoute > 0
      ? { title: t("managerPlanningCardTitle"), detail: t("managerPlanningPageSummary", { routes: routes.length, missing: withoutRoute }), count: withoutRoute, icon: "week", href: "/(app)/manager/planning" }
      : null,
    !locations.error && noLocations > 0
      ? { title: t("managerLocationsCardTitle"), detail: t("managerLocationsCardHint"), count: noLocations, icon: "location", href: "/(app)/manager/locations" }
      : null,
  ].filter((item): item is ManagerAttention => item !== null)
  const primaryAttention = attentionItems[0] ?? null
  const secondaryAttentionItems = attentionItems.slice(1)
  const contextStatusLabel = loading ? t("managerLoading") : hasPartialFailure ? t("managerUnavailable") : t("managerUpdated")

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <FieldScreenChrome />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => safeFieldBack("/(app)/(tabs)/work")} style={styles.back}>
            <TabIcon name="chevronLeft" color={colors.text} size={23} />
          </Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>LEADDRIVE FIELD</Text>
            <Text style={styles.title}>{t("managerHomeTitle")}</Text>
            <Text style={styles.subtitle}>{t("managerHomeSubtitle")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} accessibilityState={{ busy: loading, disabled: loading }} disabled={loading} onPress={() => void load()} style={styles.refresh}>
            <TabIcon name="refresh" color={colors.primary} size={22} />
          </Pressable>
        </View>

        {deniedEverywhere ? (
          <View style={styles.accessCard}>
            <View style={styles.accessIcon}><TabIcon name="profile" color={colors.warning} size={26} /></View>
            <View style={styles.accessBody}>
              <Text style={styles.accessTitle}>{t("managerAccessDeniedTitle")}</Text>
              <Text style={styles.accessText}>{t("managerAccessDeniedBody")}</Text>
            </View>
            <Pressable accessibilityLabel={t("managerRetry")} accessibilityRole="button" accessibilityState={{ busy: loading }} onPress={() => void load()} style={styles.accessRetry}>
              <Text style={styles.accessRetryText}>{t("managerRetry")}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.contextBar}>
              <View style={styles.contextIcon}><TabIcon name="today" color={colors.primary} size={20} /></View>
              <View style={styles.contextBody}>
                <Text style={styles.contextEyebrow}>{scope === "ORGANIZATION" ? t("managerScopeOrganization") : t("managerScopeTeam")}</Text>
                <Text style={styles.contextDate}>{calendar.weekday}, {calendar.date}</Text>
              </View>
              <View accessible accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={contextStatusLabel} style={[styles.contextStatus, hasPartialFailure && styles.contextStatusWarning]}><View style={[styles.contextDot, hasPartialFailure && styles.contextDotWarning]} /><Text style={[styles.contextStatusText, hasPartialFailure && styles.contextStatusTextWarning]}>{contextStatusLabel}</Text></View>
            </View>

            {primaryAttention ? (
              <View style={styles.attentionList}>
                <Text style={styles.attentionListTitle}>{t("managerAttentionTitle")}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${primaryAttention.count}. ${primaryAttention.title}`}
                  accessibilityHint={primaryAttention.detail}
                  onPress={() => router.push(primaryAttention.href as never)}
                  style={({ pressed }) => [styles.attentionPrimary, pressed && styles.pressed]}
                >
                  <View style={styles.attentionPrimaryIcon}><TabIcon name={primaryAttention.icon} color={colors.warning} size={23} /></View>
                  <View style={styles.attentionBody}>
                    <Text style={styles.attentionPrimaryTitle}>{primaryAttention.title}</Text>
                    <Text style={styles.attentionPrimaryDetail} numberOfLines={2}>{primaryAttention.detail}</Text>
                  </View>
                  <Text style={styles.attentionPrimaryCount}>{primaryAttention.count}</Text>
                  <TabIcon name="chevronRight" color={colors.warning} size={22} />
                </Pressable>
                {secondaryAttentionItems.map((attention) => (
                  <Pressable
                    key={attention.href}
                    accessibilityRole="button"
                    accessibilityLabel={`${attention.count}. ${attention.title}`}
                    accessibilityHint={attention.detail}
                    onPress={() => router.push(attention.href as never)}
                    style={({ pressed }) => [styles.attentionCard, styles.attentionCardDivider, pressed && styles.pressed]}
                  >
                    <View style={styles.attentionIcon}><TabIcon name={attention.icon} color={colors.warning} size={21} /></View>
                    <View style={styles.attentionBody}>
                      <Text style={styles.attentionTitle}>{attention.title}</Text>
                      <Text style={styles.attentionDetail} numberOfLines={1}>{attention.detail}</Text>
                    </View>
                    <Text style={styles.attentionCount}>{attention.count}</Text>
                    <TabIcon name="chevronRight" color={colors.warning} size={20} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={[styles.operationList, layout.isTablet && styles.operationListTablet]}>
              <ManagerCard
                title={t("managerTeamCardTitle")}
                hint={t("managerTeamCardHint")}
                icon="profile"
                value={String(teamAgents.length) + "/" + String(teamTotal)}
                detail={
                  t("managerLoadedOfTotal", { loaded: teamAgents.length, total: teamTotal }) + " · " +
                  String(activeWorkdays) + " " + t("managerWorkingNow") +
                  " · " + String(pausedWorkdays) + " " + t("managerPaused") +
                  (supportsTodayContract ? " · " + String(completedWorkdays) + " " + t("managerCompleted") : "")
                }
                tone="primary"
                loading={loading}
                error={team.error}
                href="/(app)/manager/team"
                tablet={layout.isTablet}
              />
              <ManagerCard
                title={t("managerLocationsCardTitle")}
                hint={t("managerLocationsCardHint")}
                icon="location"
                value={String(locationAgents.length) + "/" + String(locationTotal)}
                detail={
                  t("managerLoadedOfTotal", { loaded: locationAgents.length, total: locationTotal }) + " · " +
                  String(liveLocations) + " " + t("managerLive") +
                  " · " + String(lastKnownLocations) + " " + t("managerLastKnown") +
                  " · " + String(noLocations) + " " + t("managerNoLocation")
                }
                tone={liveLocations > 0 ? "success" : "info"}
                loading={loading}
                error={locations.error}
                href="/(app)/manager/locations"
                tablet={layout.isTablet}
              />
              <ManagerCard
                title={t("managerPlanningCardTitle")}
                hint={t("managerPlanningCardHint")}
                icon="week"
                value={String(planningAgents.length) + "/" + String(planningTotal)}
                detail={t("managerPlanningPageSummary", { routes: routes.length, missing: withoutRoute })}
                tone={withoutRoute > 0 ? "warning" : "primary"}
                loading={loading}
                error={planning.error}
                href="/(app)/manager/planning"
                tablet={layout.isTablet}
              />
              <ManagerCard
                title={t("managerApprovalsCardTitle")}
                hint={t("managerApprovalsCardHint")}
                icon="inbox"
                value={String(loadedApprovals)}
                detail={t("managerItemsLoaded")}
                tone={loadedApprovals > 0 ? "warning" : "info"}
                loading={loading}
                error={approvals.error}
                href="/(app)/manager/approvals"
                tablet={layout.isTablet}
              />
              <ManagerCard
                wide
                title={t("managerAttendanceCardTitle")}
                hint={t("managerAttendanceCardHint")}
                icon="today"
                value={String(attendanceScheduleSummary?.scheduledDays ?? attendanceSummary?.recordedDays ?? 0)}
                detail={attendanceScheduleSummary
                  ? t("managerAttendanceSchedulePageSummary", {
                    scheduled: attendanceScheduleSummary.scheduledDays,
                    onTime: attendanceScheduleSummary.onTimeDays,
                    issues: attendanceScheduleIssues,
                  })
                  : attendanceSummary ? t("managerAttendancePageSummary", {
                    agents: attendanceSummary.agentsLoaded,
                    days: attendanceSummary.recordedDays,
                    time: compactWorkedTime(attendanceSummary.workedSeconds),
                  })
                  : t("managerAttendanceCardHint")}
                tone={attendanceScheduleSummary ? attendanceScheduleIssues > 0 ? "warning" : "success" : "info"}
                loading={loading}
                error={attendance.error}
                href="/(app)/manager/attendance"
                tablet={layout.isTablet}
              />
            </View>

            <View style={styles.noteCard}>
              <View style={styles.noteIcon}><TabIcon name="info" color={colors.headerText} size={14} /></View>
              <Text style={styles.noteText}>{t("managerLocationsHint")}</Text>
            </View>
          </>
        )}
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
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  title: { color: colors.text, fontSize: 24, fontWeight: "900", marginTop: 2, letterSpacing: -0.45 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  refresh: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  accessCard: { flexDirection: "row", alignItems: "center", gap: 12, margin: 14, padding: 15, borderRadius: radii.card, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.warningBorder },
  accessIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.cardOverlay, alignItems: "center", justifyContent: "center" },
  accessBody: { flex: 1, minWidth: 0 },
  accessTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  accessText: { color: colors.warning, fontSize: 12, lineHeight: 17, marginTop: 3 },
  accessRetry: { minHeight: 44, paddingHorizontal: 11, borderRadius: 12, backgroundColor: colors.cardOverlay, alignItems: "center", justifyContent: "center" },
  accessRetryText: { color: colors.warning, fontSize: 12, fontWeight: "900" },
  contextBar: { marginHorizontal: 14, marginTop: 14, minHeight: 68, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radii.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 10 },
  contextIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  contextBody: { flex: 1, minWidth: 0 },
  contextEyebrow: { color: colors.muted, fontSize: 11, lineHeight: 15, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.55 },
  contextDate: { color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 2 },
  contextStatus: { maxWidth: 100, borderRadius: radii.pill, backgroundColor: colors.successBg, paddingHorizontal: 8, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  contextStatusWarning: { backgroundColor: colors.warningBg },
  contextDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  contextDotWarning: { backgroundColor: colors.warning },
  contextStatusText: { color: colors.successDark, fontSize: 11, fontWeight: "800", flexShrink: 1 },
  contextStatusTextWarning: { color: colors.warning },
  attentionList: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.card, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.warningBorder, overflow: "hidden" },
  attentionListTitle: { color: colors.warning, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.6, paddingHorizontal: 12, paddingTop: 11, paddingBottom: 5 },
  attentionPrimary: { minHeight: 82, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 11 },
  attentionPrimaryIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.warningBg, alignItems: "center", justifyContent: "center" },
  attentionPrimaryTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  attentionPrimaryDetail: { color: colors.warning, fontSize: 12, lineHeight: 17, fontWeight: "700", marginTop: 2 },
  attentionPrimaryCount: { color: colors.warning, fontSize: 26, fontWeight: "900", fontVariant: ["tabular-nums"] },
  attentionCard: { minHeight: 66, paddingHorizontal: 12, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 10 },
  attentionCardDivider: { borderTopWidth: 1, borderTopColor: colors.warningBorder },
  attentionIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  attentionBody: { flex: 1, minWidth: 0 },
  attentionTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  attentionDetail: { color: colors.warning, fontSize: 11, fontWeight: "700", marginTop: 2 },
  attentionCount: { color: colors.warning, fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"] },
  operationList: { gap: 9, paddingHorizontal: 14, marginTop: 12 },
  operationListTablet: { alignSelf: "center", width: "94%", maxWidth: 860, paddingHorizontal: 0, flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 12 },
  actionRow: { minHeight: 86, borderRadius: radii.card, padding: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 10, ...cardShadow },
  actionRowTablet: { width: "48.9%" },
  actionRowWide: { width: "100%" },
  cardIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cardIconPrimary: { backgroundColor: colors.primarySoft },
  cardIconSuccess: { backgroundColor: colors.successBg },
  cardIconWarning: { backgroundColor: colors.warningBg },
  cardIconInfo: { backgroundColor: colors.infoBg },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  cardValue: { color: colors.text, fontSize: 21, fontWeight: "900", letterSpacing: -0.4, fontVariant: ["tabular-nums"] },
  cardDetail: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  cardSpinner: { alignSelf: "flex-start", marginTop: 6 },
  cardError: { color: colors.warning, fontSize: 12, lineHeight: 17, marginTop: 3 },
  cardMetric: { width: 76, alignItems: "flex-end", gap: 2 },
  cardHint: { color: colors.muted, fontSize: 11, lineHeight: 15, fontWeight: "700", textAlign: "right" },
  noteCard: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginHorizontal: 14, marginTop: 14, padding: 13, borderRadius: radii.inner, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder },
  noteIcon: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.info, alignItems: "center", justifyContent: "center" },
  noteText: { flex: 1, color: colors.info, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
})
