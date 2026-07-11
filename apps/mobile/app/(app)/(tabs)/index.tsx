// Главная вкладка «Маршрут»: приветствие, маршрут на сегодня, активный визит.
// Дизайн — по образцу владельца (индиго-хедер, карточки, зелёная карточка визита).
import { useCallback, useEffect, useMemo, useState } from "react"
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, Vibration, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import * as Crypto from "expo-crypto"
import { router, useFocusEffect } from "expo-router"
import Svg, { Circle, Path } from "react-native-svg"
import { SyncBar } from "../../../src/components/SyncBar"
import { SectionHint } from "../../../src/components/SectionHint"
import {
  enqueueVisitCheckIn,
  enqueueVisitCheckOut,
  getStore,
  listRoutes,
  listTasks,
  listVisits,
} from "../../../src/db/local-store"
import { getCurrentDeviceLocation } from "../../../src/location/device-location"
import type { RouteRow, TaskRow, VisitRow } from "../../../src/sync/ports"
import { useSync } from "../../../src/sync/sync-context"
import { t, type MessageKey, useLocale } from "../../../src/i18n"
import { formatLongDate, minutesBetween } from "../../../src/i18n/date-format"
import { tokenStore } from "../../../src/auth/token-store"
import { colors, cardShadow, radii } from "../../../src/theme"

function isLocalVisit(visit: VisitRow | undefined): boolean {
  return Boolean(visit?.id.startsWith("local-"))
}

function EmptyPin() {
  return (
    <Svg width={72} height={72} viewBox="0 0 72 72" fill="none">
      <Circle cx={36} cy={36} r={34} fill={colors.primarySoft} />
      <Path
        d="M36 22c-5 0-9 4-9 9 0 6.4 9 17 9 17s9-10.6 9-17c0-5-4-9-9-9Z"
        fill={colors.danger}
      />
      <Circle cx={36} cy={31} r={3.4} fill={colors.headerText} />
    </Svg>
  )
}

function RouteCardSkeleton() {
  return (
    <View style={[styles.card, styles.skeletonCard]}>
      <View style={[styles.skeletonLine, styles.skeletonTitle]} />
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.skeletonRow}>
          <View style={styles.skeletonDot} />
          <View style={styles.skeletonBody}>
            <View style={[styles.skeletonLine, styles.skeletonStore]} />
            <View style={[styles.skeletonLine, styles.skeletonMeta]} />
          </View>
          <View style={styles.skeletonButton} />
        </View>
      ))}
    </View>
  )
}

export default function RouteTab() {
  const locale = useLocale()
  const { status, sync } = useSync()
  const [userName, setUserName] = useState<string | null>(null)
  const [routes, setRoutes] = useState<RouteRow[]>([])
  const [visits, setVisits] = useState<VisitRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => new Date())

  const reload = useCallback(() => {
    setRoutes(listRoutes())
    setVisits(listVisits())
    setTasks(listTasks())
    setNow(new Date())
  }, [])
  useFocusEffect(reload)

  useEffect(() => {
    void tokenStore.getUserName().then((name) => setUserName(name))
  }, [])

  useEffect(() => {
    if (status.phase !== "idle") return
    reload()
  }, [reload, status.lastSyncAt, status.phase])

  // «N мин прошло» у активного визита тикает раз в минуту
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const tasksByStore = useMemo(() => {
    const map = new Map<string, TaskRow[]>()
    for (const task of tasks) {
      const storeTasks = map.get(task.storeId) ?? []
      storeTasks.push(task)
      map.set(task.storeId, storeTasks)
    }
    return map
  }, [tasks])

  const activeVisit = useMemo(
    () => visits.find((visit) => visit.status === "IN_PROGRESS"),
    [visits],
  )
  const activeVisitStore = activeVisit ? getStore(activeVisit.storeId) : null

  async function onRefresh() {
    setRefreshing(true)
    await sync()
    reload()
    setRefreshing(false)
  }

  async function checkIn(route: RouteRow, stopId: string, storeId: string) {
    if (!route.agentId) return
    const store = getStore(storeId)
    if (store?.latitude == null || store.longitude == null) return
    const deviceLocation = await getCurrentDeviceLocation().catch(() => null)
    if (!deviceLocation) {
      Alert.alert(t("locationPermissionDenied"))
      return
    }
    enqueueVisitCheckIn({
      clientOpId: `op-${Crypto.randomUUID()}`,
      agentId: route.agentId,
      storeId,
      routeStopId: stopId,
      latitude: deviceLocation.latitude,
      longitude: deviceLocation.longitude,
    })
    Vibration.vibrate(40)
    reload()
    void sync()
  }

  function checkOut(visit: VisitRow) {
    enqueueVisitCheckOut({
      clientOpId: `op-${Crypto.randomUUID()}`,
      visitId: visit.id,
    })
    Vibration.vibrate(60)
    reload()
    void sync()
  }

  const activeVisitIsLocal = isLocalVisit(activeVisit)
  const firstSyncLoading =
    status.lastSyncAt === null &&
    status.phase !== "offline" &&
    status.phase !== "error" &&
    status.phase !== "upgradeRequired"
  const showRouteSkeleton = routes.length === 0 && (refreshing || firstSyncLoading)

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>
            {t("greeting")}{userName ? `, ${userName}` : ""}!
          </Text>
          <Text style={styles.heroDate}>{formatLongDate(now, locale)}</Text>
        </View>

        <SyncBar />
        <SectionHint section="route" icon="route" titleKey="routeHintTitle" bodyKey="routeHintBody" />

        {showRouteSkeleton ? (
          <View style={styles.skeletonList}>
            <RouteCardSkeleton />
            <RouteCardSkeleton />
          </View>
        ) : routes.length === 0 ? (
          <View style={[styles.card, styles.emptyCard]}>
            <EmptyPin />
            <Text style={styles.emptyTitle}>{t("noRouteToday")}</Text>
            <Text style={styles.emptyHint}>{t("noRouteTodayHint")}</Text>
          </View>
        ) : (
          routes.map((route) => (
            <View key={route.id} style={styles.card}>
              <View style={styles.routeHeader}>
                <Text style={styles.routeTitle}>{route.name}</Text>
                <Text style={styles.routeMeta}>
                  {route.stops.length} {t("routeStops")}
                </Text>
              </View>
              {route.stops.length === 0 ? (
                <Text style={styles.emptyStop}>{t("noRouteStops")}</Text>
              ) : null}
              {route.stops.map((stop) => {
                const store = getStore(stop.storeId)
                const stopTasks = tasksByStore.get(stop.storeId) ?? []
                const stopVisits = visits.filter((visit) => visit.routeStopId === stop.id)
                const stopActive = stopVisits.find((visit) => visit.status === "IN_PROGRESS")
                const completedVisit = stopVisits.find((visit) => visit.status === "COMPLETED")
                const stopActiveIsLocal = isLocalVisit(stopActive)
                const canCheckIn = Boolean(route.agentId && store?.latitude != null && store.longitude != null)
                const disabled = stopActive
                  ? stopActiveIsLocal
                  : !canCheckIn || Boolean(completedVisit)
                const disabledReason = !route.agentId
                  ? t("missingRouteAgent")
                  : store?.latitude == null || store.longitude == null
                    ? t("missingStoreGeo")
                    : null
                const plannedAt = stop.plannedAt ? stop.plannedAt.slice(11, 16) : null
                return (
                  <View key={stop.id} style={styles.stop}>
                    <View style={styles.stopBody}>
                      <Text style={styles.stopTitle}>
                        {stop.sortOrder}. {store?.name ?? stop.storeId}
                      </Text>
                      <Text style={styles.meta}>
                        {stopTasks.length} {t("tasksAtStore")}
                        {plannedAt ? ` · ${plannedAt}` : ""}
                        {store?.address ? ` · ${store.address}` : ""}
                      </Text>
                      {stopActiveIsLocal ? (
                        <Text style={styles.visitMeta}>{t("visitWaitingSync")}</Text>
                      ) : stopActive ? (
                        <Text style={styles.visitMeta}>{t("visitInProgress")}</Text>
                      ) : completedVisit ? (
                        <Text style={styles.visitMeta}>{t("visitCompleted")}</Text>
                      ) : disabledReason ? (
                        <Text style={styles.warningMeta}>{disabledReason}</Text>
                      ) : null}
                      {stopTasks.length > 0 ? (
                        <View style={styles.stopTasks}>
                          {stopTasks.slice(0, 4).map((task) => (
                            <Pressable
                              key={task.id}
                              onPress={() => router.push(`/(app)/tasks/${task.id}` as never)}
                              style={styles.stopTask}
                            >
                              <View style={styles.stopTaskBody}>
                                <Text style={styles.stopTaskTitle} numberOfLines={1}>
                                  {task.title}
                                </Text>
                                <Text style={styles.stopTaskMeta}>
                                  {t("agentTask")} · {t(`status_${task.status}` as MessageKey)}
                                </Text>
                              </View>
                              <Text style={styles.openTask}>{t("openTask")}</Text>
                            </Pressable>
                          ))}
                          {stopTasks.length > 4 ? (
                            <Text style={styles.moreTasks}>
                              +{stopTasks.length - 4} {t("moreTasks")}
                            </Text>
                          ) : null}
                        </View>
                      ) : (
                        <Text style={styles.noTasksAtStop}>{t("noTasksAtStop")}</Text>
                      )}
                    </View>
                    <Pressable
                      disabled={disabled}
                      onPress={() => (stopActive ? checkOut(stopActive) : checkIn(route, stop.id, stop.storeId))}
                      style={[styles.button, stopActive && styles.checkoutButton, disabled && styles.buttonDisabled]}
                    >
                      <Text style={styles.buttonText}>
                        {stopActiveIsLocal
                          ? t("queued")
                          : stopActive
                            ? t("checkOut")
                            : completedVisit
                              ? t("visitCompletedShort")
                              : t("checkIn")}
                      </Text>
                    </Pressable>
                  </View>
                )
              })}
            </View>
          ))
        )}

        {activeVisit && activeVisitStore ? (
          <View style={styles.activeVisitCard}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(app)/(tabs)/visit" as never)}
              style={({ pressed }) => [styles.activeVisitBody, pressed && styles.activeVisitBodyPressed]}
            >
              <View style={styles.activeVisitLabelRow}>
                <View style={styles.activeDot} />
                <Text style={styles.activeVisitLabel}>{t("nowAt")}</Text>
              </View>
              <Text style={styles.activeVisitStore} numberOfLines={1}>
                {activeVisitStore.name}
              </Text>
              <Text style={styles.activeVisitMeta}>
                {activeVisit.checkInAt
                  ? `${minutesBetween(activeVisit.checkInAt, now)} ${t("minutesElapsed")}`
                  : t("visitInProgress")}
              </Text>
              <Text style={styles.openVisit}>{t("openVisit")}</Text>
            </Pressable>
            <Pressable
              disabled={activeVisitIsLocal}
              onPress={() => checkOut(activeVisit)}
              style={({ pressed }) => [
                styles.finishButton,
                pressed && styles.finishButtonPressed,
                activeVisitIsLocal && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.finishButtonText}>
                {activeVisitIsLocal ? t("queued") : t("finishVisit")}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  scroll: { backgroundColor: colors.bg, minHeight: "100%", paddingBottom: 24 },
  hero: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 26,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  heroTitle: { color: colors.headerText, fontSize: 26, fontWeight: "800" },
  heroDate: { color: colors.headerSubtext, fontSize: 14, marginTop: 4 },
  card: {
    backgroundColor: colors.card,
    marginHorizontal: 14,
    marginTop: 14,
    padding: 16,
    borderRadius: radii.card,
    ...cardShadow,
  },
  emptyCard: { alignItems: "center", paddingVertical: 44, gap: 6 },
  skeletonList: { paddingTop: 2 },
  skeletonCard: { gap: 8 },
  skeletonLine: { height: 10, borderRadius: radii.pill, backgroundColor: colors.skeleton },
  skeletonTitle: { width: "48%", height: 14, backgroundColor: colors.skeletonStrong },
  skeletonRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  skeletonDot: { width: 10, height: 10, borderRadius: radii.pill, backgroundColor: colors.skeletonStrong },
  skeletonBody: { flex: 1, gap: 7 },
  skeletonStore: { width: "66%" },
  skeletonMeta: { width: "82%", height: 8 },
  skeletonButton: { width: 54, height: 28, borderRadius: radii.inner, backgroundColor: colors.skeletonStrong },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: colors.text, marginTop: 14 },
  emptyHint: { fontSize: 13, color: colors.faint, textAlign: "center", paddingHorizontal: 24 },
  routeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  routeTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  routeMeta: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  emptyStop: { color: colors.faint, fontSize: 12 },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 10,
  },
  stopBody: { flex: 1 },
  stopTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  visitMeta: { fontSize: 12, color: colors.successDark, fontWeight: "600", marginTop: 4 },
  warningMeta: { fontSize: 12, color: colors.warning, fontWeight: "600", marginTop: 4 },
  noTasksAtStop: { marginTop: 8, fontSize: 11, color: colors.faint },
  stopTasks: { gap: 6, marginTop: 8 },
  stopTask: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radii.inner,
    backgroundColor: colors.bg,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  stopTaskBody: { flex: 1 },
  stopTaskTitle: { fontSize: 12, fontWeight: "700", color: colors.text },
  stopTaskMeta: { marginTop: 1, fontSize: 10, color: colors.muted },
  openTask: { fontSize: 11, fontWeight: "800", color: colors.primary },
  moreTasks: { fontSize: 11, color: colors.muted, fontWeight: "600" },
  button: { borderRadius: radii.inner, backgroundColor: colors.primary, paddingHorizontal: 10, paddingVertical: 8 },
  checkoutButton: { backgroundColor: colors.success },
  buttonDisabled: { backgroundColor: colors.disabled },
  buttonText: { color: colors.headerText, fontSize: 12, fontWeight: "700" },
  activeVisitCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.successBg,
    borderColor: colors.successBorder,
    borderWidth: 1,
    marginHorizontal: 14,
    marginTop: 14,
    padding: 16,
    borderRadius: radii.card,
  },
  activeVisitBody: { flex: 1, minWidth: 0 },
  activeVisitBodyPressed: { opacity: 0.7 },
  activeVisitLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  activeVisitLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6, color: colors.successDark },
  activeVisitStore: { fontSize: 17, fontWeight: "800", color: colors.text, marginTop: 3 },
  activeVisitMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  openVisit: { fontSize: 12, color: colors.successDark, fontWeight: "800", marginTop: 6 },
  finishButton: {
    backgroundColor: colors.danger,
    borderRadius: radii.pill,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  finishButtonPressed: { backgroundColor: colors.dangerPressed },
  finishButtonText: { color: colors.headerText, fontSize: 13, fontWeight: "800" },
})
