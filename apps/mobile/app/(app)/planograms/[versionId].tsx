import { useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { SyncBar } from "../../../src/components/SyncBar"
import { getBundle, listLocalPlanogramLibrary } from "../../../src/db/local-store"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { t, useLocale } from "../../../src/i18n"
import { listPlacementSummaries } from "../../../src/planogram/bundle-utils"
import { PlanogramSvg, type Bundle } from "../../../src/planogram/PlanogramSvg"
import { cardShadow, colors, radii } from "../../../src/theme"

function initialEquipmentIndex(bundle: Bundle | null, versionId: string, equipmentId?: string): number {
  if (!bundle || !equipmentId) return 0
  const exact = bundle.equipment.findIndex((item) => item.planogramEquipmentId === equipmentId)
  if (exact >= 0) return exact
  const fallbackIndex = Number(equipmentId.slice(`${versionId}-`.length))
  return Number.isInteger(fallbackIndex) && fallbackIndex >= 0 && fallbackIndex < bundle.equipment.length
    ? fallbackIndex
    : 0
}

export default function PlanogramViewerScreen() {
  const { versionId, equipmentId } = useLocalSearchParams<{
    versionId: string
    equipmentId?: string
  }>()
  const locale = useLocale()
  const bundle = useMemo(() => getBundle(versionId) as Bundle | null, [versionId])
  const summary = useMemo(
    () => listLocalPlanogramLibrary().planograms.find((item) => item.versionId === versionId) ?? null,
    [versionId],
  )
  const [equipmentIndex, setEquipmentIndex] = useState(() =>
    initialEquipmentIndex(bundle, versionId, equipmentId),
  )
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)

  const equipment = bundle?.equipment[equipmentIndex] ?? null
  const placements = useMemo(() => {
    if (!bundle || !equipment) return []
    const shelfIds = new Set(equipment.shelves.map((shelf) => shelf.id))
    return listPlacementSummaries(bundle).filter((item) =>
      item.placement.shelfId ? shelfIds.has(item.placement.shelfId) : false,
    )
  }, [bundle, equipment])
  const selectedPlacement =
    placements.find((item) => item.placementId === selectedPlacementId) ?? placements[0] ?? null

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("back")}
          hitSlop={12}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backIcon}>‹</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {summary?.name ?? t("planogram")}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {t("planogramReferenceMode")}
            {summary?.versionNumber != null
              ? ` · ${t("versionPrefix")} ${summary.versionNumber}`
              : ""}
          </Text>
        </View>
      </View>
      <SyncBar />

      {!bundle || !equipment ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t("planogramUnavailable")}</Text>
          <Text style={styles.emptyHint}>{t("planogramUnavailableHint")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryText}>
              {summary?.equipmentCount ?? bundle.equipment.length} {t("equipmentCountLabel")} · {summary?.shelfCount ?? equipment.shelves.length} {t("shelfCountLabel")} · {summary?.productCount ?? bundle.placements.length} {t("productCountLabel")}
            </Text>
            {summary?.publishedAt ? (
              <Text style={styles.date}>{formatShortDateTime(summary.publishedAt, locale)}</Text>
            ) : null}
          </View>

          {bundle.equipment.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.equipmentTabs}
            >
              {bundle.equipment.map((item, index) => {
                const active = index === equipmentIndex
                return (
                  <Pressable
                    key={item.planogramEquipmentId ?? `${versionId}-${index}`}
                    accessibilityRole="button"
                    onPress={() => {
                      setEquipmentIndex(index)
                      setSelectedPlacementId(null)
                    }}
                    style={({ pressed }) => [
                      styles.equipmentTab,
                      active && styles.equipmentTabActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.equipmentTabText, active && styles.equipmentTabTextActive]}
                    >
                      {item.name ?? t("equipment")}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          ) : null}

          <View style={styles.equipmentBar}>
            <View style={styles.equipmentBarText}>
              <Text style={styles.equipmentLabel}>{t("equipment")}</Text>
              <Text style={styles.equipmentTitle} numberOfLines={1}>
                {equipment.name ?? t("equipment")}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/(app)/shelves/[versionId]/[equipmentId]",
                  params: {
                    versionId,
                    equipmentId: equipment.planogramEquipmentId ?? `${versionId}-${equipmentIndex}`,
                  },
                } as never)
              }
              style={({ pressed }) => [styles.structureButton, pressed && styles.pressed]}
            >
              <Text style={styles.structureButtonText}>{t("openEquipmentStructure")}</Text>
            </Pressable>
          </View>

          <View style={styles.planogramCard}>
            <PlanogramSvg
              bundle={bundle}
              equipmentIndex={equipmentIndex}
              selectedPlacementId={selectedPlacement?.placementId ?? null}
              onPlacementPress={setSelectedPlacementId}
            />
          </View>
          <Text style={styles.tapHint}>{t("planogramTapProduct")}</Text>

          {selectedPlacement ? (
            <View style={styles.productCard}>
              <Text style={styles.productTitle}>{selectedPlacement.name}</Text>
              <Text style={styles.productMeta}>
                {selectedPlacement.sku}
                {selectedPlacement.brandName ? ` · ${selectedPlacement.brandName}` : ""}
              </Text>
              <View style={styles.detailGrid}>
                <Text style={styles.detailLabel}>{t("shelf")}</Text>
                <Text style={styles.detailValue}>{selectedPlacement.shelfLabel}</Text>
                <Text style={styles.detailLabel}>{t("dimensions")}</Text>
                <Text style={styles.detailValue}>{selectedPlacement.dimensionsLabel}</Text>
                <Text style={styles.detailLabel}>{t("facings")}</Text>
                <Text style={styles.detailValue}>{selectedPlacement.facingsLabel}</Text>
                <Text style={styles.detailLabel}>{t("units")}</Text>
                <Text style={styles.detailValue}>{selectedPlacement.totalUnits}</Text>
                <Text style={styles.detailLabel}>{t("barcode")}</Text>
                <Text style={styles.detailValue}>{selectedPlacement.barcode ?? "—"}</Text>
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.card,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.inner,
    backgroundColor: colors.primarySoft,
  },
  backIcon: { color: colors.primary, fontSize: 32, lineHeight: 34, fontWeight: "500" },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 18, fontWeight: "800" },
  subtitle: { color: colors.muted, fontSize: 12, fontWeight: "600", marginTop: 2 },
  content: { padding: 12, paddingBottom: 32 },
  summaryRow: { paddingHorizontal: 2, paddingBottom: 12 },
  summaryText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  date: { color: colors.faint, fontSize: 11, marginTop: 4 },
  equipmentTabs: { gap: 8, paddingBottom: 12 },
  equipmentTab: {
    maxWidth: 220,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
  },
  equipmentTabActive: { backgroundColor: colors.primary },
  equipmentTabText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  equipmentTabTextActive: { color: colors.headerText },
  equipmentBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  equipmentBarText: { flex: 1, minWidth: 0 },
  equipmentLabel: { color: colors.faint, fontSize: 10, fontWeight: "700" },
  equipmentTitle: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 2 },
  structureButton: {
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: radii.inner,
    backgroundColor: colors.primarySoft,
  },
  structureButtonText: { color: colors.primary, fontSize: 11, fontWeight: "800" },
  planogramCard: {
    overflow: "hidden",
    paddingVertical: 8,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    ...cardShadow,
  },
  tapHint: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 10 },
  productCard: {
    marginTop: 14,
    padding: 16,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    ...cardShadow,
  },
  productTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  productMeta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  detailGrid: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 9,
  },
  detailLabel: { width: "34%", color: colors.muted, fontSize: 12 },
  detailValue: { width: "66%", color: colors.text, fontSize: 12, fontWeight: "700" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36, gap: 8 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "800", textAlign: "center" },
  emptyHint: { color: colors.muted, fontSize: 14, textAlign: "center" },
  pressed: { opacity: 0.72 },
})
