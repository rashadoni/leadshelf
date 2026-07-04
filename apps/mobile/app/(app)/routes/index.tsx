import { useCallback, useState } from "react"
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import * as Crypto from "expo-crypto"
import { router, useFocusEffect } from "expo-router"
import { SyncBar } from "../../../src/components/SyncBar"
import {
  enqueueVisitCheckIn,
  getStore,
  listRouteStops,
  listRoutes,
  listTasks,
} from "../../../src/db/local-store"
import type { RouteRow } from "../../../src/sync/ports"
import { t } from "../../../src/i18n"

export default function RoutesScreen() {
  const [routes, setRoutes] = useState<RouteRow[]>([])
  const [queued, setQueued] = useState<string | null>(null)
  const reload = useCallback(() => setRoutes(listRoutes()), [])
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
              const canCheckIn = Boolean(item.agentId && store?.latitude != null && store.longitude != null)
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
                  </View>
                  <Pressable
                    disabled={!canCheckIn}
                    onPress={() => checkIn(item, stop.id, stop.storeId)}
                    style={[styles.button, !canCheckIn && styles.buttonDisabled]}
                  >
                    <Text style={styles.buttonText}>
                      {queued === stop.storeId ? t("queued") : t("checkIn")}
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
  button: { borderRadius: 8, backgroundColor: "#171717", paddingHorizontal: 10, paddingVertical: 8 },
  buttonDisabled: { backgroundColor: "#d4d4d4" },
  buttonText: { color: "white", fontSize: 12, fontWeight: "700" },
})
