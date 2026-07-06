import { useCallback, useEffect, useMemo, useState } from "react"
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import * as Crypto from "expo-crypto"
import { router, useFocusEffect } from "expo-router"
import { SyncBar } from "../../../src/components/SyncBar"
import {
  enqueueVisitCheckIn,
  enqueueVisitCheckOut,
  getStore,
  listRoutes,
  listTasks,
  listVisits,
} from "../../../src/db/local-store"
import type { RouteRow, TaskRow, VisitRow } from "../../../src/sync/ports"
import { useSync } from "../../../src/sync/sync-context"
import { t } from "../../../src/i18n"

function isLocalVisit(visit: VisitRow | undefined): boolean {
  return Boolean(visit?.id.startsWith("local-"))
}

export default function RoutesScreen() {
  const { status, sync } = useSync()
  const [routes, setRoutes] = useState<RouteRow[]>([])
  const [visits, setVisits] = useState<VisitRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const reload = useCallback(() => {
    setRoutes(listRoutes())
    setVisits(listVisits())
    setTasks(listTasks())
  }, [])
  useFocusEffect(reload)

  useEffect(() => {
    if (status.phase !== "idle") return
    reload()
  }, [reload, status.lastSyncAt, status.phase])

  const tasksByStore = useMemo(() => {
    const map = new Map<string, TaskRow[]>()
    for (const task of tasks) {
      const storeTasks = map.get(task.storeId) ?? []
      storeTasks.push(task)
      map.set(task.storeId, storeTasks)
    }
    return map
  }, [tasks])

  async function onRefresh() {
    setRefreshing(true)
    await sync()
    reload()
    setRefreshing(false)
  }

  function checkIn(route: RouteRow, stopId: string, storeId: string) {
    if (!route.agentId) return
    const store = getStore(storeId)
    if (store?.latitude == null || store.longitude == null) return
    enqueueVisitCheckIn({
      clientOpId: `op-${Crypto.randomUUID()}`,
      agentId: route.agentId,
      storeId,
      routeStopId: stopId,
      latitude: store.latitude,
      longitude: store.longitude,
    })
    reload()
    void sync()
  }

  function checkOut(visit: VisitRow) {
    enqueueVisitCheckOut({
      clientOpId: `op-${Crypto.randomUUID()}`,
      visitId: visit.id,
    })
    reload()
    void sync()
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("routes")}</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>{t("tasks")}</Text>
        </Pressable>
      </View>
      <SyncBar />
      <FlatList
        data={routes}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={routes.length === 0 && styles.emptyWrap}
        ListEmptyComponent={<Text style={styles.empty}>{t("noRoutes")}</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.routeHeader}>
              <Text style={styles.routeTitle}>{item.name}</Text>
              <Text style={styles.routeMeta}>
                {item.stops.length} {t("routeStops")}
              </Text>
            </View>
            {item.stops.length === 0 ? (
              <Text style={styles.emptyStop}>{t("noRouteStops")}</Text>
            ) : null}
            {item.stops.map((stop) => {
              const store = getStore(stop.storeId)
              const stopTasks = tasksByStore.get(stop.storeId) ?? []
              const stopVisits = visits.filter((visit) => visit.routeStopId === stop.id)
              const activeVisit = stopVisits.find((visit) => visit.status === "IN_PROGRESS")
              const completedVisit = stopVisits.find((visit) => visit.status === "COMPLETED")
              const activeVisitIsLocal = isLocalVisit(activeVisit)
              const canCheckIn = Boolean(item.agentId && store?.latitude != null && store.longitude != null)
              const disabled = activeVisit
                ? activeVisitIsLocal
                : !canCheckIn || Boolean(completedVisit)
              const disabledReason = !item.agentId
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
                    {activeVisitIsLocal ? (
                      <Text style={styles.visitMeta}>{t("visitWaitingSync")}</Text>
                    ) : activeVisit ? (
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
                                {t("agentTask")} · {task.status}
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
                    onPress={() => (activeVisit ? checkOut(activeVisit) : checkIn(item, stop.id, stop.storeId))}
                    style={[styles.button, activeVisit && styles.checkoutButton, disabled && styles.buttonDisabled]}
                  >
                    <Text style={styles.buttonText}>
                      {activeVisitIsLocal
                        ? t("queued")
                        : activeVisit
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
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafaf9" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: { fontSize: 24, fontWeight: "700" },
  link: { color: "#404040", fontSize: 13, fontWeight: "600" },
  emptyWrap: { flex: 1, justifyContent: "center" },
  empty: { textAlign: "center", color: "#a3a3a3", paddingHorizontal: 40 },
  card: { backgroundColor: "white", marginHorizontal: 12, marginVertical: 6, padding: 14, borderRadius: 12 },
  routeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  routeTitle: { fontSize: 16, fontWeight: "700" },
  routeMeta: { color: "#737373", fontSize: 12, fontWeight: "600" },
  emptyStop: { color: "#a3a3a3", fontSize: 12 },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#f5f5f4",
    paddingVertical: 10,
  },
  stopBody: { flex: 1 },
  stopTitle: { fontSize: 14, fontWeight: "600" },
  meta: { fontSize: 12, color: "#737373", marginTop: 2 },
  visitMeta: { fontSize: 12, color: "#166534", fontWeight: "600", marginTop: 4 },
  warningMeta: { fontSize: 12, color: "#b45309", fontWeight: "600", marginTop: 4 },
  noTasksAtStop: { marginTop: 8, fontSize: 11, color: "#a3a3a3" },
  stopTasks: { gap: 6, marginTop: 8 },
  stopTask: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 8,
    backgroundColor: "#fafaf9",
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  stopTaskBody: { flex: 1 },
  stopTaskTitle: { fontSize: 12, fontWeight: "700", color: "#171717" },
  stopTaskMeta: { marginTop: 1, fontSize: 10, color: "#737373" },
  openTask: { fontSize: 11, fontWeight: "800", color: "#171717" },
  moreTasks: { fontSize: 11, color: "#737373", fontWeight: "600" },
  button: { borderRadius: 8, backgroundColor: "#171717", paddingHorizontal: 10, paddingVertical: 8 },
  checkoutButton: { backgroundColor: "#166534" },
  buttonDisabled: { backgroundColor: "#d4d4d4" },
  buttonText: { color: "white", fontSize: 12, fontWeight: "700" },
})
