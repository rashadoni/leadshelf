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
import { routeStatusMeta, type RouteStatusTone } from "../../../src/field/week-status"
import { formatLongDate } from "../../../src/i18n/date-format"
import { t, useLocale } from "../../../src/i18n"
import { useSync } from "../../../src/sync/sync-context"
import { BrandMark } from "../../../src/components/BrandMark"
import { TabIcon, type TabIconName } from "../../../src/components/TabIcon"
import { colors, radii } from "../../../src/theme"

const toneStyles: Record<RouteStatusTone, { bg: string; border: string; text: string }> = {
  draft: { bg: colors.draftBg, border: colors.draftBorder, text: colors.draft },
  planned: { bg: colors.infoBg, border: colors.infoBorder, text: colors.info },
  inProgress: { bg: colors.warningBg, border: "#F6D788", text: colors.warning },
  completed: { bg: colors.successBg, border: colors.successBorder, text: colors.successDark },
  cancelled: { bg: colors.draftBg, border: colors.draftBorder, text: colors.draft },
  missed: { bg: colors.missedBg, border: colors.missedBorder, text: colors.missed },
}

export default function TodayTab() {
  const locale = useLocale()
  const field = useField()
  const shelf = useSync()
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
  const metrics = [
    { value: String(summary?.visits ?? localVisits), label: t("statVisitsToday") },
    { value: String(summary?.tasksCompleted ?? 0), label: t("statDoneTasks") },
    { value: String(localOpenTasks), label: t("statOpenTasks") },
    { value: String(shelf.status.pendingOps + shelf.status.pendingPhotos), label: t("statPendingSync") },
  ]

  const actions: Array<[string, string, TabIconName]> = [
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
            <Text style={styles.brandName}>LeadShelf</Text>
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
              {field.lastUpdatedAt ? <Text style={styles.noticeMeta}>{new Date(field.lastUpdatedAt).toLocaleTimeString()}</Text> : null}
            </View>
            <Pressable onPress={() => void field.refresh()} style={styles.noticeAction}>
              <Text style={styles.noticeActionText}>{t("refresh")}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.overview}>
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

        <View style={styles.card}>
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
          <Pressable onPress={() => router.push("/(app)/(tabs)/week" as never)} style={styles.primaryAction}>
            <Text style={styles.primaryActionText}>{t("openRoute")}</Text>
            <Text style={styles.primaryArrow}>→</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("quickActions")}</Text>
        </View>
        <View style={styles.actionList}>
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
})
