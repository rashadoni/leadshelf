import { useCallback, useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { TabIcon, type TabIconName } from "../../../src/components/TabIcon"
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

type SectionState<T> = {
  data: T | null
  error: unknown | null
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
}) {
  const iconColor = tone === "warning" ? colors.warning : tone === "success" ? colors.successDark : tone === "info" ? colors.info : colors.primary
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => router.push(href as never)}
      style={({ pressed }) => [styles.actionCard, wide && styles.actionCardWide, pressed && styles.pressed]}
    >
      <View style={[styles.cardIcon, tone === "warning" ? styles.cardIconWarning : tone === "success" ? styles.cardIconSuccess : tone === "info" ? styles.cardIconInfo : styles.cardIconPrimary]}>
        <TabIcon name={icon} color={iconColor} size={23} />
      </View>
      <Text style={styles.cardTitle}>{title}</Text>
      {loading && !error ? (
        <ActivityIndicator size="small" color={colors.primary} style={styles.cardSpinner} />
      ) : error ? (
        <Text style={styles.cardError}>{isForbidden(error) ? t("managerAccessDeniedBody") : t("managerUnavailable")}</Text>
      ) : (
        <>
          <Text style={styles.cardValue}>{value}</Text>
          <Text style={styles.cardDetail} numberOfLines={2}>{detail}</Text>
        </>
      )}
      <View style={styles.cardFooter}><Text style={styles.cardHint}>{hint}</Text><TabIcon name="chevronRight" color={colors.primary} size={18} /></View>
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
  const calendar = formatCalendarDay(selectedDate, locale)
  const scope = team.data?.scope ?? locations.data?.scope ?? planning.data?.scope ?? approvals.data?.scope ?? attendance.data?.scope ?? null

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.back}>
            <TabIcon name="chevronLeft" color={colors.text} size={23} />
          </Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>LEADDRIVE FIELD</Text>
            <Text style={styles.title}>{t("managerHomeTitle")}</Text>
            <Text style={styles.subtitle}>{t("managerHomeSubtitle")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} disabled={loading} onPress={() => void load()} style={styles.refresh}>
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
            <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.accessRetry}>
              <Text style={styles.accessRetryText}>{t("managerRetry")}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.hero}>
              <View style={styles.heroIcon}><TabIcon name="dashboard" color={colors.headerText} size={25} /></View>
              <View style={styles.heroBody}>
                <Text style={styles.heroEyebrow}>{scope === "ORGANIZATION" ? t("managerScopeOrganization") : t("managerScopeTeam")}</Text>
                <Text style={styles.heroDate}>{calendar.weekday}, {calendar.date}</Text>
              </View>
              <View style={styles.heroStatus}><View style={styles.heroDot} /><Text style={styles.heroStatusText}>{loading ? t("managerLoading") : t("managerUpdated")}</Text></View>
            </View>

            <View style={[styles.grid, layout.isTablet && styles.gridTablet]}>
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
              />
              <ManagerCard
                wide
                title={t("managerAttendanceCardTitle")}
                hint={t("managerAttendanceCardHint")}
                icon="today"
                value={String(attendanceSummary?.recordedDays ?? 0)}
                detail={attendanceSummary
                  ? t("managerAttendancePageSummary", {
                    agents: attendanceSummary.agentsLoaded,
                    days: attendanceSummary.recordedDays,
                    time: compactWorkedTime(attendanceSummary.workedSeconds),
                  })
                  : t("managerAttendanceCardHint")}
                tone="info"
                loading={loading}
                error={attendance.error}
                href="/(app)/manager/attendance"
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
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  refresh: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  accessCard: { flexDirection: "row", alignItems: "center", gap: 12, margin: 14, padding: 15, borderRadius: radii.card, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: "#F6D788" },
  accessIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.cardOverlay, alignItems: "center", justifyContent: "center" },
  accessBody: { flex: 1, minWidth: 0 },
  accessTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  accessText: { color: colors.warning, fontSize: 10, lineHeight: 15, marginTop: 3 },
  accessRetry: { minHeight: 40, paddingHorizontal: 11, borderRadius: 12, backgroundColor: colors.cardOverlay, alignItems: "center", justifyContent: "center" },
  accessRetryText: { color: colors.warning, fontSize: 10, fontWeight: "900" },
  hero: { marginHorizontal: 14, marginTop: 16, padding: 16, borderRadius: 22, backgroundColor: colors.navy, flexDirection: "row", alignItems: "center", gap: 12, ...cardShadow },
  heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  heroBody: { flex: 1, minWidth: 0 },
  heroEyebrow: { color: colors.headerSubtext, fontSize: 9, lineHeight: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  heroDate: { color: colors.headerText, fontSize: 15, fontWeight: "900", marginTop: 3 },
  heroStatus: { maxWidth: 92, borderRadius: radii.pill, backgroundColor: "rgba(255,255,255,0.12)", paddingHorizontal: 8, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  heroDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  heroStatusText: { color: colors.headerText, fontSize: 8, fontWeight: "800", flexShrink: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 14, marginTop: 14 },
  gridTablet: { gap: 14 },
  actionCard: { flexBasis: "48%", flexGrow: 1, minHeight: 184, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, ...cardShadow },
  actionCardWide: { flexBasis: "100%", minHeight: 146 },
  cardIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cardIconPrimary: { backgroundColor: colors.primarySoft },
  cardIconSuccess: { backgroundColor: colors.successBg },
  cardIconWarning: { backgroundColor: colors.warningBg },
  cardIconInfo: { backgroundColor: colors.infoBg },
  cardTitle: { color: colors.text, fontSize: 12, fontWeight: "900", marginTop: 12 },
  cardValue: { color: colors.text, fontSize: 28, fontWeight: "900", letterSpacing: -0.7, marginTop: 5, fontVariant: ["tabular-nums"] },
  cardDetail: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 2 },
  cardSpinner: { alignSelf: "flex-start", marginTop: 14 },
  cardError: { color: colors.warning, fontSize: 9, lineHeight: 13, marginTop: 9 },
  cardFooter: { marginTop: "auto", paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, flexDirection: "row", alignItems: "center", gap: 4 },
  cardHint: { color: colors.faint, flex: 1, fontSize: 8, lineHeight: 11, fontWeight: "700" },
  cardArrow: { color: colors.primary, fontSize: 22, lineHeight: 22 },
  noteCard: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginHorizontal: 14, marginTop: 14, padding: 13, borderRadius: radii.inner, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder },
  noteIcon: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.info, alignItems: "center", justifyContent: "center" },
  noteText: { flex: 1, color: colors.info, fontSize: 10, lineHeight: 15, fontWeight: "700" },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
})
