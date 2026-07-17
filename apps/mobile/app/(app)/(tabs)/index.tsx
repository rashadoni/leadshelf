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
import { colors, cardShadow, radii } from "../../../src/theme"

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

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.headerText} />}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{t("tabToday").toUpperCase()}</Text>
          <Text style={styles.heroTitle}>{field.profile?.agent.name ?? t("appName")}</Text>
          <Text style={styles.heroDate}>{formatLongDate(new Date(), locale)}</Text>
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

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("todayOverview")}</Text>
        </View>
        <View style={styles.metrics}>
          {metrics.map((metric) => (
            <View key={metric.label} style={styles.metricCard}>
              <Text style={styles.metricValue}>{metric.value}</Text>
              <Text style={styles.metricLabel}>{metric.label}</Text>
            </View>
          ))}
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
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("quickActions")}</Text>
        </View>
        <View style={styles.quickGrid}>
          {[
            [t("tabRoute"), "/(app)/routes", colors.infoBg, colors.info],
            [t("tabTasks"), "/(app)/(tabs)/tasks", colors.warningBg, colors.warning],
            [t("tabOrders"), "/(app)/(tabs)/orders", colors.successBg, colors.successDark],
            [t("tabPlanograms"), "/(app)/(tabs)/planograms", colors.holidayBg, colors.holiday],
          ].map(([label, href, backgroundColor, color]) => (
            <Pressable
              key={label}
              onPress={() => router.push(href as never)}
              style={({ pressed }) => [styles.quickCard, { backgroundColor }, pressed && styles.pressed]}
            >
              <Text style={[styles.quickText, { color }]}>{label}</Text>
              <Text style={[styles.quickArrow, { color }]}>→</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  scroll: { minHeight: "100%", backgroundColor: colors.bg, paddingBottom: 28 },
  hero: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 28, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  eyebrow: { color: colors.headerSubtext, fontSize: 11, fontWeight: "800", letterSpacing: 1.1 },
  heroTitle: { color: colors.headerText, fontSize: 28, fontWeight: "900", marginTop: 5, letterSpacing: -0.6 },
  heroDate: { color: colors.headerSubtext, fontSize: 14, marginTop: 4 },
  notice: { marginHorizontal: 14, marginTop: 14, padding: 12, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningBg, flexDirection: "row", alignItems: "center", gap: 10 },
  noticeError: { borderColor: colors.missedBorder, backgroundColor: colors.missedBg },
  noticeBody: { flex: 1 },
  noticeTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  noticeMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  noticeAction: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.card },
  noticeActionText: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  sectionHeader: { marginHorizontal: 16, marginTop: 22, marginBottom: 9 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "900", letterSpacing: -0.2 },
  metrics: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: 10 },
  metricCard: { width: "46%", marginHorizontal: "2%", marginBottom: 10, backgroundColor: colors.card, padding: 15, borderRadius: radii.card, ...cardShadow },
  metricValue: { color: colors.text, fontSize: 25, fontWeight: "900" },
  metricLabel: { color: colors.muted, fontSize: 12, marginTop: 3 },
  card: { marginHorizontal: 14, backgroundColor: colors.card, borderRadius: radii.card, padding: 16, ...cardShadow },
  progressHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  cardMeta: { color: colors.muted, fontSize: 12, marginTop: 3 },
  progressValue: { color: colors.primary, fontSize: 22, fontWeight: "900" },
  progressTrack: { height: 8, borderRadius: radii.pill, backgroundColor: colors.skeleton, overflow: "hidden", marginTop: 13 },
  progressFill: { height: "100%", borderRadius: radii.pill, backgroundColor: colors.primary },
  routeList: { marginTop: 14, gap: 9 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 11 },
  routeBody: { flex: 1 },
  routeName: { color: colors.text, fontSize: 14, fontWeight: "800" },
  routeMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  statusPill: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { fontSize: 10, fontWeight: "800" },
  emptyText: { color: colors.muted, fontSize: 13, marginTop: 14 },
  primaryAction: { marginTop: 15, minHeight: 48, borderRadius: radii.inner, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  primaryActionText: { color: colors.headerText, fontSize: 14, fontWeight: "800" },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: 10 },
  quickCard: { width: "46%", minHeight: 84, marginHorizontal: "2%", marginBottom: 10, borderRadius: radii.card, padding: 15, justifyContent: "space-between" },
  quickText: { fontSize: 14, fontWeight: "900" },
  quickArrow: { alignSelf: "flex-end", fontSize: 20, fontWeight: "500" },
  pressed: { opacity: 0.72 },
})
