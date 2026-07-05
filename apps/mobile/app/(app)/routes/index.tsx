import { useCallback, useState } from "react"
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import * as Crypto from "expo-crypto"
import { router, useFocusEffect } from "expo-router"
import { SyncBar } from "../../../src/components/SyncBar"
import {
  enqueueVisitCheckIn,
  enqueueVisitCheckOut,
  getStore,
  listRouteStops,
  listRoutes,
  listTasks,
  listVisits,
} from "../../../src/db/local-store"
import type { RouteRow, VisitRow } from "../../../src/sync/ports"
import { useSync } from "../../../src/sync/sync-context"
import { t } from "../../../src/i18n"

export default function RoutesScreen() {
  const { sync } = useSync()
  const [routes, setRoutes] = useState<RouteRow[]>([])
  const [visits, setVisits] = useState<VisitRow[]>([])
  const [queued, setQueued] = useState<string | null>(null)
  const reload = useCallback(() => {
    setRoutes(listRoutes())
    setVisits(listVisits())
  }, [])
  useFocusEffect(reload)

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
    setQueued(storeId)
    void sync()
  }

  function checkOut(visit: VisitRow) {
    enqueueVisitCheckOut({
      clientOpId: `op-${Crypto.randomUUID()}`,
      visitId: visit.id,
    })
    setQueued(visit.storeId)
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
        contentContainerStyle={routes.length === 0 && styles.emptyWrap}
        ListEmptyComponent={<Text style={styles.empty}>{t("noRoutes")}</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.routeTitle}>{item.name}</Text>
            {listRouteStops(item.id).map((stop) => {
              const store = getStore(stop.storeId)
              const tasks = listTasks().filter((task) => task.storeId === stop.storeId)
              const stopVisits = visits.filter((visit) => visit.routeStopId === stop.id)
              const activeVisit = stopVisits.find((visit) => visit.status === "IN_PROGRESS")
              const completedVisit = stopVisits.find((visit) => visit.status === "COMPLETED")
              const canCheckIn = Boolean(item.agentId && store?.latitude != null && store.longitude != null)
              const disabled = activeVisit ? false : !canCheckIn || Boolean(completedVisit)
              return (
                <View key={stop.id} style={styles.stop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stopTitle}>
                      {stop.sortOrder}. {store?.name ?? stop.storeId}
                    </Text>
                    <Text style={styles.meta}>
                      {tasks.length} {t("tasksAtStore")}
                      {store?.address ? ` · ${store.address}` : ""}
                    </Text>
                    {activeVisit ? (
                      <Text style={styles.visitMeta}>{t("visitInProgress")}</Text>
                    ) : completedVisit ? (
                      <Text style={styles.visitMeta}>{t("visitCompleted")}</Text>
                    ) : null}
                    {tasks.length > 0 ? (
                      <View style={styles.stopTasks}>
                        {tasks.slice(0, 4).map((task) => (
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
                        {tasks.length > 4 ? (
                          <Text style={styles.moreTasks}>
                            +{tasks.length - 4} {t("moreTasks")}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                  <Pressable
                    disabled={disabled}
                    onPress={() => (activeVisit ? checkOut(activeVisit) : checkIn(item, stop.id, stop.storeId))}
                    style={[styles.button, activeVisit && styles.checkoutButton, disabled && styles.buttonDisabled]}
                  >
                    <Text style={styles.buttonText}>
                      {queued === stop.storeId
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
  routeTitle: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
  stop: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: "#f5f5f4", paddingVertical: 10 },
  stopTitle: { fontSize: 14, fontWeight: "600" },
  meta: { fontSize: 12, color: "#737373", marginTop: 2 },
  visitMeta: { fontSize: 12, color: "#166534", fontWeight: "600", marginTop: 4 },
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
