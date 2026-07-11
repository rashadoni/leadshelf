import { useMemo } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { SyncBar } from "../../../../src/components/SyncBar"
import { getBundle, listLocalPlanogramLibrary } from "../../../../src/db/local-store"
import { t } from "../../../../src/i18n"
import { PlanogramSvg, type Bundle } from "../../../../src/planogram/PlanogramSvg"
import { cardShadow, colors, radii } from "../../../../src/theme"

function resolveEquipmentIndex(bundle: Bundle | null, versionId: string, equipmentId: string): number {
  if (!bundle) return -1
  const exact = bundle.equipment.findIndex((item) => item.planogramEquipmentId === equipmentId)
  if (exact >= 0) return exact
  const fallback = Number(equipmentId.slice(`${versionId}-`.length))
  return Number.isInteger(fallback) && fallback >= 0 && fallback < bundle.equipment.length
    ? fallback
    : -1
}

export default function ShelfEquipmentScreen() {
  const { versionId, equipmentId } = useLocalSearchParams<{
    versionId: string
    equipmentId: string
  }>()
  const bundle = useMemo(() => getBundle(versionId) as Bundle | null, [versionId])
  const library = useMemo(() => listLocalPlanogramLibrary(), [])
  const equipmentIndex = resolveEquipmentIndex(bundle, versionId, equipmentId)
  const equipment = equipmentIndex >= 0 ? bundle?.equipment[equipmentIndex] ?? null : null
  const planogram = library.planograms.find((item) => item.versionId === versionId) ?? null
  const shelves = useMemo(
    () =>
      [...(equipment?.shelves ?? [])].sort(
        (a, b) => (a.shelfIndex ?? Number.MAX_SAFE_INTEGER) - (b.shelfIndex ?? Number.MAX_SAFE_INTEGER) || a.yMm - b.yMm,
      ),
    [equipment],
  )

  const dimensions = equipment
    ? `${equipment.widthMm} × ${equipment.heightMm}${equipment.depthMm != null ? ` × ${equipment.depthMm}` : ""} ${t("millimeterShort")}`
    : null

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
            {equipment?.name ?? t("equipment")}
          </Text>
          <Text style={styles.subtitle}>{t("equipmentStructureMode")}</Text>
        </View>
      </View>
      <SyncBar />

      {!bundle || !equipment ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t("equipmentUnavailable")}</Text>
          <Text style={styles.emptyHint}>{t("equipmentUnavailableHint")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.context}>
            <Text style={styles.contextLabel}>{t("planogram")}</Text>
            <Text style={styles.contextValue} numberOfLines={2}>
              {planogram?.name ?? t("planogram")}
              {planogram?.versionNumber != null
                ? ` · ${t("versionPrefix")} ${planogram.versionNumber}`
                : ""}
            </Text>
          </View>

          <View style={styles.metrics}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>{t("equipmentDimensions")}</Text>
              <Text style={styles.metricValue}>{dimensions}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>{t("shelfStructure")}</Text>
              <Text style={styles.metricValue}>
                {shelves.length} {t("shelfCountLabel")}
              </Text>
            </View>
          </View>

          <View style={styles.structureCard}>
            <PlanogramSvg bundle={bundle} equipmentIndex={equipmentIndex} showProducts={false} />
          </View>

          <Text style={styles.sectionTitle}>{t("shelfStructure")}</Text>
          <View style={styles.shelfList}>
            {shelves.map((shelf, index) => (
              <View
                key={shelf.id}
                style={[styles.shelfRow, index < shelves.length - 1 && styles.shelfRowBorder]}
              >
                <View style={styles.shelfNumber}>
                  <Text style={styles.shelfNumberText}>{shelf.shelfIndex != null ? shelf.shelfIndex + 1 : index + 1}</Text>
                </View>
                <View style={styles.shelfBody}>
                  <Text style={styles.shelfTitle}>
                    {t("shelf")} {shelf.shelfIndex != null ? shelf.shelfIndex + 1 : index + 1}
                  </Text>
                  <Text style={styles.shelfMeta}>
                    {t("heightFromFloor")}: {shelf.yMm} {t("millimeterShort")} · {t("shelfThickness")}: {shelf.thicknessMm} {t("millimeterShort")}
                  </Text>
                </View>
              </View>
            ))}
          </View>
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
  context: { paddingHorizontal: 2, paddingBottom: 12 },
  contextLabel: { color: colors.faint, fontSize: 11, fontWeight: "700" },
  contextValue: { color: colors.text, fontSize: 14, fontWeight: "800", marginTop: 3 },
  metrics: { flexDirection: "row", gap: 8, marginBottom: 12 },
  metric: {
    flex: 1,
    minHeight: 76,
    justifyContent: "center",
    padding: 12,
    borderRadius: radii.inner,
    backgroundColor: colors.card,
  },
  metricLabel: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  metricValue: { color: colors.text, fontSize: 14, fontWeight: "800", marginTop: 5 },
  structureCard: {
    overflow: "hidden",
    paddingVertical: 8,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    ...cardShadow,
  },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: 18, marginBottom: 8 },
  shelfList: { paddingHorizontal: 14, backgroundColor: colors.card, borderRadius: radii.card, ...cardShadow },
  shelfRow: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  shelfRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  shelfNumber: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.inner,
    backgroundColor: colors.primarySoft,
  },
  shelfNumberText: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  shelfBody: { flex: 1, minWidth: 0 },
  shelfTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  shelfMeta: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 36, gap: 8 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "800", textAlign: "center" },
  emptyHint: { color: colors.muted, fontSize: 14, textAlign: "center" },
  pressed: { opacity: 0.72 },
})
