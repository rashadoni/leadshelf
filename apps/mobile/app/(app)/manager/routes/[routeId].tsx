import { useCallback, useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../../src/api/mobile-client"
import { TabIcon } from "../../../../src/components/TabIcon"
import type { FieldManagerRouteDetail, FieldManagerRouteDetailPoint } from "../../../../src/field/contracts"
import { routeStatusMeta, type RouteStatusTone } from "../../../../src/field/week-status"
import { t, useLocale } from "../../../../src/i18n"
import { formatCalendarDay, formatTime } from "../../../../src/i18n/date-format"
import { HttpError } from "../../../../src/sync/ports-error"
import { cardShadow, colors, radii } from "../../../../src/theme"

const knownRouteStatus = new Set(["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "MISSED"])

const routeTones: Record<RouteStatusTone, { background: string; foreground: string }> = {
  draft: { background: colors.draftBg, foreground: colors.draft },
  planned: { background: colors.infoBg, foreground: colors.info },
  inProgress: { background: colors.warningBg, foreground: colors.warning },
  completed: { background: colors.successBg, foreground: colors.successDark },
  cancelled: { background: colors.draftBg, foreground: colors.draft },
  missed: { background: colors.missedBg, foreground: colors.missed },
}

function routeStatus(route: FieldManagerRouteDetail): { label: string; background: string; foreground: string } {
  if (!knownRouteStatus.has(route.status)) {
    return { label: t("managerRouteStateUnknown"), background: colors.draftBg, foreground: colors.draft }
  }
  const meta = routeStatusMeta(route.status as "DRAFT" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "MISSED")
  return { label: t(meta.labelKey), ...routeTones[meta.tone] }
}

function pointStatus(point: FieldManagerRouteDetailPoint): { label: string; background: string; foreground: string } {
  if (point.status === "VISITED") return { label: t("routeCompletedStop"), background: colors.successBg, foreground: colors.successDark }
  if (point.status === "SKIPPED") return { label: t("routeMissedStop"), background: colors.missedBg, foreground: colors.missed }
  return { label: t("routeUpcomingStop"), background: colors.infoBg, foreground: colors.info }
}

function pointSubtitle(point: FieldManagerRouteDetailPoint): string | null {
  return [
    point.contact?.specialtyName ?? null,
    point.customer.address ?? point.customer.city,
  ].filter((value): value is string => Boolean(value)).join(" · ") || null
}

function routeDateKey(route: FieldManagerRouteDetail): string | null {
  const date = route.date.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

export default function ManagerRouteDetailScreen() {
  const locale = useLocale()
  const { routeId } = useLocalSearchParams<{ routeId?: string }>()
  const id = typeof routeId === "string" && routeId.length > 0 ? routeId : null
  const [route, setRoute] = useState<FieldManagerRouteDetail | null>(null)
  const [timezone, setTimezone] = useState("UTC")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    if (!id) {
      setRoute(null)
      setError(new Error("manager route id missing"))
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const next = await fieldApi.managerRouteDetail(id)
      setRoute(next.route)
      setTimezone(next.timezone)
    } catch (reason) {
      setError(reason)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const denied = error instanceof HttpError && error.status === 403
  const calendar = useMemo(() => {
    const date = route ? routeDateKey(route) : null
    return date ? formatCalendarDay(date, locale) : null
  }, [locale, route])
  const status = route ? routeStatus(route) : null

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.back}><TabIcon name="chevronLeft" color={colors.text} size={23} /></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("managerHomeTitle").toUpperCase()}</Text>
            <Text style={styles.title}>{t("managerRouteDetailTitle")}</Text>
            <Text style={styles.subtitle}>{t("managerRouteDetailHint")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} disabled={loading} onPress={() => void load()} style={styles.refresh}><TabIcon name="refresh" color={colors.primary} size={22} /></Pressable>
        </View>

        {loading && !route ? <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>{t("managerLoading")}</Text></View> : null}
        {error && !route ? (
          <View style={[styles.state, denied && styles.stateWarning]}>
            <View style={styles.stateIcon}><TabIcon name="route" color={denied ? colors.warning : colors.primary} size={25} /></View>
            <Text style={styles.stateTitle}>{denied ? t("managerAccessDeniedTitle") : t("managerRouteDetailUnavailable")}</Text>
            <Text style={styles.stateText}>{denied ? t("managerAccessDeniedBody") : t("managerRetry")}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>{t("managerRetry")}</Text></Pressable>
          </View>
        ) : null}

        {route && status && calendar ? (
          <>
            {error ? <View style={styles.notice}><Text style={styles.noticeText}>{t("managerRouteDetailStale")}</Text></View> : null}
            <View style={styles.routeHero}>
              <View style={styles.routeHeroTop}>
                <View style={styles.routeIcon}><TabIcon name="route" color={colors.headerText} size={23} /></View>
                <View style={styles.routeBody}>
                  <Text style={styles.routeName}>{route.name ?? t("tabRoute")}</Text>
                  <Text style={styles.routeAgent}>{route.agent.name}</Text>
                </View>
                <View style={[styles.status, { backgroundColor: status.background }]}><Text style={[styles.statusText, { color: status.foreground }]}>{status.label}</Text></View>
              </View>
              <View style={styles.routeDate}><TabIcon name="week" color={colors.headerSubtext} size={15} /><Text style={styles.routeDateText}>{calendar.weekday}, {calendar.date}</Text></View>
            </View>

            <View style={styles.progressCard}>
              <View style={styles.progressStat}><Text style={styles.progressValue}>{route.totalPoints}</Text><Text style={styles.progressLabel}>{t("managerRouteDetailPlannedStops")}</Text></View>
              <View style={styles.progressDivider} />
              <View style={styles.progressStat}><Text style={[styles.progressValue, { color: colors.successDark }]}>{route.visitedPoints}</Text><Text style={styles.progressLabel}>{t("managerRouteDetailVisitedStops")}</Text></View>
            </View>

            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>{t("managerRouteDetailStops")}</Text>
              <Text style={styles.sectionCount}>{route.points.length}</Text>
            </View>
            {route.points.length === 0 ? (
              <View style={styles.empty}><TabIcon name="route" color={colors.primary} size={25} /><Text style={styles.emptyText}>{t("managerRouteDetailNoStops")}</Text></View>
            ) : (
              <View style={styles.pointList}>
                {route.points.map((point) => {
                  const pointState = pointStatus(point)
                  const subtitle = pointSubtitle(point)
                  return (
                    <View key={point.id} style={styles.pointCard}>
                      <View style={[styles.pointNumber, { backgroundColor: pointState.background }]}><Text style={[styles.pointNumberText, { color: pointState.foreground }]}>{point.orderIndex + 1}</Text></View>
                      <View style={styles.pointBody}>
                        <Text style={styles.pointName}>{point.contact ? point.contact.displayName + " · " + point.customer.name : point.customer.name}</Text>
                        {subtitle ? <Text style={styles.pointSubtitle}>{subtitle}</Text> : null}
                        <View style={styles.pointMeta}>
                          <View style={[styles.pointStatus, { backgroundColor: pointState.background }]}><Text style={[styles.pointStatusText, { color: pointState.foreground }]}>{pointState.label}</Text></View>
                          {point.plannedTime ? <Text style={styles.pointTime}>{t("managerRouteDetailTime", { time: formatTime(point.plannedTime, timezone) })}</Text> : null}
                        </View>
                      </View>
                    </View>
                  )
                })}
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
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.9 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  refresh: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  routeHero: { marginHorizontal: 14, marginTop: 16, padding: 15, borderRadius: radii.card, backgroundColor: colors.navy, ...cardShadow },
  routeHeroTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  routeIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  routeBody: { flex: 1, minWidth: 0 },
  routeName: { color: colors.headerText, fontSize: 15, fontWeight: "900" },
  routeAgent: { color: colors.headerSubtext, fontSize: 10, fontWeight: "800", marginTop: 3 },
  status: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 6 },
  statusText: { fontSize: 8, fontWeight: "900" },
  routeDate: { marginTop: 14, flexDirection: "row", alignItems: "center", gap: 6 },
  routeDateText: { color: colors.headerSubtext, fontSize: 10, fontWeight: "800" },
  progressCard: { minHeight: 88, marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, backgroundColor: colors.card, padding: 13, flexDirection: "row", alignItems: "center", ...cardShadow },
  progressStat: { flex: 1, alignItems: "center" },
  progressValue: { color: colors.text, fontSize: 23, lineHeight: 27, fontWeight: "900" },
  progressLabel: { color: colors.muted, fontSize: 9, lineHeight: 12, textAlign: "center", fontWeight: "800", marginTop: 2 },
  progressDivider: { width: StyleSheet.hairlineWidth, alignSelf: "stretch", backgroundColor: colors.border },
  sectionHeading: { marginHorizontal: 16, marginTop: 22, marginBottom: 7, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  sectionCount: { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: colors.primarySoft, color: colors.primary, fontSize: 11, lineHeight: 26, textAlign: "center", fontWeight: "900" },
  pointList: { paddingTop: 1 },
  pointCard: { minHeight: 78, marginHorizontal: 14, marginTop: 9, borderRadius: radii.card, backgroundColor: colors.card, padding: 13, flexDirection: "row", gap: 11, ...cardShadow },
  pointNumber: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  pointNumberText: { fontSize: 12, fontWeight: "900" },
  pointBody: { flex: 1, minWidth: 0 },
  pointName: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  pointSubtitle: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 3, fontWeight: "800" },
  pointMeta: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  pointStatus: { borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 5 },
  pointStatusText: { fontSize: 8, fontWeight: "900" },
  pointTime: { color: colors.muted, fontSize: 9, fontWeight: "800" },
  empty: { minHeight: 112, marginHorizontal: 14, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", gap: 9, paddingHorizontal: 18, ...cardShadow },
  emptyText: { color: colors.muted, fontSize: 11, fontWeight: "800", textAlign: "center" },
  state: { minHeight: 230, margin: 14, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", padding: 24, ...cardShadow },
  stateWarning: { backgroundColor: colors.warningBg, borderWidth: 1, borderColor: "#F6D788" },
  stateIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  stateTitle: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "center" },
  stateText: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 7 },
  retry: { minHeight: 44, marginTop: 16, borderRadius: 13, paddingHorizontal: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  retryText: { color: colors.headerText, fontSize: 11, fontWeight: "900" },
  notice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: "#F6D788", padding: 11 },
  noticeText: { color: colors.warning, fontSize: 10, lineHeight: 15, fontWeight: "800" },
})
