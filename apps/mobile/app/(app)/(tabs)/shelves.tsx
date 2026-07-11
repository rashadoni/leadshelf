import { useCallback, useEffect, useState } from "react"
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect } from "expo-router"
import { SyncBar } from "../../../src/components/SyncBar"
import { SectionHint } from "../../../src/components/SectionHint"
import { listLocalPlanogramLibrary } from "../../../src/db/local-store"
import { t, useLocale } from "../../../src/i18n"
import type { LocalEquipmentSummary } from "../../../src/planogram/local-library"
import { useSync } from "../../../src/sync/sync-context"
import { cardShadow, colors, radii } from "../../../src/theme"

function dimensions(item: LocalEquipmentSummary): string | null {
  if (item.widthMm == null || item.heightMm == null) return null
  return item.depthMm == null
    ? `${item.widthMm} × ${item.heightMm} ${t("millimeterShort")}`
    : `${item.widthMm} × ${item.heightMm} × ${item.depthMm} ${t("millimeterShort")}`
}

export default function ShelvesTab() {
  useLocale()
  const { status, sync } = useSync()
  const [items, setItems] = useState<LocalEquipmentSummary[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const reload = useCallback(() => setItems(listLocalPlanogramLibrary().equipment), [])
  useFocusEffect(reload)

  useEffect(() => {
    if (status.phase === "idle") reload()
  }, [reload, status.lastSyncAt, status.phase])

  async function onRefresh() {
    setRefreshing(true)
    try {
      await sync()
      reload()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("tabShelves")}</Text>
      </View>
      <SyncBar />
      <SectionHint section="shelves" icon="shelves" titleKey="shelvesHintTitle" bodyKey="shelvesHintBody" />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("shelvesEmpty")}</Text>
            <Text style={styles.emptyHint}>{t("shelvesEmptyHint")}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const size = dimensions(item)
          return (
            <Pressable
              accessibilityRole="button"
              disabled={!item.taskId}
              onPress={() => router.push(`/(app)/tasks/${item.taskId}` as never)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <Text style={styles.cardTitle}>{item.name ?? t("equipment")}</Text>
              <Text style={styles.planogramName}>{item.planogramName ?? t("planogram")}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.meta}>{item.shelfCount} {t("shelfCountLabel")}</Text>
                {size ? <Text style={styles.meta}>{size}</Text> : null}
              </View>
              <Text style={styles.open}>{t("openPlanogram")}</Text>
            </Pressable>
          )
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text },
  list: { paddingHorizontal: 14, paddingVertical: 8, paddingBottom: 24, gap: 10 },
  emptyWrap: { flexGrow: 1, justifyContent: "center" },
  empty: { alignItems: "center", paddingHorizontal: 36, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.text, textAlign: "center" },
  emptyHint: { fontSize: 14, color: colors.muted, textAlign: "center" },
  card: { backgroundColor: colors.card, borderRadius: radii.card, padding: 16, ...cardShadow },
  cardPressed: { opacity: 0.76 },
  cardTitle: { fontSize: 17, fontWeight: "800", color: colors.text },
  planogramName: { marginTop: 4, color: colors.muted, fontSize: 13 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  meta: { color: colors.faint, fontSize: 12, fontWeight: "600" },
  open: { marginTop: 12, color: colors.primary, fontSize: 13, fontWeight: "800" },
})
