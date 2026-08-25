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
import type { FieldWorkdayStatus } from "../../../src/field/contracts"
import { resolveFieldTodayPrimaryAction } from "../../../src/field/today-primary-action"
import { formatLongCalendarDate, formatLongDate, formatTime } from "../../../src/i18n/date-format"
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
  const tenantToday = today?.date ?? field.week?.today ?? field.workday?.today ?? null
  const shelfRunning = !["idle", "offline", "error", "authLost", "upgradeRequired"].includes(shelf.status.phase)
  const refreshing = field.phase === "refreshing" || shelfRunning
  const todaySyncStatus =
    field.phase === "error"
      ? { label: t("fieldDataError"), color: colors.danger }
      : field.phase === "stale"
        ? { label: t("fieldDataStale"), color: colors.warning }
        : shelf.status.phase === "authLost"
          ? { label: t("sessionRevoked"), color: colors.danger }
          : shelf.status.phase === "offline"
            ? { label: t("syncOffline"), color: colors.warning }
            : shelf.status.phase === "upgradeRequired"
              ? { label: t("upgradeTitle"), color: colors.warning }
              : shelf.status.phase === "error"
                ? {
                    label: shelf.status.pendingOps + shelf.status.pendingPhotos > 0
                      ? t("syncWriteError")
                      : t("syncReadError"),
                    color: colors.warning,
                  }
                : field.phase === "loading" || field.phase === "refreshing" || shelfRunning
                  ? { label: t("syncRunning"), color: colors.headerSubtext }
                  : shelf.status.pendingOps + shelf.status.pendingPhotos > 0
                    ? { label: t("syncWriteError"), color: colors.warning }
                    : shelf.status.rejectedOps > 0
                      ? { label: t("syncNeedsAttention"), color: colors.danger }
                      : shelf.status.conflictOps > 0 || shelf.status.quarantinedPhotos > 0
                        ? { label: t("syncNeedsAttention"), color: colors.warning }
                        : { label: t("syncIdle"), color: colors.accent }

  async function onRefresh() {
    await Promise.all([field.refresh(), shelf.sync()])
    reloadLocal()
  }

  const routePoints = summary?.routePoints ?? today?.routes.reduce((sum, route) => sum + route.totalPoints, 0) ?? 0
  const visitedPoints = summary?.routeVisited ?? today?.routes.reduce((sum, route) => sum + route.visitedPoints, 0) ?? 0
  const progress = routePoints > 0 ? Math.min(100, Math.round((visitedPoints / routePoints) * 100)) : 0
  const activeVisit = field.week?.days.flatMap((day) => day.visits.items).find((visit) => visit.status === "CHECKED_IN") ?? null
  const workdayStatus: DisplayWorkdayStatus = field.workday?.workday?.status ?? "NOT_STARTED"
  const primaryAction = resolveFieldTodayPrimaryAction({
    isField: IS_LEADDRIVE_FIELD,
    activeVisit,
    today,
    canCreateOwnDraft: field.week?.capabilities.createOwnDraft === true,
    availableWorkdayActions: field.workday?.availableActions,
  })
  const routeActionLabel = primaryAction.kind === "CONTINUE_VISIT"
    ? t("continueFieldVisit")
    : primaryAction.kind === "START_WORKDAY"
      ? t("workdayStart")
      : primaryAction.kind === "RESUME_WORKDAY"
        ? t("workdayResume")
        : primaryAction.kind === "OPEN_NEXT_ROUTE" && primaryAction.nextStopName
          ? t("routeNextStop") + ": " + primaryAction.nextStopName
          : primaryAction.kind === "CREATE_ROUTE"
            ? t("createRoute")
            : t("weekSchedule")
  const primaryActionIcon: TabIconName = primaryAction.kind === "CONTINUE_VISIT"
    ? "visit"
    : primaryAction.kind === "START_WORKDAY" || primaryAction.kind === "RESUME_WORKDAY"
      ? "today"
      : primaryAction.kind === "OPEN_NEXT_ROUTE"
        ? "route"
        : primaryAction.kind === "CREATE_ROUTE"
          ? "add"
          : "week"
  const primaryActionDestination = primaryAction.kind === "CONTINUE_VISIT"
    ? t("routeCurrentVisit")
    : primaryAction.kind === "START_WORKDAY" || primaryAction.kind === "RESUME_WORKDAY"
      ? t("workdayTitle")
      : primaryAction.kind === "OPEN_NEXT_ROUTE"
        ? t("routeDetails")
        : primaryAction.kind === "CREATE_ROUTE"
          ? t("routeHubTitle")
          : t("weekSchedule")
  const workdayActive = workdayStatus === "STARTED"
  const attendancePresentation = presentFieldAttendancePolicy(field.workday?.attendancePolicy)
  const workdayActionLabel = workdayStatus === "NOT_STARTED"
    ? t("workdayStart")
    : workdayStatus === "PAUSED"
      ? t("workdayResume")
      : t("workdayTitle")
  // The workday surface owns the start/resume decision and policy disclosure.
  // Do not repeat that same action in the route card below: it turns one next
  // step into two visually competing primary buttons.
  const workdayActionIsPrimary = workdayStatus === "NOT_STARTED" || workdayStatus === "PAUSED"
  const routeActionRepeatsWorkday = primaryAction.kind === "START_WORKDAY" || primaryAction.kind === "RESUME_WORKDAY"
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
            <View accessible accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={todaySyncStatus.label} style={styles.liveStatus}>
              <View accessible={false} style={[styles.liveDot, { backgroundColor: todaySyncStatus.color }]} />
              <Text style={styles.liveText}>{todaySyncStatus.label}</Text>
            </View>
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>{t("tabToday").toUpperCase()}</Text>
            <Text style={styles.heroTitle}>{field.profile?.agent.name ?? t("appName")}</Text>
            <Text style={styles.heroDate}>{tenantToday ? formatLongCalendarDate(tenantToday, locale) : formatLongDate(new Date(), locale)}</Text>
          </View>
        </View>

        {field.phase === "stale" || field.phase === "error" ? (
          <View style={[styles.notice, field.phase === "error" && styles.noticeError]}>
            <View accessible accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityLabel={field.lastUpdatedAt ? `${field.phase === "error" ? t("fieldDataError") : t("fieldDataStale")}. ${formatTime(field.lastUpdatedAt)}` : field.phase === "error" ? t("fieldDataError") : t("fieldDataStale")} style={styles.noticeBody}>
              <Text style={styles.noticeTitle}>{field.phase === "error" ? t("fieldDataError") : t("fieldDataStale")}</Text>
              {field.lastUpdatedAt ? <Text style={styles.noticeMeta}>{formatTime(field.lastUpdatedAt)}</Text> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} accessibilityHint={field.phase === "error" ? t("fieldDataError") : t("fieldDataStale")} onPress={() => void field.refresh()} style={styles.noticeAction}>
              <TabIcon name="refresh" color={colors.primary} size={16} />
              <Text style={styles.noticeActionText}>{t("refresh")}</Text>
            </Pressable>
          </View>
        ) : null}

        {IS_LEADDRIVE_FIELD ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t(workdayStatusKeys[workdayStatus])}. ${workdayActionLabel}`}
            accessibilityHint={t(attendancePresentation.hintKey)}
            onPress={() => router.push("/(app)/workday" as never)}
            style={({ pressed }) => [styles.workdayCard, workdayActionIsPrimary && styles.workdayCardPrimary, pressed && styles.pressed]}
          >
            <View accessible={false} style={[styles.workdayIcon, workdayActionIsPrimary && styles.workdayIconPrimary, workdayActive && styles.workdayIconActive]}>
              <TabIcon name="today" color={workdayActionIsPrimary ? colors.headerText : colors.primary} size={22} />
            </View>
            <View style={styles.workdayBody}>
              <Text style={[styles.workdayTitle, workdayActionIsPrimary && styles.workdayTitlePrimary]}>{t(workdayStatusKeys[workdayStatus])}</Text>
              <Text style={[styles.workdayHint, workdayActionIsPrimary && styles.workdayHintPrimary]}>{t(attendancePresentation.hintKey)}</Text>
            </View>
            {workdayStatus === "NOT_STARTED" || workdayStatus === "PAUSED" ? (
              <Text style={[styles.workdayAction, workdayActionIsPrimary && styles.workdayActionPrimary]}>{workdayActionLabel}</Text>
            ) : (
              <View style={styles.workdayChevron}><TabIcon name="chevronRight" color={colors.primary} size={21} /></View>
            )}
          </Pressable>
        ) : null}

        <View style={layout.isTablet ? styles.tabletColumns : undefined}>
          <View style={layout.isTablet ? styles.tabletPrimary : undefined}>
        <View style={[styles.overview, layout.isTablet && styles.tabletSection]}>
          <View accessible accessibilityRole="text" accessibilityLabel={`${t("todayOverview")}: ${visitedPoints}/${routePoints}`} style={styles.overviewHeader}>
            <Text style={styles.sectionEyebrow}>{t("todayOverview").toUpperCase()}</Text>
            <Text style={styles.overviewMeta}>{visitedPoints}/{routePoints}</Text>
          </View>
          <View style={styles.metrics}>
          {metrics.map((metric) => (
            <View key={metric.label} accessible accessibilityRole="text" accessibilityLabel={`${metric.label}: ${metric.value}`} style={styles.metricCard}>
              <Text style={styles.metricValue}>{metric.value}</Text>
              <Text style={styles.metricLabel}>{metric.label}</Text>
            </View>
          ))}
          </View>
        </View>

        <View style={[styles.card, layout.isTablet && styles.tabletSection]}>
          <View accessible accessibilityRole="progressbar" accessibilityLabel={t("routeProgress")} accessibilityValue={{ min: 0, max: 100, now: progress, text: `${visitedPoints}/${routePoints} ${t("routeVisitedLabel")} · ${progress}%` }}>
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
          </View>

          {today?.routes.length ? (
            <View style={styles.routeList}>
              {today.routes.map((route) => {
                const meta = routeStatusMeta(route.effectiveStatus)
                const tone = toneStyles[meta.tone]
                const routeLabel = route.name ?? t("tabRoute")
                const routeStatusLabel = t(meta.labelKey)
                return (
                  <Pressable
                    key={route.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${routeLabel}. ${routeStatusLabel}. ${route.visitedPoints} ${t("routeVisitedLabel")} / ${route.totalPoints} ${t("routePointsLabel")}`}
                    accessibilityHint={t("routeDetails")}
                    onPress={() => router.push(`/(app)/routes/${route.id}` as never)}
                    style={({ pressed }) => [styles.routeRow, pressed && styles.pressed]}
                  >
                    <View style={styles.routeBody}>
                      <Text style={styles.routeName}>{routeLabel}</Text>
                      <Text style={styles.routeMeta}>{route.totalPoints} {t("routePointsLabel")} · {route.visitedPoints} {t("routeVisitedLabel")}</Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                      <Text style={[styles.statusText, { color: tone.text }]}>{routeStatusLabel}</Text>
                    </View>
                    <TabIcon name="chevronRight" color={colors.faint} size={19} />
                  </Pressable>
                )
              })}
            </View>
          ) : (
            <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.emptyText}>{t("noRouteToday")}</Text>
          )}
          {!routeActionRepeatsWorkday ? (
            <Pressable accessibilityRole="button" accessibilityLabel={routeActionLabel} accessibilityHint={primaryActionDestination} onPress={() => router.push(primaryAction.href as never)} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}>
              <View style={styles.primaryActionBody}><TabIcon name={primaryActionIcon} color={colors.headerText} size={19} /><Text style={styles.primaryActionText} numberOfLines={1}>{routeActionLabel}</Text></View>
              <TabIcon name="chevronRight" color={colors.headerText} size={20} />
            </Pressable>
          ) : null}
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
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => router.push(href as never)}
              style={({ pressed }) => [styles.actionRow, index > 0 && styles.actionBorder, pressed && styles.pressed]}
            >
              <View accessible={false} style={styles.actionIcon}><TabIcon name={icon} color={colors.primary} size={20} /></View>
              <Text style={styles.actionText}>{label}</Text>
              <TabIcon name="chevronRight" color={colors.faint} size={20} />
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
  liveStatus: { minWidth: 0, marginLeft: "auto", flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  liveText: { flexShrink: 1, color: colors.headerSubtext, fontSize: 10, fontWeight: "700", textAlign: "right" },
  heroCopy: { marginTop: 32 },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  heroTitle: { color: colors.headerText, fontSize: 29, fontWeight: "900", marginTop: 7, letterSpacing: -0.8 },
  heroDate: { color: colors.headerSubtext, fontSize: 13, marginTop: 6 },
  notice: { marginHorizontal: 20, marginTop: 16, padding: 12, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningBg, flexDirection: "row", alignItems: "center", gap: 10 },
  noticeError: { borderColor: colors.missedBorder, backgroundColor: colors.missedBg },
  noticeBody: { flex: 1 },
  noticeTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  noticeMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  noticeAction: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  noticeActionText: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  workdayCard: { marginHorizontal: 20, marginTop: 16, minHeight: 68, borderRadius: radii.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  workdayCardPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  workdayIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.draftBg, alignItems: "center", justifyContent: "center" },
  workdayIconPrimary: { backgroundColor: "rgba(255,255,255,0.16)" },
  workdayIconActive: { backgroundColor: colors.successBg },
  workdayBody: { flex: 1, minWidth: 0 },
  workdayTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  workdayTitlePrimary: { color: colors.headerText },
  workdayHint: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  workdayHintPrimary: { color: "rgba(255,255,255,0.76)" },
  workdayAction: { maxWidth: 92, color: colors.primary, fontSize: 11, fontWeight: "900", textAlign: "right" },
  workdayActionPrimary: { color: colors.headerText },
  workdayChevron: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
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
  routeRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 11 },
  routeBody: { flex: 1 },
  routeName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  routeMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  statusPill: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { fontSize: 10, fontWeight: "800" },
  emptyText: { color: colors.muted, fontSize: 13, marginTop: 14 },
  primaryAction: { marginTop: 16, minHeight: 50, borderRadius: radii.inner, backgroundColor: colors.primary, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  primaryActionBody: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9 },
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
