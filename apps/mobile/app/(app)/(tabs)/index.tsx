import { useCallback, useMemo, useState } from "react"
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { router, useFocusEffect } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { countOpenTasks, listVisits } from "../../../src/db/local-store"
import { useField } from "../../../src/field/field-context"
import { presentFieldAttendancePolicy } from "../../../src/field/attendance-policy"
import { routeStatusMeta, type RouteStatusTone } from "../../../src/field/week-status"
import { resolveFieldRouteFlow } from "../../../src/field/route-flow"
import type { FieldWorkdayStatus } from "../../../src/field/contracts"
import { formatLongDate, formatTime } from "../../../src/i18n/date-format"
import { t, useLocale, type MessageKey } from "../../../src/i18n"
import { useSync } from "../../../src/sync/sync-context"
import { BrandMark } from "../../../src/components/BrandMark"
import { TabIcon, type TabIconName } from "../../../src/components/TabIcon"
import { colors, radii } from "../../../src/theme"
import { useResponsiveLayout } from "../../../src/layout/responsive"
import { IS_LEADDRIVE_FIELD, mobileVariant } from "../../../src/config/mobile-variant"

const toneStyles: Record<RouteStatusTone, { bg: string; border: string; text: string }> = {
  draft: { bg: colors.draftBg, border: colors.draftBorder, text: colors.draft },
  planned: { bg: colors.infoBg, border: colors.infoBorder, text: colors.info },
  inProgress: { bg: colors.warningBg, border: "#F6D788", text: colors.warning },
  completed: { bg: colors.successBg, border: colors.successBorder, text: colors.successDark },
  cancelled: { bg: colors.draftBg, border: colors.draftBorder, text: colors.draft },
  missed: { bg: colors.missedBg, border: colors.missedBorder, text: colors.missed },
}

type DisplayWorkdayStatus = FieldWorkdayStatus | "NOT_STARTED"

const workdayStatusKeys: Record<DisplayWorkdayStatus, MessageKey> = {
  NOT_STARTED: "workdayStatus_NOT_STARTED",
  STARTED: "workdayStatus_STARTED",
  PAUSED: "workdayStatus_PAUSED",
  COMPLETED: "workdayStatus_COMPLETED",
}

export default function TodayTab() {
  const locale = useLocale()
  const field = useField()
  const shelf = useSync()
  const layout = useResponsiveLayout()
  const [localOpenTasks, setLocalOpenTasks] = useState(0)
  const [localVisits, setLocalVisits] = useState(0)

  const reloadLocal = useCallback(() => {
    setLocalOpenTasks(countOpenTasks())
    setLocalVisits(listVisits().length)
  }, [])
  useFocusEffect(reloadLocal)

  const today = useMemo(
    () => field.week?.days.find((day) => day.isToday) ?? null,
    [field.week],
  )
  const summary = field.profile?.todaySummary
  const shelfRunning = !["idle", "offline", "error", "authLost", "upgradeRequired"].includes(shelf.status.phase)
  const refreshing = field.phase === "refreshing" || shelfRunning

  async function onRefresh() {
    await Promise.all([field.refresh(), shelf.sync()])
    reloadLocal()
  }

  const routePoints = summary?.routePoints ?? today?.routes.reduce((sum, route) => sum + route.totalPoints, 0) ?? 0
  const visitedPoints = summary?.routeVisited ?? today?.routes.reduce((sum, route) => sum + route.visitedPoints, 0) ?? 0
  const progress = routePoints > 0 ? Math.min(100, Math.round((visitedPoints / routePoints) * 100)) : 0
  const activeVisit = field.week?.days.flatMap((day) => day.visits.items).find((visit) => visit.status === "CHECKED_IN") ?? null
  const activeRoute = activeVisit?.routeId ? today?.routes.find((route) => route.id === activeVisit.routeId) ?? null : null
  const nextRoute = activeRoute ?? today?.routes.find((route) => resolveFieldRouteFlow(route, activeVisit).primaryPoint !== null) ?? null
  const nextRouteFlow = nextRoute ? resolveFieldRouteFlow(nextRoute, activeVisit) : null
  const nextStopName = nextRouteFlow?.primaryPoint
    ? nextRouteFlow.primaryPoint.contact?.displayName ?? nextRouteFlow.primaryPoint.customer.name
    : null
  const routeActionHref = activeVisit
    ? "/(app)/field-visits/" + activeVisit.id
    : nextRoute
      ? "/(app)/routes/" + nextRoute.id
      : "/(app)/(tabs)/week"
  const routeActionLabel = activeVisit
    ? t("continueFieldVisit")
    : nextStopName
      ? t("routeNextStop") + ": " + nextStopName
      : t("openRoute")
  const workdayStatus: DisplayWorkdayStatus = field.workday?.workday?.status ?? "NOT_STARTED"
  const workdayActive = workdayStatus === "STARTED"
  const attendancePresentation = presentFieldAttendancePolicy(field.workday?.attendancePolicy)
  const fieldOpenTasks = field.agentTasks?.tasks.filter((task) => task.status !== "COMPLETED" && task.status !== "CANCELLED").length ?? 0
  const openTasks = IS_LEADDRIVE_FIELD ? fieldOpenTasks : localOpenTasks
  const metrics = [
    { value: String(summary?.visits ?? localVisits), label: t("statVisitsToday") },
    { value: String(summary?.tasksCompleted ?? 0), label: t("statDoneTasks") },
    { value: String(openTasks), label: t("statOpenTasks") },
    { value: String(shelf.status.pendingOps + shelf.status.pendingPhotos), label: t("statPendingSync") },
  ]

  const actions: Array<[string, string, TabIconName]> = IS_LEADDRIVE_FIELD
    ? [
        [t("tabRoute"), "/(app)/routes", "route"],
        [t("agentTasksTitle"), "/(app)/field-tasks", "tasks"],
        [t("moduleOrganizations"), "/(app)/organizations", "organizations"],
        [t("moduleContacts"), "/(app)/contacts", "contacts"],
      ]
    : [
        [t("tabRoute"), "/(app)/routes", "route"],
        [t("tabTasks"), "/(app)/(tabs)/tasks", "tasks"],
        [t("tabPlanograms"), "/(app)/(tabs)/planograms", "planograms"],
        [t("tabOrders"), "/(app)/(tabs)/orders", "orders"],
      ]

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.headerText} />}
      >
        <View style={styles.hero}>
          <View style={styles.brandRow}>
            <BrandMark compact />
            <Text style={styles.brandName}>{mobileVariant.appName}</Text>
            <View style={styles.liveStatus}><View style={styles.liveDot} /><Text style={styles.liveText}>{t("syncIdle")}</Text></View>
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>{t("tabToday").toUpperCase()}</Text>
            <Text style={styles.heroTitle}>{field.profile?.agent.name ?? t("appName")}</Text>
            <Text style={styles.heroDate}>{formatLongDate(new Date(), locale)}</Text>
          </View>
        </View>

        {field.phase === "stale" || field.phase === "error" ? (
          <View style={[styles.notice, field.phase === "error" && styles.noticeError]}>
            <View style={styles.noticeBody}>
              <Text style={styles.noticeTitle}>{field.phase === "error" ? t("fieldDataError") : t("fieldDataStale")}</Text>
              {field.lastUpdatedAt ? <Text style={styles.noticeMeta}>{formatTime(field.lastUpdatedAt)}</Text> : null}
            </View>
            <Pressable onPress={() => void field.refresh()} style={styles.noticeAction}>
              <Text style={styles.noticeActionText}>{t("refresh")}</Text>
            </Pressable>
          </View>
        ) : null}

        {IS_LEADDRIVE_FIELD ? (
          <Pressable onPress={() => router.push("/(app)/workday" as never)} style={styles.workdayCard}>
            <View style={[styles.workdayIcon, workdayActive && styles.workdayIconActive]}>
              <TabIcon name="today" color={colors.primary} size={22} />
            </View>
            <View style={styles.workdayBody}>
              <Text style={styles.workdayTitle}>{t(workdayStatusKeys[workdayStatus])}</Text>
              <Text style={styles.workdayHint}>{t(attendancePresentation.hintKey)}</Text>
            </View>
            <Text style={styles.workdayAction}>{workdayStatus === "NOT_STARTED" ? t("workdayStart") : "→"}</Text>
          </Pressable>
        ) : null}

        <View style={layout.isTablet ? styles.tabletColumns : undefined}>
          <View style={layout.isTablet ? styles.tabletPrimary : undefined}>
        <View style={[styles.overview, layout.isTablet && styles.tabletSection]}>
          <View style={styles.overviewHeader}>
            <Text style={styles.sectionEyebrow}>{t("todayOverview").toUpperCase()}</Text>
            <Text style={styles.overviewMeta}>{visitedPoints}/{routePoints}</Text>
          </View>
          <View style={styles.metrics}>
          {metrics.map((metric) => (
            <View key={metric.label} style={styles.metricCard}>
              <Text style={styles.metricValue}>{metric.value}</Text>
              <Text style={styles.metricLabel}>{metric.label}</Text>
            </View>
          ))}
          </View>
        </View>

        <View style={[styles.card, layout.isTablet && styles.tabletSection]}>
          <View style={styles.progressHeader}>
            <View>
              <Text style={styles.cardTitle}>{t("routeProgress")}</Text>
              <Text style={styles.cardMeta}>{visitedPoints} / {routePoints} {t("routeVisitedLabel")}</Text>
            </View>
            <Text style={styles.progressValue}>{progress}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>

          {today?.routes.length ? (
            <View style={styles.routeList}>
              {today.routes.map((route) => {
                const meta = routeStatusMeta(route.effectiveStatus)
                const tone = toneStyles[meta.tone]
                return (
                  <View key={route.id} style={styles.routeRow}>
                    <View style={styles.routeBody}>
                      <Text style={styles.routeName}>{route.name ?? t("tabRoute")}</Text>
                      <Text style={styles.routeMeta}>{route.totalPoints} {t("routePointsLabel")} · {route.visitedPoints} {t("routeVisitedLabel")}</Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                      <Text style={[styles.statusText, { color: tone.text }]}>{t(meta.labelKey)}</Text>
                    </View>
                  </View>
                )
              })}
            </View>
          ) : (
            <Text style={styles.emptyText}>{t("noRouteToday")}</Text>
          )}
          <Pressable onPress={() => router.push(routeActionHref as never)} style={styles.primaryAction}>
            <Text style={styles.primaryActionText} numberOfLines={1}>{routeActionLabel}</Text>
            <Text style={styles.primaryArrow}>→</Text>
          </Pressable>
        </View>
          </View>
          <View style={layout.isTablet ? styles.tabletSecondary : undefined}>
        <View style={[styles.sectionHeader, layout.isTablet && styles.tabletSectionHeader]}>
          <Text style={styles.sectionTitle}>{t("quickActions")}</Text>
        </View>
        <View style={[styles.actionList, layout.isTablet && styles.tabletSection]}>
          {actions.map(([label, href, icon], index) => (
            <Pressable
              key={label}
              onPress={() => router.push(href as never)}
              style={({ pressed }) => [styles.actionRow, index > 0 && styles.actionBorder, pressed && styles.pressed]}
            >
              <View style={styles.actionIcon}><TabIcon name={icon} color={colors.primary} size={20} /></View>
              <Text style={styles.actionText}>{label}</Text>
              <Text style={styles.actionArrow}>›</Text>
            </Pressable>
          ))}
        </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navy },
  scroll: { minHeight: "100%", backgroundColor: colors.bg, paddingBottom: 28 },
  hero: { backgroundColor: colors.navy, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  brandRow: { minHeight: 40, flexDirection: "row", alignItems: "center" },
  brandName: { color: colors.headerText, fontSize: 17, fontWeight: "900", letterSpacing: -0.4, marginLeft: 10 },
  liveStatus: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  liveText: { color: colors.headerSubtext, fontSize: 10, fontWeight: "700" },
  heroCopy: { marginTop: 32 },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  heroTitle: { color: colors.headerText, fontSize: 29, fontWeight: "900", marginTop: 7, letterSpacing: -0.8 },
  heroDate: { color: colors.headerSubtext, fontSize: 13, marginTop: 6 },
  notice: { marginHorizontal: 20, marginTop: 16, padding: 12, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningBg, flexDirection: "row", alignItems: "center", gap: 10 },
  noticeError: { borderColor: colors.missedBorder, backgroundColor: colors.missedBg },
  noticeBody: { flex: 1 },
  noticeTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  noticeMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  noticeAction: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.card },
  noticeActionText: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  workdayCard: { marginHorizontal: 20, marginTop: 16, minHeight: 76, borderRadius: radii.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, padding: 13, flexDirection: "row", alignItems: "center", gap: 12 },
  workdayIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.draftBg, alignItems: "center", justifyContent: "center" },
  workdayIconActive: { backgroundColor: colors.successBg },
  workdayBody: { flex: 1, minWidth: 0 },
  workdayTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  workdayHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  workdayAction: { maxWidth: 92, color: colors.primary, fontSize: 11, fontWeight: "900", textAlign: "right" },
  overview: { marginHorizontal: 20, marginTop: 18, backgroundColor: colors.card, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border },
  overviewHeader: { minHeight: 44, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionEyebrow: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  overviewMeta: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  metrics: { flexDirection: "row", paddingVertical: 15 },
  metricCard: { width: "25%", minHeight: 54, paddingHorizontal: 8, borderRightWidth: 1, borderRightColor: colors.border },
  metricValue: { color: colors.text, fontSize: 22, fontWeight: "900", textAlign: "center" },
  metricLabel: { color: colors.muted, fontSize: 9, lineHeight: 12, marginTop: 4, textAlign: "center" },
  sectionHeader: { marginHorizontal: 20, marginTop: 25, marginBottom: 10 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900", letterSpacing: -0.2 },
  card: { marginHorizontal: 20, backgroundColor: colors.card, borderRadius: radii.card, padding: 17, borderWidth: 1, borderColor: colors.border },
  progressHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  cardMeta: { color: colors.muted, fontSize: 12, marginTop: 3 },
  progressValue: { color: colors.primary, fontSize: 21, fontWeight: "900" },
  progressTrack: { height: 6, borderRadius: radii.pill, backgroundColor: colors.skeleton, overflow: "hidden", marginTop: 15 },
  progressFill: { height: "100%", borderRadius: radii.pill, backgroundColor: colors.primary },
  routeList: { marginTop: 14, gap: 9 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 11 },
  routeBody: { flex: 1 },
  routeName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  routeMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  statusPill: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { fontSize: 10, fontWeight: "800" },
  emptyText: { color: colors.muted, fontSize: 13, marginTop: 14 },
  primaryAction: { marginTop: 16, minHeight: 50, borderRadius: radii.inner, backgroundColor: colors.navy, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  primaryActionText: { color: colors.headerText, fontSize: 14, fontWeight: "800" },
  primaryArrow: { color: colors.accent, fontSize: 20 },
  actionList: { marginHorizontal: 20, backgroundColor: colors.card, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  actionRow: { minHeight: 62, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  actionBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  actionIcon: { width: 34, height: 34, borderRadius: 9, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  actionText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "800" },
  actionArrow: { color: colors.faint, fontSize: 24, fontWeight: "400" },
  pressed: { opacity: 0.72 },
  tabletColumns: { flexDirection: "row", alignItems: "flex-start", gap: 22, paddingHorizontal: 24, paddingTop: 20 },
  tabletPrimary: { flex: 1.35, minWidth: 0, gap: 18 },
  tabletSecondary: { flex: 0.8, minWidth: 280 },
  tabletSection: { marginHorizontal: 0, marginTop: 0 },
  tabletSectionHeader: { marginHorizontal: 0, marginTop: 0 },
})
