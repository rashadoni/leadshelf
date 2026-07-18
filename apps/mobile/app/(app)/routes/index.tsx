import { useEffect } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { useField } from "../../../src/field/field-context"
import { routeStatusMeta, type RouteStatusTone } from "../../../src/field/week-status"
import { t, useLocale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"
import { useSync } from "../../../src/sync/sync-context"

export default function RoutesScreen() {
  useLocale()
  const field = useField()
  const { status: syncStatus } = useSync()
  const routes = field.week?.days.flatMap((day) => day.routes.map((route) => ({ ...route, day }))) ?? []
  useEffect(() => {
    if (syncStatus.lastSyncAt && syncStatus.pendingOps === 0) void field.refresh()
  // Refresh the CRM cache once after a completed outbox cycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus.lastSyncAt, syncStatus.pendingOps])
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={field.phase === "refreshing"} onRefresh={() => void field.refresh()} />}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
          <View style={styles.headerBody}><Text style={styles.eyebrow}>{t("tabWork").toUpperCase()}</Text><Text style={styles.title}>{t("routeHubTitle")}</Text><Text style={styles.subtitle}>{t("routeHubHint")}</Text></View>
          <Pressable onPress={() => router.push("/(app)/routes/new" as never)} style={styles.add}><Text style={styles.addText}>＋</Text></Pressable>
        </View>

        <Pressable onPress={() => router.push("/(app)/routes/new" as never)} style={styles.createCard}>
          <View style={styles.createMark}><Text style={styles.createMarkText}>＋</Text></View>
          <View style={styles.createBody}><Text style={styles.createTitleLight}>{t("createRoute")}</Text><Text style={styles.createHintLight}>{t("chooseStop")}</Text></View>
          <Text style={styles.arrowLight}>›</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>{t("tabWeek")}</Text>
        {routes.length ? routes.map(({ day, ...route }) => {
          const meta = routeStatusMeta(route.effectiveStatus)
          const tone = tones[meta.tone]
          return (
            <Pressable key={route.id} onPress={() => router.push(`/(app)/routes/${route.id}` as never)} style={({ pressed }) => [styles.routeCard, pressed && styles.pressed]}>
              <View style={styles.dateBadge}><Text style={styles.dateDay}>{day.date.slice(8)}</Text><Text style={styles.dateMonth}>{day.date.slice(5, 7)}</Text></View>
              <View style={styles.routeBody}><Text style={styles.routeName}>{route.name ?? t("tabRoute")}</Text><Text style={styles.routeMeta}>{route.visitedPoints}/{route.totalPoints} {t("routeVisitedLabel")}</Text>{route.points[0] ? <Text style={styles.nextStop} numberOfLines={1}>{route.points.find((point) => point.effectiveStatus === "PENDING")?.contact?.displayName ?? route.points.find((point) => point.effectiveStatus === "PENDING")?.customer.name ?? route.points[0].contact?.displayName ?? route.points[0].customer.name}</Text> : null}</View>
              <View style={styles.routeState}>
                {route.syncState ? <Text style={styles.syncState}>{route.syncState === "PENDING" ? t("queued") : t("syncNeedsAttention")}</Text> : null}
                <View style={[styles.status, { backgroundColor: tone.background }]}><Text style={[styles.statusText, { color: tone.foreground }]}>{t(meta.labelKey)}</Text></View>
              </View>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          )
        }) : <View style={styles.empty}><Text style={styles.emptyText}>{t("fieldRoutesEmpty")}</Text></View>}

        <Text style={styles.sectionTitle}>{t("shelfConnection")}</Text>
        <Pressable onPress={() => router.push("/(app)/routes/commercial" as never)} style={styles.commercialCard}>
          <View style={styles.commercialMark}><Text style={styles.commercialMarkText}>▦</Text></View>
          <View style={styles.createBody}><Text style={styles.createTitle}>{t("commercialRoute")}</Text><Text style={styles.createHint}>{t("commercialRouteHint")}</Text></View>
          <Text style={styles.arrow}>›</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const tones: Record<RouteStatusTone, { background: string; foreground: string }> = {
  draft: { background: colors.draftBg, foreground: colors.draft }, planned: { background: colors.infoBg, foreground: colors.info }, inProgress: { background: colors.warningBg, foreground: colors.warning }, completed: { background: colors.successBg, foreground: colors.successDark }, cancelled: { background: colors.draftBg, foreground: colors.draft }, missed: { background: colors.missedBg, foreground: colors.missed },
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { minHeight: "100%", paddingBottom: 30 }, header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 }, back: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }, backText: { color: colors.text, fontSize: 30, lineHeight: 31 }, headerBody: { flex: 1 }, eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 }, title: { color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 2 }, subtitle: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 }, add: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, addText: { color: colors.headerText, fontSize: 23, lineHeight: 25 },
  createCard: { marginHorizontal: 14, marginTop: 16, minHeight: 76, borderRadius: radii.card, padding: 13, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", gap: 11, ...cardShadow }, createMark: { width: 46, height: 46, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" }, createMarkText: { color: colors.headerText, fontSize: 26 }, createBody: { flex: 1 }, createTitle: { color: colors.text, fontSize: 14, fontWeight: "900" }, createHint: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 }, createTitleLight: { color: colors.headerText, fontSize: 14, fontWeight: "900" }, createHintLight: { color: colors.headerSubtext, fontSize: 10, lineHeight: 14, marginTop: 3 }, arrowLight: { color: colors.headerText, fontSize: 24 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900", marginHorizontal: 16, marginTop: 22, marginBottom: 3 }, routeCard: { marginHorizontal: 14, marginTop: 9, minHeight: 82, borderRadius: radii.card, padding: 12, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 10, ...cardShadow }, dateBadge: { width: 43, height: 49, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, dateDay: { color: colors.primary, fontSize: 17, fontWeight: "900" }, dateMonth: { color: colors.primary, fontSize: 8, fontWeight: "800" }, routeBody: { flex: 1, minWidth: 0 }, routeName: { color: colors.text, fontSize: 13, fontWeight: "900" }, routeMeta: { color: colors.muted, fontSize: 9, marginTop: 3 }, nextStop: { color: colors.primary, fontSize: 9, fontWeight: "800", marginTop: 4 }, routeState: { alignItems: "flex-end", gap: 4 }, syncState: { color: colors.warning, fontSize: 7, fontWeight: "900", maxWidth: 78, textAlign: "right" }, status: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 6 }, statusText: { fontSize: 8, fontWeight: "900" }, arrow: { color: colors.faint, fontSize: 24 }, empty: { marginHorizontal: 14, marginTop: 9, minHeight: 120, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" }, emptyText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  commercialCard: { marginHorizontal: 14, marginTop: 9, minHeight: 74, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: colors.border }, commercialMark: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.holidayBg, alignItems: "center", justifyContent: "center" }, commercialMarkText: { color: colors.holiday, fontSize: 20, fontWeight: "900" }, pressed: { opacity: 0.7 },
})
