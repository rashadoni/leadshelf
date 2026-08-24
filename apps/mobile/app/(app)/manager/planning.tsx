import { useCallback, useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { TabIcon } from "../../../src/components/TabIcon"
import type { FieldManagerPlanningData, FieldManagerPlanningRoute } from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import { routeStatusMeta, shiftDateKey, type RouteStatusTone } from "../../../src/field/week-status"
import { t, type MessageKey, useLocale } from "../../../src/i18n"
import { formatCalendarDay } from "../../../src/i18n/date-format"
import { HttpError } from "../../../src/sync/ports-error"
import { cardShadow, colors, radii } from "../../../src/theme"
import { agentRoleLabel } from "../../../src/field/labels"

const knownRouteStatus = new Set(["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "MISSED"])
const RANGE_OPTIONS = [1, 5, 7]
const tones: Record<RouteStatusTone, { background: string; foreground: string }> = {
  draft: { background: colors.draftBg, foreground: colors.draft },
  planned: { background: colors.infoBg, foreground: colors.info },
  inProgress: { background: colors.warningBg, foreground: colors.warning },
  completed: { background: colors.successBg, foreground: colors.successDark },
  cancelled: { background: colors.draftBg, foreground: colors.draft },
  missed: { background: colors.missedBg, foreground: colors.missed },
}

function routeStatus(route: FieldManagerPlanningRoute): { label: string; background: string; foreground: string } {
  if (!knownRouteStatus.has(route.status)) {
    return { label: t("managerRouteStateUnknown"), background: colors.draftBg, foreground: colors.draft }
  }
  const meta = routeStatusMeta(route.status as "DRAFT" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "MISSED")
  const tone = tones[meta.tone]
  return { label: t(meta.labelKey), ...tone }
}

export default function ManagerPlanningScreen() {
  const locale = useLocale()
  const field = useField()
  const { date: requestedDate } = useLocalSearchParams<{ date?: string }>()
  const initialDate = typeof requestedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate.slice(0, 10))
    ? requestedDate.slice(0, 10)
    : field.profile?.todaySummary.date ?? field.week?.today ?? new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(initialDate)
  const [rangeDays, setRangeDays] = useState(1)
  const [data, setData] = useState<FieldManagerPlanningData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async (nextDate = date, nextRangeDays = rangeDays) => {
    setLoading(true)
    setError(null)
    try {
      const rangeEnd = nextRangeDays > 1 ? shiftDateKey(nextDate, nextRangeDays - 1) : undefined
      setData(await fieldApi.managerPlanning(nextDate, rangeEnd))
    } catch (reason) {
      setError(reason)
    } finally {
      setLoading(false)
    }
  }, [date, rangeDays])

  useEffect(() => {
    void load(date, rangeDays)
  }, [date, load, rangeDays])

  const selectDate = (nextDate: string) => {
    if (nextDate === date) return
    setDate(nextDate)
  }

  const calendar = formatCalendarDay(date, locale)
  const endDate = shiftDateKey(date, rangeDays - 1)
  const endCalendar = formatCalendarDay(endDate, locale)
  const dateLabel = rangeDays === 1 ? calendar.date : calendar.date + " — " + endCalendar.date
  const denied = error instanceof HttpError && error.status === 403
  const routes = data?.routes ?? []
  const plannedAgentIds = useMemo(() => new Set(routes.map((route) => route.agentId)), [routes])
  const noRouteAgents = (data?.agents ?? []).filter((agent) => !plannedAgentIds.has(agent.id))

  function planRouteFor(agent: FieldManagerPlanningData["agents"][number]) {
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

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load(date, rangeDays)} tintColor={colors.primary} />}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("managerHomeTitle").toUpperCase()}</Text>
            <Text style={styles.title}>{t("managerPlanningTitle")}</Text>
            <Text style={styles.subtitle}>{t("managerPlanningHint")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} disabled={loading} onPress={() => void load(date, rangeDays)} style={styles.refresh}><Text style={styles.refreshText}>↻</Text></Pressable>
        </View>

        <View style={styles.dateNavigator}>
          <Pressable accessibilityRole="button" accessibilityLabel={t(rangeDays === 1 ? "managerPreviousDay" : "managerPreviousRange")} onPress={() => selectDate(shiftDateKey(date, -rangeDays))} style={styles.dateArrow}><Text style={styles.dateArrowText}>‹</Text></Pressable>
          <View style={styles.dateCenter}>
            <Text style={styles.dateWeekday}>{rangeDays === 1 ? calendar.weekday : t("managerPlanningRange", { count: rangeDays })}</Text>
            <Text style={styles.dateLabel}>{dateLabel}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t(rangeDays === 1 ? "managerNextDay" : "managerNextRange")} onPress={() => selectDate(shiftDateKey(date, rangeDays))} style={styles.dateArrow}><Text style={styles.dateArrowText}>›</Text></Pressable>
        </View>
        <View style={styles.rangePicker}>
          {RANGE_OPTIONS.map((days) => (
            <Pressable key={days} accessibilityRole="button" onPress={() => setRangeDays(days)} style={[styles.rangeChoice, rangeDays === days && styles.rangeChoiceSelected]}>
              <Text style={[styles.rangeChoiceText, rangeDays === days && styles.rangeChoiceTextSelected]}>{t("managerPlanningRange", { count: days })}</Text>
            </Pressable>
          ))}
        </View>

        {loading && !data ? <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>{t("managerLoading")}</Text></View> : null}
        {error && !data ? (
          <View style={[styles.state, denied && styles.stateWarning]}>
            <View style={styles.stateIcon}><TabIcon name="week" color={denied ? colors.warning : colors.primary} size={25} /></View>
            <Text style={styles.stateTitle}>{denied ? t("managerAccessDeniedTitle") : t("managerUnavailable")}</Text>
            <Text style={styles.stateText}>{denied ? t("managerAccessDeniedBody") : t("managerRetry")}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load(date, rangeDays)} style={styles.retry}><Text style={styles.retryText}>{t("managerRetry")}</Text></Pressable>
          </View>
        ) : null}

        {data ? (
          <>
            {error ? <View style={styles.notice}><Text style={styles.noticeText}>{t("managerUnavailable")}</Text></View> : null}
            {data.truncated ? <View style={styles.notice}><Text style={styles.noticeText}>{t("managerPlanningTruncated")}</Text></View> : null}

            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>{t("managerRoutes")}</Text>
              <Text style={styles.sectionCount}>{routes.length}</Text>
            </View>
            {routes.length === 0 ? (
              <View style={styles.empty}><TabIcon name="route" color={colors.primary} size={25} /><Text style={styles.emptyText}>{t("managerNoRoutes")}</Text></View>
            ) : (
              <View style={styles.routeList}>
                {routes.map((route) => {
                  const status = routeStatus(route)
                  const denominator = Math.max(1, route.totalPoints)
                  const progress = Math.max(0, Math.min(100, (route.visitedPoints / denominator) * 100))
                  return (
                    <View key={route.id} style={styles.routeCard}>
                      <View style={styles.routeTop}>
                        <View style={styles.routeIcon}><TabIcon name="route" color={colors.primary} size={21} /></View>
                        <View style={styles.routeBody}>
                          <Text style={styles.routeName} numberOfLines={1}>{route.name ?? t("tabRoute")}</Text>
                          <Text style={styles.routeAgent}>{route.agent.name}{rangeDays > 1 ? " · " + formatCalendarDay(route.date, locale).date : ""}</Text>
                        </View>
                        <View style={[styles.status, { backgroundColor: status.background }]}><Text style={[styles.statusText, { color: status.foreground }]}>{status.label}</Text></View>
                      </View>
                      <View style={styles.progressTop}>
                        <Text style={styles.progressLabel}>{t("managerStopProgress", { visited: route.visitedPoints, total: route.totalPoints })}</Text>
                        <Text style={[styles.progressPercent, { color: status.foreground }]}>{Math.round(progress)}%</Text>
                      </View>
                      <View style={styles.track}><View style={[styles.fill, { width: String(progress) + "%", backgroundColor: status.foreground }]} /></View>
                    </View>
                  )
                })}
              </View>
            )}

            <View style={styles.sectionHeading}>
              <View><Text style={styles.sectionTitle}>{t("managerNoRouteAgents")}</Text><Text style={styles.sectionHint}>{t(rangeDays === 1 ? "managerNoRouteAgentsHint" : "managerRoutePlanDayOnly")}</Text></View>
              <Text style={styles.sectionCount}>{noRouteAgents.length}</Text>
            </View>
            {noRouteAgents.length === 0 ? (
              <View style={styles.empty}><TabIcon name="visit" color={colors.successDark} size={25} /><Text style={styles.emptyText}>{t("managerAllAgentsPlanned")}</Text></View>
            ) : (
              <View style={styles.agentCard}>
                {noRouteAgents.map((agent, index) => (
                  <Pressable
                    key={agent.id}
                    accessibilityRole={rangeDays === 1 ? "button" : undefined}
                    accessibilityLabel={rangeDays === 1 ? t("managerPlanRouteFor", { name: agent.name }) : undefined}
                    disabled={rangeDays !== 1}
                    onPress={() => planRouteFor(agent)}
                    style={({ pressed }) => [styles.agentRow, index > 0 && styles.agentBorder, rangeDays === 1 && pressed && styles.pressed]}
                  >
                    <View style={styles.agentAvatar}><Text style={styles.agentAvatarText}>{agent.name.charAt(0).toUpperCase()}</Text></View>
                    <View style={styles.agentBody}><Text style={styles.agentName}>{agent.name}</Text><Text style={styles.agentRole}>{agentRoleLabel(agent.role)}</Text></View>
                    {rangeDays === 1 ? <View style={styles.agentPlan}><Text style={styles.agentPlanText}>{t("managerPlanRoute")}</Text><Text style={styles.agentPlanArrow}>›</Text></View> : null}
                  </Pressable>
                ))}
              </View>
            )}
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
  backText: { color: colors.text, fontSize: 31, lineHeight: 32 },
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.9 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  refresh: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  refreshText: { color: colors.primary, fontSize: 23, fontWeight: "900" },
  dateNavigator: { marginHorizontal: 14, marginTop: 16, minHeight: 74, borderRadius: radii.card, backgroundColor: colors.navy, padding: 11, flexDirection: "row", alignItems: "center", justifyContent: "space-between", ...cardShadow },
  dateArrow: { width: 44, height: 44, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  dateArrowText: { color: colors.headerText, fontSize: 29, lineHeight: 30 },
  dateCenter: { alignItems: "center", flex: 1 },
  dateWeekday: { color: colors.headerSubtext, fontSize: 9, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  dateLabel: { color: colors.headerText, fontSize: 16, fontWeight: "900", marginTop: 3 },
  rangePicker: { marginHorizontal: 14, marginTop: 9, flexDirection: "row", gap: 7 },
  rangeChoice: { flex: 1, minHeight: 38, borderRadius: radii.inner, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  rangeChoiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  rangeChoiceText: { color: colors.muted, fontSize: 9, fontWeight: "900" },
  rangeChoiceTextSelected: { color: colors.headerText },
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
  status: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 6 },
  statusText: { fontSize: 8, fontWeight: "900" },
  progressTop: { marginTop: 13, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressLabel: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  progressPercent: { fontSize: 11, fontWeight: "900" },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.bg, overflow: "hidden", marginTop: 6 },
  fill: { height: "100%", borderRadius: 4 },
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
  agentPlanArrow: { color: colors.primary, fontSize: 21, lineHeight: 21 },
  empty: { minHeight: 112, marginHorizontal: 14, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", gap: 9, ...cardShadow },
  emptyText: { color: colors.muted, fontSize: 11, fontWeight: "800", textAlign: "center" },
  state: { minHeight: 230, margin: 14, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", padding: 24, ...cardShadow },
  stateWarning: { backgroundColor: colors.warningBg, borderWidth: 1, borderColor: "#F6D788" },
  stateIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  stateTitle: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "center" },
  stateText: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 7 },
  retry: { minHeight: 44, marginTop: 16, borderRadius: 13, paddingHorizontal: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  retryText: { color: colors.headerText, fontSize: 11, fontWeight: "900" },
  pressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
})
