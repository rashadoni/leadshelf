import { useCallback, useEffect, useState } from "react"
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router, useFocusEffect } from "expo-router"
import { SyncBar } from "../../../src/components/SyncBar"
import { SectionHint } from "../../../src/components/SectionHint"
import { listLocalPlanogramLibrary } from "../../../src/db/local-store"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { t, useLocale } from "../../../src/i18n"
import type { LocalPlanogramSummary } from "../../../src/planogram/local-library"
import { useSync } from "../../../src/sync/sync-context"
import { cardShadow, colors, radii } from "../../../src/theme"

export default function PlanogramsTab() {
  const locale = useLocale()
  const { status, sync } = useSync()
  const [items, setItems] = useState<LocalPlanogramSummary[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const reload = useCallback(() => setItems(listLocalPlanogramLibrary().planograms), [])
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
        <Text style={styles.title}>{t("tabPlanograms")}</Text>
        <Text style={styles.subtitle}>{t("planogramsSectionSubtitle")}</Text>
      </View>
      <SyncBar />
      <SectionHint section="planograms" icon="planograms" titleKey="planogramsHintTitle" bodyKey="planogramsHintBody" />
      <FlatList
        data={items}
        keyExtractor={(item) => item.versionId}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("planogramsEmpty")}</Text>
            <Text style={styles.emptyHint}>{t("planogramsEmptyHint")}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/(app)/planograms/${item.versionId}` as never)}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.name ?? t("planogram")}
              </Text>
              {item.versionNumber != null ? (
                <Text style={styles.version}>{t("versionPrefix")} {item.versionNumber}</Text>
              ) : null}
            </View>
            <Text style={styles.meta}>
              {item.equipmentCount} {t("equipmentCountLabel")} · {item.shelfCount} {t("shelfCountLabel")} · {item.productCount} {t("productCountLabel")}
            </Text>
            {item.publishedAt ? (
              <Text style={styles.date}>{formatShortDateTime(item.publishedAt, locale)}</Text>
            ) : null}
            <Text style={styles.open}>{t("openPlanogram")}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text },
  subtitle: { marginTop: 3, color: colors.muted, fontSize: 12, fontWeight: "600" },
  list: { paddingHorizontal: 14, paddingVertical: 8, paddingBottom: 24, gap: 10 },
  emptyWrap: { flexGrow: 1, justifyContent: "center" },
  empty: { alignItems: "center", paddingHorizontal: 36, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.text, textAlign: "center" },
  emptyHint: { fontSize: 14, color: colors.muted, textAlign: "center" },
  card: { backgroundColor: colors.card, borderRadius: radii.card, padding: 16, ...cardShadow },
  cardPressed: { opacity: 0.76 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  cardTitle: { flex: 1, fontSize: 17, fontWeight: "800", color: colors.text },
  version: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  meta: { marginTop: 8, color: colors.muted, fontSize: 12, lineHeight: 18 },
  date: { marginTop: 4, color: colors.faint, fontSize: 11 },
  open: { marginTop: 12, color: colors.primary, fontSize: 13, fontWeight: "800" },
})
