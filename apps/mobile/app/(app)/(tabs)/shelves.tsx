import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native"
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
  const locale = useLocale()
  const { status, sync } = useSync()
  const [items, setItems] = useState<LocalEquipmentSummary[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const reload = useCallback(() => setItems(listLocalPlanogramLibrary().equipment), [])
  useFocusEffect(reload)

  const sections = useMemo(() => {
    const grouped = new Map<string, LocalEquipmentSummary[]>()
    for (const item of items) {
      const title = item.planogramName ?? t("planogram")
      grouped.set(title, [...(grouped.get(title) ?? []), item])
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b, locale))
      .map(([title, data]) => ({ title, data }))
  }, [items, locale])

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
        <Text style={styles.subtitle}>{t("shelvesSectionSubtitle")}</Text>
      </View>
      <SyncBar />
      <SectionHint section="shelves" icon="shelves" titleKey="shelvesHintTitle" bodyKey="shelvesHintBody" />
      <SectionList
        sections={sections}
        keyExtractor={(item) => `${item.versionId}:${item.id}`}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("shelvesEmpty")}</Text>
            <Text style={styles.emptyHint}>{t("shelvesEmptyHint")}</Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle} numberOfLines={2}>{section.title}</Text>
        )}
        renderItem={({ item }) => {
          const size = dimensions(item)
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/(app)/shelves/[versionId]/[equipmentId]",
                  params: { versionId: item.versionId, equipmentId: item.id },
                } as never)
              }
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.icon}>
                <Text style={styles.iconText}>{item.shelfCount}</Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.name ?? t("equipment")}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.shelfCount} {t("shelfCountLabel")}{size ? ` · ${size}` : ""}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
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
  subtitle: { marginTop: 3, color: colors.muted, fontSize: 12, fontWeight: "600" },
  list: { paddingVertical: 4, paddingBottom: 24 },
  emptyWrap: { flexGrow: 1, justifyContent: "center" },
  empty: { alignItems: "center", paddingHorizontal: 36, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.text, textAlign: "center" },
  emptyHint: { fontSize: 14, color: colors.muted, textAlign: "center" },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 7,
  },
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    ...cardShadow,
  },
  rowPressed: { opacity: 0.72 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radii.inner,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  iconText: { color: colors.primary, fontSize: 14, fontWeight: "800" },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  meta: { color: colors.muted, fontSize: 11, fontWeight: "600", marginTop: 4 },
  chevron: { color: colors.faint, fontSize: 25, fontWeight: "600" },
})
