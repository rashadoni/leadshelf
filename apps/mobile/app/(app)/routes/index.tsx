import { useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { useField } from "../../../src/field/field-context"
import { routeStatusMeta, type RouteStatusTone } from "../../../src/field/week-status"
import { t, type Locale, useLocale } from "../../../src/i18n"
import { formatCalendarDay, formatCalendarMonthShort } from "../../../src/i18n/date-format"
import { colors, cardShadow, radii } from "../../../src/theme"
import { useSync } from "../../../src/sync/sync-context"
import { IS_LEADDRIVE_FIELD } from "../../../src/config/mobile-variant"
import { TabIcon } from "../../../src/components/TabIcon"
import { FieldScreenChrome } from "../../../src/components/FieldScreenChrome"
import { safeFieldBack } from "../../../src/navigation/safe-back"
import { resolveFieldRouteFlow } from "../../../src/field/route-flow"
import type { FieldWeekDay, FieldWeekVisit } from "../../../src/field/contracts"
import { useResponsiveLayout } from "../../../src/layout/responsive"

type RouteHubItem = FieldWeekDay["routes"][number] & { day: FieldWeekDay }

export default function RoutesScreen() {
  const locale = useLocale()
  const field = useField()
  const layout = useResponsiveLayout()
  const { status: syncStatus } = useSync()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [upcomingOpen, setUpcomingOpen] = useState(false)
  const routes = useMemo<RouteHubItem[]>(() => field.week?.days.flatMap((day) => day.routes.map((route) => ({ ...route, day }))) ?? [], [field.week])
  const activeVisit = useMemo<FieldWeekVisit | null>(() => (
    field.week?.days.flatMap((day) => day.visits.items).find((visit) => visit.status === "CHECKED_IN") ?? null
  ), [field.week])
  const canCreateRoute = field.week?.capabilities.createOwnDraft === true
  const calendarDate = field.operationalDate ?? field.week?.today
  const routeCreateHref = calendarDate
    ? `/(app)/routes/new?date=${encodeURIComponent(calendarDate)}`
    : "/(app)/routes/new"
  const nowRoutes = routes.filter((route) => route.effectiveStatus === "IN_PROGRESS")
  const groupedRouteIds = new Set(nowRoutes.map((route) => route.id))
  const todayRoutes = routes.filter((route) => route.day.date === field.week?.today && !groupedRouteIds.has(route.id))
  todayRoutes.forEach((route) => groupedRouteIds.add(route.id))
  const upcomingRoutes = routes.filter((route) => route.day.date > (field.week?.today ?? "") && !groupedRouteIds.has(route.id))
  upcomingRoutes.forEach((route) => groupedRouteIds.add(route.id))
  const historyRoutes = routes.filter((route) => !groupedRouteIds.has(route.id))
  useEffect(() => {
    if (syncStatus.lastSyncAt && syncStatus.pendingOps === 0) void field.refresh()
  // Refresh the CRM cache once after a completed outbox cycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus.lastSyncAt, syncStatus.pendingOps])
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <FieldScreenChrome />
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={field.phase === "refreshing"} onRefresh={() => void field.refresh()} />}>
        <View style={[styles.content, layout.isTablet && styles.contentTablet]}>
        <View style={styles.headerModern}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => safeFieldBack("/(app)/(tabs)/work")} style={styles.backModern}><TabIcon name="chevronLeft" color={colors.text} size={23} /></Pressable>
          <View style={styles.headerBodyModern}><Text style={styles.eyebrowModern}>{t("tabWork").toUpperCase()}</Text><Text style={styles.titleModern}>{t("routeHubTitle")}</Text><Text style={styles.subtitleModern}>{t("routeHubHint")}</Text></View>
          {canCreateRoute && routes.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={t("createRoute")} accessibilityHint={t("chooseStop")} onPress={() => router.push(routeCreateHref as never)} style={styles.headerCreateModern}><TabIcon name="add" color={colors.primary} size={18} /><Text style={styles.headerCreateTextModern}>{t("createRoute")}</Text></Pressable> : null}
        </View>

        {!canCreateRoute && field.week ? (
          <View style={styles.planningUnavailable} accessibilityRole="alert"><Text style={styles.planningUnavailableText}>{t("routePlanningUnavailable")}</Text></View>
        ) : null}

        {(field.phase === "stale" || field.phase === "error") ? (
          <View style={styles.dataNotice} accessibilityRole="alert">
            <View style={styles.dataNoticeBody}>
              <View style={styles.dataNoticeIcon}><TabIcon name="alert" color={colors.warning} size={19} /></View>
              <Text style={styles.dataNoticeText}>{t(field.error ?? "fieldDataError")}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} onPress={() => void field.refresh()} style={styles.retry}>
              <TabIcon name="refresh" color={colors.warning} size={20} />
            </Pressable>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("routeCalendarTitle")}
          accessibilityHint={t("routeCalendarHint")}
          onPress={() => router.push((calendarDate
            ? `/(app)/(tabs)/week?date=${encodeURIComponent(calendarDate)}`
            : "/(app)/(tabs)/week") as never)}
          style={({ pressed }) => [styles.calendarLinkModern, pressed && styles.pressed]}
        >
          <View style={styles.calendarLinkIconModern}><TabIcon name="week" color={colors.primary} size={22} /></View>
          <View style={styles.calendarLinkBodyModern}>
            <Text style={styles.calendarLinkTitleModern}>{t("routeCalendarTitle")}</Text>
            <Text style={styles.calendarLinkHintModern}>{t("routeCalendarHint")}</Text>
          </View>
          <TabIcon name="chevronRight" color={colors.primary} size={21} />
        </Pressable>

        {routes.length ? <>
          {nowRoutes.length ? <RouteGroup title={t("routeNow")} routes={nowRoutes} locale={locale} activeVisit={activeVisit} featured /> : null}
          {todayRoutes.length ? <RouteGroup title={t("todayWord")} routes={todayRoutes} locale={locale} activeVisit={activeVisit} featured={!nowRoutes.length} /> : null}
          {upcomingRoutes.length ? <RouteGroup title={t("routeUpcomingRoutes")} routes={upcomingRoutes} locale={locale} activeVisit={activeVisit} collapsible={upcomingRoutes.length > 2} expanded={upcomingOpen} onToggle={() => setUpcomingOpen((open) => !open)} /> : null}
          {historyRoutes.length ? <RouteGroup title={t("routeHistory")} routes={historyRoutes} locale={locale} activeVisit={activeVisit} collapsible expanded={historyOpen} onToggle={() => setHistoryOpen((open) => !open)} /> : null}
        </> : canCreateRoute ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("createRoute")}
            accessibilityHint={t("chooseStop")}
            onPress={() => router.push(routeCreateHref as never)}
            style={({ pressed }) => [styles.empty, styles.emptyAction, pressed && styles.pressed]}
          >
            <View accessible={false} style={styles.emptyIcon}><TabIcon name="route" color={colors.primary} size={25} /></View>
            <Text style={styles.emptyText}>{t("fieldRoutesEmpty")}</Text>
            <View style={styles.emptyActionRow}><Text style={styles.emptyActionText}>{t("createRoute")}</Text><TabIcon name="chevronRight" color={colors.primary} size={18} /></View>
          </Pressable>
        ) : <View accessible accessibilityRole="summary" accessibilityLabel={t("fieldRoutesEmpty")} style={styles.empty}><View accessible={false} style={styles.emptyIcon}><TabIcon name="route" color={colors.primary} size={25} /></View><Text style={styles.emptyText}>{t("fieldRoutesEmpty")}</Text></View>}

        {!IS_LEADDRIVE_FIELD ? (
          <>
            <Text style={styles.sectionTitle}>{t("shelfConnection")}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t("commercialRoute")} accessibilityHint={t("commercialRouteHint")} onPress={() => router.push("/(app)/routes/commercial" as never)} style={({ pressed }) => [styles.commercialCard, pressed && styles.pressed]}>
              <View style={styles.commercialMark}><TabIcon name="shelves" color={colors.holiday} size={22} /></View>
              <View style={styles.createBody}><Text style={styles.createTitle}>{t("commercialRoute")}</Text><Text style={styles.createHint}>{t("commercialRouteHint")}</Text></View>
              <TabIcon name="chevronRight" color={colors.faint} size={21} />
            </Pressable>
          </>
        ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function RouteGroup({ title, routes, locale, activeVisit, featured = false, collapsible = false, expanded = true, onToggle }: {
  title: string
  routes: readonly RouteHubItem[]
  locale: Locale
  activeVisit: FieldWeekVisit | null
  featured?: boolean
  collapsible?: boolean
  expanded?: boolean
  onToggle?: () => void
}) {
  const layout = useResponsiveLayout()
  const visible = !collapsible || expanded
  return <View style={styles.routeGroupModern}>
    {collapsible ? <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? t("routeHideRoutes") : t("routeShowRoutes")}: ${title}`} accessibilityState={{ expanded }} onPress={onToggle} style={({ pressed }) => [styles.routeGroupToggleModern, pressed && styles.pressed]}>
      <View style={styles.routeGroupLabelModern}><Text numberOfLines={1} style={styles.routeGroupTitleModern}>{title}</Text><View accessible={false} style={styles.routeGroupCountModern}><Text style={styles.routeGroupCountTextModern}>{routes.length}</Text></View></View>
      <View accessible={false} style={styles.routeGroupToggleActionModern}><TabIcon name={expanded ? "chevronUp" : "chevronDown"} color={colors.primary} size={20} /></View>
    </Pressable> : <View style={styles.routeGroupHeadingModern}><Text style={styles.routeGroupTitleModern}>{title}</Text><View accessible={false} style={styles.routeGroupCountModern}><Text style={styles.routeGroupCountTextModern}>{routes.length}</Text></View></View>}
    {visible ? <View style={[styles.routeGridModern, layout.isTablet && styles.routeGridTablet]}>{routes.map((route, index) => <View key={route.id} style={layout.isTablet ? styles.routeCardSlotTablet : undefined}><RouteCard route={route} locale={locale} activeVisit={activeVisit} featured={featured && index === 0} tablet={layout.isTablet} /></View>)}</View> : null}
  </View>
}

function RouteCard({ route, locale, activeVisit, featured, tablet }: { route: RouteHubItem; locale: Locale; activeVisit: FieldWeekVisit | null; featured: boolean; tablet: boolean }) {
  const field = useField()
  const meta = routeStatusMeta(route.effectiveStatus)
  const tone = tones[meta.tone]
  const calendarDay = formatCalendarDay(route.day.date, locale)
  const routeName = route.name ?? t("tabRoute")
  const progressText = `${route.visitedPoints}/${route.totalPoints} ${t("routeVisitedLabel")}`
  const nextPoint = resolveFieldRouteFlow(route, activeVisit).primaryPoint
  const nextStopName = nextPoint?.contact?.displayName ?? nextPoint?.customer.name
  const nextStopMeta = nextPoint?.customer.address ?? nextPoint?.customer.city ?? null
  const syncText = route.syncState === "PENDING" ? t("queued") : route.syncState ? t("syncNeedsAttention") : null
  const routeLabel = [
    routeName,
    progressText,
    nextStopName ? `${t("routeNextStop")}: ${nextStopName}` : null,
    t(meta.labelKey),
    syncText,
  ].filter(Boolean).join(". ")
  const progress = route.totalPoints > 0 ? Math.min(100, Math.round((route.visitedPoints / route.totalPoints) * 100)) : 0
  return <Pressable accessibilityRole="button" accessibilityLabel={routeLabel} accessibilityHint={t("openRoute")} accessibilityState={{ busy: route.syncState === "PENDING" }} onPress={() => { field.setOperationalDate(route.day.date); router.push(`/(app)/routes/${route.id}` as never) }} style={({ pressed }) => [styles.routeCardModern, tablet && styles.routeCardTablet, featured && styles.routeCardFeaturedModern, pressed && styles.pressed]}>
    <View style={styles.routeTopModern}>
      <View style={styles.dateBadgeModern}>
        <Text style={styles.dateDayModern}>{calendarDay.day || route.day.date.slice(8)}</Text>
        <Text style={styles.dateMonthModern}>{formatCalendarMonthShort(route.day.date, locale) || route.day.date.slice(5, 7)}</Text>
      </View>
      <View style={styles.routeHeadingModern}>
        <Text style={styles.routeNameModern} numberOfLines={1}>{routeName}</Text>
        <Text style={styles.routeDateModern} numberOfLines={1}>{calendarDay.weekday}, {calendarDay.date}</Text>
      </View>
      <View style={styles.routeStateModern}>
        {syncText ? <Text style={styles.syncStateModern} numberOfLines={1}>{syncText}</Text> : null}
        <View style={[styles.statusModern, { backgroundColor: tone.background }]}><Text style={[styles.statusTextModern, { color: tone.foreground }]}>{t(meta.labelKey)}</Text></View>
      </View>
    </View>
    <View style={styles.progressSectionModern}>
      <View style={styles.progressHeaderModern}>
        <Text style={styles.routeMetaModern}>{progressText}</Text>
        <Text style={styles.progressPercentModern}>{progress}%</Text>
      </View>
      <View style={styles.progressTrackModern}><View style={[styles.progressFillModern, { width: `${progress}%` }]} /></View>
    </View>
    {nextStopName ? <View style={styles.nextStopSurfaceModern}>
      <View style={styles.nextStopIconModern}><TabIcon name="location" color={colors.primary} size={20} /></View>
      <View style={styles.nextStopBodyModern}>
        <Text style={styles.nextStopLabelModern}>{t("routeNextStop")}</Text>
        <Text style={styles.nextStopModern} numberOfLines={1}>{nextStopName}</Text>
        {nextStopMeta ? <Text style={styles.nextStopMetaModern} numberOfLines={1}>{nextStopMeta}</Text> : null}
      </View>
      <TabIcon name="chevronRight" color={colors.primary} size={21} />
    </View> : null}
    <View style={styles.openRouteModern}><Text style={styles.openRouteTextModern}>{t("openRoute")}</Text><TabIcon name="chevronRight" color={colors.primary} size={18} /></View>
  </Pressable>
}

const tones: Record<RouteStatusTone, { background: string; foreground: string }> = {
  draft: { background: colors.draftBg, foreground: colors.draft }, planned: { background: colors.infoBg, foreground: colors.info }, inProgress: { background: colors.warningBg, foreground: colors.warning }, completed: { background: colors.successBg, foreground: colors.successDark }, cancelled: { background: colors.draftBg, foreground: colors.draft }, missed: { background: colors.missedBg, foreground: colors.missed },
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { minHeight: "100%", paddingBottom: 30 }, header: { paddingHorizontal: 16, paddingTop: 8, flexDirection: "row", alignItems: "center", gap: 10 }, back: { width: 44, height: 44, borderRadius: radii.pill, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }, backText: { color: colors.text, fontSize: 30, lineHeight: 31 }, headerBody: { flex: 1, minWidth: 0 }, eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 }, title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2, letterSpacing: -0.4 }, subtitle: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 }, headerCreate: { minHeight: 40, borderRadius: radii.pill, backgroundColor: colors.primarySoft, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 5 }, headerCreateText: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  content: { width: "100%" }, contentTablet: { maxWidth: 1_060, alignSelf: "center" },
  createBody: { flex: 1 }, createTitle: { color: colors.text, fontSize: 14, fontWeight: "900" }, createHint: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  dataNotice: { marginHorizontal: 14, marginTop: 12, minHeight: 58, borderRadius: radii.inner, padding: 9, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.warningBorder }, dataNoticeBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }, dataNoticeIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card }, dataNoticeText: { flex: 1, color: colors.warning, fontSize: 10, lineHeight: 14, fontWeight: "800" }, retry: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.card },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900", marginHorizontal: 16, marginTop: 22, marginBottom: 3 }, routeCard: { marginHorizontal: 14, marginTop: 9, minHeight: 96, borderRadius: radii.card, padding: 12, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 10, ...cardShadow }, dateBadge: { width: 43, height: 52, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, dateDay: { color: colors.primary, fontSize: 17, fontWeight: "900" }, dateMonth: { color: colors.primary, fontSize: 8, fontWeight: "800" }, routeBody: { flex: 1, minWidth: 0 }, routeName: { color: colors.text, fontSize: 13, fontWeight: "900" }, routeMeta: { color: colors.muted, fontSize: 9, marginTop: 3 }, progressTrack: { height: 4, borderRadius: 999, overflow: "hidden", backgroundColor: colors.primarySoft, marginTop: 6 }, progressFill: { height: "100%", borderRadius: 999, backgroundColor: colors.primary }, nextStopRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 6 }, nextStopLabel: { color: colors.muted, fontSize: 8, fontWeight: "800" }, nextStop: { flex: 1, minWidth: 0, color: colors.primary, fontSize: 9, fontWeight: "900" }, routeEnd: { width: 82, alignItems: "flex-end", justifyContent: "center", gap: 7 }, routeState: { alignItems: "flex-end", gap: 4 }, syncState: { color: colors.warning, fontSize: 7, fontWeight: "900", maxWidth: 82, textAlign: "right" }, status: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 6 }, statusText: { fontSize: 8, fontWeight: "900" }, openRoute: { flexDirection: "row", alignItems: "center", gap: 1 }, openRouteText: { color: colors.primary, fontSize: 8, fontWeight: "900" }, arrow: { color: colors.faint, fontSize: 24 }, empty: { marginHorizontal: 16, marginTop: 10, minHeight: 156, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", padding: 18, borderWidth: 1, borderColor: colors.border }, emptyAction: { borderColor: colors.primarySoft }, emptyIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: 9 }, emptyText: { color: colors.text, fontSize: 13, fontWeight: "900", textAlign: "center" }, emptyActionRow: { minHeight: 36, marginTop: 8, flexDirection: "row", alignItems: "center", gap: 3 }, emptyActionText: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  commercialCard: { marginHorizontal: 14, marginTop: 9, minHeight: 74, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: colors.border }, commercialMark: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.holidayBg, alignItems: "center", justifyContent: "center" }, commercialMarkText: { color: colors.holiday, fontSize: 20, fontWeight: "900" }, planningUnavailable: { marginHorizontal: 14, marginTop: 16, padding: 13, borderRadius: radii.inner, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.warningBorder }, planningUnavailableText: { color: colors.warning, fontSize: 11, lineHeight: 16, fontWeight: "800" }, pressed: { opacity: 0.7 },
  headerModern: { minHeight: 82, paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  backModern: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", ...cardShadow },
  headerBodyModern: { flex: 1, minWidth: 0 },
  eyebrowModern: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.9 },
  titleModern: { color: colors.text, fontSize: 23, fontWeight: "900", marginTop: 2, letterSpacing: -0.45 },
  subtitleModern: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  headerCreateModern: { minHeight: 44, borderRadius: 14, backgroundColor: colors.primarySoft, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5 },
  headerCreateTextModern: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  calendarLinkModern: { minHeight: 66, marginHorizontal: 14, marginTop: 12, borderRadius: radii.card, padding: 11, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary, flexDirection: "row", alignItems: "center", gap: 10, ...cardShadow },
  calendarLinkIconModern: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  calendarLinkBodyModern: { flex: 1, minWidth: 0 },
  calendarLinkTitleModern: { color: colors.text, fontSize: 14, fontWeight: "900" },
  calendarLinkHintModern: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  routeGroupModern: { marginTop: 18 },
  routeGridModern: { width: "100%" },
  routeGridTablet: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 14, alignItems: "flex-start" },
  routeCardSlotTablet: { flexBasis: "48%", flexGrow: 1 },
  routeGroupHeadingModern: { minHeight: 38, marginHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 8 },
  routeGroupToggleModern: { minHeight: 52, marginHorizontal: 14, borderRadius: radii.inner, paddingHorizontal: 12, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  routeGroupLabelModern: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  routeGroupTitleModern: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: "900" },
  routeGroupCountModern: { minWidth: 24, height: 24, borderRadius: radii.pill, paddingHorizontal: 6, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  routeGroupCountTextModern: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  routeGroupToggleActionModern: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  routeCardModern: { marginHorizontal: 14, marginTop: 7, borderRadius: 22, padding: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, ...cardShadow },
  routeCardTablet: { marginHorizontal: 0, marginTop: 0 },
  routeCardFeaturedModern: { borderColor: colors.primary, shadowOpacity: 0.085, elevation: 2 },
  routeTopModern: { flexDirection: "row", alignItems: "center", gap: 10 },
  dateBadgeModern: { width: 50, height: 56, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  dateDayModern: { color: colors.primary, fontSize: 20, fontWeight: "900" },
  dateMonthModern: { color: colors.primary, fontSize: 11, fontWeight: "800", marginTop: 1 },
  routeHeadingModern: { flex: 1, minWidth: 0 },
  routeNameModern: { color: colors.text, fontSize: 16, fontWeight: "900" },
  routeDateModern: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  routeStateModern: { maxWidth: 112, alignItems: "flex-end", gap: 4 },
  syncStateModern: { color: colors.warning, fontSize: 11, fontWeight: "800", textAlign: "right" },
  statusModern: { borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 6 },
  statusTextModern: { fontSize: 11, fontWeight: "900" },
  progressSectionModern: { marginTop: 15 },
  progressHeaderModern: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  routeMetaModern: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  progressPercentModern: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  progressTrackModern: { height: 6, borderRadius: radii.pill, overflow: "hidden", backgroundColor: colors.primarySoft, marginTop: 7 },
  progressFillModern: { height: "100%", borderRadius: radii.pill, backgroundColor: colors.primary },
  nextStopSurfaceModern: { minHeight: 74, marginTop: 14, borderRadius: 16, padding: 10, backgroundColor: colors.primarySoft, flexDirection: "row", alignItems: "center", gap: 10 },
  nextStopIconModern: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  nextStopBodyModern: { flex: 1, minWidth: 0 },
  nextStopLabelModern: { color: colors.primary, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.45 },
  nextStopModern: { color: colors.text, fontSize: 14, fontWeight: "900", marginTop: 2 },
  nextStopMetaModern: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  openRouteModern: { minHeight: 44, marginTop: 7, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3 },
  openRouteTextModern: { color: colors.primary, fontSize: 12, fontWeight: "900" },
})
