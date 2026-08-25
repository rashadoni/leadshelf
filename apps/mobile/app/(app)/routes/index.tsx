import { useEffect } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { useField } from "../../../src/field/field-context"
import { routeStatusMeta, type RouteStatusTone } from "../../../src/field/week-status"
import { t, useLocale } from "../../../src/i18n"
import { formatCalendarDay, formatCalendarMonthShort } from "../../../src/i18n/date-format"
import { colors, cardShadow, radii } from "../../../src/theme"
import { useSync } from "../../../src/sync/sync-context"
import { IS_LEADDRIVE_FIELD } from "../../../src/config/mobile-variant"
import { TabIcon } from "../../../src/components/TabIcon"

export default function RoutesScreen() {
  const locale = useLocale()
  const field = useField()
  const { status: syncStatus } = useSync()
  const routes = field.week?.days.flatMap((day) => day.routes.map((route) => ({ ...route, day }))) ?? []
  const canCreateRoute = field.week?.capabilities.createOwnDraft === true
  useEffect(() => {
    if (syncStatus.lastSyncAt && syncStatus.pendingOps === 0) void field.refresh()
  // Refresh the CRM cache once after a completed outbox cycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus.lastSyncAt, syncStatus.pendingOps])
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={field.phase === "refreshing"} onRefresh={() => void field.refresh()} />}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.back}><TabIcon name="chevronLeft" color={colors.text} size={23} /></Pressable>
          <View style={styles.headerBody}><Text style={styles.eyebrow}>{t("tabWork").toUpperCase()}</Text><Text style={styles.title}>{t("routeHubTitle")}</Text><Text style={styles.subtitle}>{t("routeHubHint")}</Text></View>
          {canCreateRoute ? <Pressable accessibilityRole="button" accessibilityLabel={t("createRoute")} accessibilityHint={t("chooseStop")} onPress={() => router.push("/(app)/routes/new" as never)} style={styles.add}><TabIcon name="add" color={colors.headerText} size={23} /></Pressable> : null}
        </View>

        {canCreateRoute ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("createRoute")} accessibilityHint={t("chooseStop")} onPress={() => router.push("/(app)/routes/new" as never)} style={({ pressed }) => [styles.createCard, pressed && styles.pressed]}>
            <View style={styles.createMark}><TabIcon name="add" color={colors.headerText} size={26} /></View>
            <View style={styles.createBody}><Text style={styles.createTitleLight}>{t("createRoute")}</Text><Text style={styles.createHintLight}>{t("chooseStop")}</Text></View>
            <TabIcon name="chevronRight" color={colors.headerText} size={22} />
          </Pressable>
        ) : field.week ? (
          <View style={styles.planningUnavailable} accessibilityRole="alert"><Text style={styles.planningUnavailableText}>{t("routePlanningUnavailable")}</Text></View>
        ) : null}

        {(field.phase === "stale" || field.phase === "error") ? (
          <View style={styles.dataNotice} accessibilityRole="alert">
            <View style={styles.dataNoticeBody}>
              <View style={styles.dataNoticeIcon}><TabIcon name="alert" color={colors.warning} size={19} /></View>
              <Text style={styles.dataNoticeText}>{field.error ?? t("fieldDataError")}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} accessibilityState={{ busy: field.phase === "refreshing" }} onPress={() => void field.refresh()} style={styles.retry}>
              <TabIcon name="refresh" color={colors.warning} size={20} />
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>{t("tabWeek")}</Text>
        {routes.length ? routes.map(({ day, ...route }) => {
          const meta = routeStatusMeta(route.effectiveStatus)
          const tone = tones[meta.tone]
          const calendarDay = formatCalendarDay(day.date, locale)
          const routeName = route.name ?? t("tabRoute")
          const progressText = `${route.visitedPoints}/${route.totalPoints} ${t("routeVisitedLabel")}`
          const nextPoint = route.points.find((point) => point.effectiveStatus === "PENDING") ?? route.points[0]
          const nextStopName = nextPoint?.contact?.displayName ?? nextPoint?.customer.name
          const syncText = route.syncState === "PENDING" ? t("queued") : route.syncState ? t("syncNeedsAttention") : null
          const routeLabel = [
            routeName,
            progressText,
            nextStopName ? `${t("routeNextStop")}: ${nextStopName}` : null,
            t(meta.labelKey),
            syncText,
          ].filter(Boolean).join(". ")
          const progress = route.totalPoints > 0 ? Math.min(100, Math.round((route.visitedPoints / route.totalPoints) * 100)) : 0
          return (
            <Pressable key={route.id} accessibilityRole="button" accessibilityLabel={routeLabel} accessibilityHint={t("openRoute")} accessibilityState={{ busy: route.syncState === "PENDING" }} onPress={() => router.push(`/(app)/routes/${route.id}` as never)} style={({ pressed }) => [styles.routeCard, pressed && styles.pressed]}>
              <View style={styles.dateBadge}><Text style={styles.dateDay}>{calendarDay.day || day.date.slice(8)}</Text><Text style={styles.dateMonth}>{formatCalendarMonthShort(day.date, locale) || day.date.slice(5, 7)}</Text></View>
              <View style={styles.routeBody}>
                <Text style={styles.routeName} numberOfLines={1}>{routeName}</Text>
                <Text style={styles.routeMeta}>{progressText}</Text>
                <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
                {nextStopName ? <View style={styles.nextStopRow}><TabIcon name="location" color={colors.primary} size={12} /><Text style={styles.nextStopLabel}>{t("routeNextStop")}</Text><Text style={styles.nextStop} numberOfLines={1}>{nextStopName}</Text></View> : null}
              </View>
              <View style={styles.routeEnd}>
                <View style={styles.routeState}>
                  {syncText ? <Text style={styles.syncState}>{syncText}</Text> : null}
                  <View style={[styles.status, { backgroundColor: tone.background }]}><Text style={[styles.statusText, { color: tone.foreground }]}>{t(meta.labelKey)}</Text></View>
                </View>
                <View style={styles.openRoute}><Text style={styles.openRouteText}>{t("openRoute")}</Text><TabIcon name="chevronRight" color={colors.primary} size={16} /></View>
              </View>
            </Pressable>
          )
        }) : <View accessible accessibilityRole="summary" accessibilityLabel={canCreateRoute ? `${t("fieldRoutesEmpty")}. ${t("createRoute")}` : t("fieldRoutesEmpty")} style={styles.empty}><View accessible={false} style={styles.emptyIcon}><TabIcon name="route" color={colors.primary} size={25} /></View><Text style={styles.emptyText}>{t("fieldRoutesEmpty")}</Text>{canCreateRoute ? <Text style={styles.emptyHint}>{t("createRoute")}</Text> : null}</View>}

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
      </ScrollView>
    </SafeAreaView>
  )
}

const tones: Record<RouteStatusTone, { background: string; foreground: string }> = {
  draft: { background: colors.draftBg, foreground: colors.draft }, planned: { background: colors.infoBg, foreground: colors.info }, inProgress: { background: colors.warningBg, foreground: colors.warning }, completed: { background: colors.successBg, foreground: colors.successDark }, cancelled: { background: colors.draftBg, foreground: colors.draft }, missed: { background: colors.missedBg, foreground: colors.missed },
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { minHeight: "100%", paddingBottom: 30 }, header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 }, back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }, backText: { color: colors.text, fontSize: 30, lineHeight: 31 }, headerBody: { flex: 1 }, eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 }, title: { color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 2 }, subtitle: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 }, add: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, addText: { color: colors.headerText, fontSize: 23, lineHeight: 25 },
  createCard: { marginHorizontal: 14, marginTop: 16, minHeight: 76, borderRadius: radii.card, padding: 13, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", gap: 11, ...cardShadow }, createMark: { width: 46, height: 46, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" }, createMarkText: { color: colors.headerText, fontSize: 26 }, createBody: { flex: 1 }, createTitle: { color: colors.text, fontSize: 14, fontWeight: "900" }, createHint: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 }, createTitleLight: { color: colors.headerText, fontSize: 14, fontWeight: "900" }, createHintLight: { color: colors.headerSubtext, fontSize: 10, lineHeight: 14, marginTop: 3 }, arrowLight: { color: colors.headerText, fontSize: 24 },
  dataNotice: { marginHorizontal: 14, marginTop: 12, minHeight: 58, borderRadius: radii.inner, padding: 9, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: "#F6D788" }, dataNoticeBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }, dataNoticeIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.card }, dataNoticeText: { flex: 1, color: colors.warning, fontSize: 10, lineHeight: 14, fontWeight: "800" }, retry: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.card },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900", marginHorizontal: 16, marginTop: 22, marginBottom: 3 }, routeCard: { marginHorizontal: 14, marginTop: 9, minHeight: 96, borderRadius: radii.card, padding: 12, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 10, ...cardShadow }, dateBadge: { width: 43, height: 52, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, dateDay: { color: colors.primary, fontSize: 17, fontWeight: "900" }, dateMonth: { color: colors.primary, fontSize: 8, fontWeight: "800" }, routeBody: { flex: 1, minWidth: 0 }, routeName: { color: colors.text, fontSize: 13, fontWeight: "900" }, routeMeta: { color: colors.muted, fontSize: 9, marginTop: 3 }, progressTrack: { height: 4, borderRadius: 999, overflow: "hidden", backgroundColor: colors.primarySoft, marginTop: 6 }, progressFill: { height: "100%", borderRadius: 999, backgroundColor: colors.primary }, nextStopRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 6 }, nextStopLabel: { color: colors.muted, fontSize: 8, fontWeight: "800" }, nextStop: { flex: 1, minWidth: 0, color: colors.primary, fontSize: 9, fontWeight: "900" }, routeEnd: { width: 82, alignItems: "flex-end", justifyContent: "center", gap: 7 }, routeState: { alignItems: "flex-end", gap: 4 }, syncState: { color: colors.warning, fontSize: 7, fontWeight: "900", maxWidth: 82, textAlign: "right" }, status: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 6 }, statusText: { fontSize: 8, fontWeight: "900" }, openRoute: { flexDirection: "row", alignItems: "center", gap: 1 }, openRouteText: { color: colors.primary, fontSize: 8, fontWeight: "900" }, arrow: { color: colors.faint, fontSize: 24 }, empty: { marginHorizontal: 14, marginTop: 9, minHeight: 138, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", padding: 18 }, emptyIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: 9 }, emptyText: { color: colors.text, fontSize: 13, fontWeight: "900", textAlign: "center" }, emptyHint: { color: colors.primary, fontSize: 10, fontWeight: "800", textAlign: "center", marginTop: 5 },
  commercialCard: { marginHorizontal: 14, marginTop: 9, minHeight: 74, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: colors.border }, commercialMark: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.holidayBg, alignItems: "center", justifyContent: "center" }, commercialMarkText: { color: colors.holiday, fontSize: 20, fontWeight: "900" }, planningUnavailable: { marginHorizontal: 14, marginTop: 16, padding: 13, borderRadius: radii.inner, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: "#F6D788" }, planningUnavailableText: { color: colors.warning, fontSize: 11, lineHeight: 16, fontWeight: "800" }, pressed: { opacity: 0.7 },
})
