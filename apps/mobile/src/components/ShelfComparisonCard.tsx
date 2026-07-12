import { useMemo, useState } from "react"
import { Image, Pressable, StyleSheet, Text, View } from "react-native"
import type { MobileShelfComparisonResult } from "@leadshelf/api-contracts/mobile/v1"
import { t, type MessageKey } from "../i18n"
import { cardShadow, colors, radii } from "../theme"

type Tab = "scheme" | "photo" | "result"

export function ShelfComparisonCard({
  result,
  photoUri,
}: {
  result: MobileShelfComparisonResult
  photoUri: string | null
}) {
  const [tab, setTab] = useState<Tab>("result")
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const shelves = useMemo(() => {
    const grouped = new Map<string, MobileShelfComparisonResult["placements"]>()
    for (const placement of result.placements) {
      const key = placement.shelfId ?? "unassigned"
      grouped.set(key, [...(grouped.get(key) ?? []), placement])
    }
    return [...grouped.values()]
  }, [result.placements])

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>{t("comparisonTitle")}</Text>
          <Text style={styles.title}>{t(`comparisonStatus_${result.status}` as MessageKey)}</Text>
        </View>
        <Text style={styles.score}>
          {result.structuralScore == null ? "—" : `${Math.round(result.structuralScore)}%`}
        </Text>
      </View>
      <View style={styles.tabs}>
        {(["scheme", "photo", "result"] as const).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === item }}
            onPress={() => setTab(item)}
            style={[styles.tab, tab === item && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === item && styles.tabTextActive]}>
              {t(`comparisonTab_${item}` as MessageKey)}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === "scheme" ? (
        <View style={styles.body}>
          <Text style={styles.hint}>{t("comparisonSchemeHint")}</Text>
          {shelves.map((placements, shelfIndex) => (
            <View key={`${placements[0]?.shelfId ?? "shelf"}-${shelfIndex}`} style={styles.shelfBlock}>
              <Text style={styles.shelfLabel}>{t("shelf")} {shelfIndex + 1}</Text>
              <View style={styles.placements}>
                {placements.map((placement) => {
                  const selected = selectedPlacementId === placement.placementId
                  return (
                    <Pressable
                      key={placement.placementId}
                      onPress={() => setSelectedPlacementId(selected ? null : placement.placementId)}
                      style={[
                        styles.placement,
                        placement.outcome === "matched" ? styles.placementGood : styles.placementIssue,
                        selected && styles.placementSelected,
                      ]}
                    >
                      <Text style={styles.placementSku}>{placement.productSku ?? placement.productName}</Text>
                      <Text style={styles.placementMeta}>
                        {t("comparisonPlanFact", {
                          expected: placement.expectedFacings,
                          actual: placement.actualFacings ?? "—",
                        })}
                      </Text>
                      <Text style={styles.placementOutcome}>
                        {t(`comparisonOutcome_${placement.outcome}` as MessageKey)}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
              <View style={styles.shelfLine} />
            </View>
          ))}
        </View>
      ) : null}

      {tab === "photo" ? (
        <View style={[styles.body, styles.photoBody]}>
          {photoUri ? (
            <View style={styles.photoFrame}>
              <Image source={{ uri: photoUri }} resizeMode="contain" style={styles.photo} />
              {result.detections.filter((detection) => detection.bbox != null).map((detection) => {
                const bbox = detection.bbox!
                const selected = detection.placementId != null && detection.placementId === selectedPlacementId
                return (
                  <Pressable
                    key={detection.detectionId}
                    onPress={() => setSelectedPlacementId(detection.placementId)}
                    style={[
                      styles.box,
                      {
                        left: `${bbox.xPct}%`,
                        top: `${bbox.yPct}%`,
                        width: `${bbox.widthPct}%`,
                        height: `${bbox.heightPct}%`,
                      },
                      selected && styles.boxSelected,
                    ]}
                  />
                )
              })}
            </View>
          ) : (
            <Text style={styles.photoEmpty}>{t("comparisonPhotoUnavailable")}</Text>
          )}
        </View>
      ) : null}

      {tab === "result" ? (
        <View style={styles.body}>
          <Text style={styles.hint}>{t("comparisonActionsHint")}</Text>
          {result.actions.length === 0 ? (
            <View style={styles.noActions}><Text style={styles.noActionsText}>{t("comparisonNoActions")}</Text></View>
          ) : (
            <View style={styles.actions}>
              {result.actions.map((action, index) => (
                <View key={`${action.type}-${action.placementId}-${index}`} style={styles.actionRow}>
                  <Text style={styles.actionTitle}>{t(`comparisonAction_${action.type}` as MessageKey)}</Text>
                  <Text style={styles.actionMeta}>
                    {action.productSku ?? t("comparisonUnknownSku")}
                    {action.amount == null ? "" : ` · ${action.amount}`}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.metrics}>
            <Metric label={t("comparisonStructuralScore")} value={result.structuralScore == null ? "—" : `${Math.round(result.structuralScore)}%`} />
            <Metric label={t("comparisonVisualConfidence")} value={result.visualConfidence == null ? "—" : `${Math.round(result.visualConfidence * 100)}%`} />
          </View>
        </View>
      ) : null}
    </View>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, overflow: "hidden", ...cardShadow },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14 },
  eyebrow: { color: colors.muted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  title: { marginTop: 3, color: colors.text, fontSize: 16, fontWeight: "800" },
  score: { color: colors.primary, fontSize: 24, fontWeight: "900" },
  tabs: { flexDirection: "row", gap: 4, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, padding: 6 },
  tab: { flex: 1, minHeight: 40, borderRadius: radii.inner, alignItems: "center", justifyContent: "center" },
  tabActive: { backgroundColor: colors.primary },
  tabText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  tabTextActive: { color: colors.headerText },
  body: { padding: 12, gap: 10 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  shelfBlock: { gap: 6 },
  shelfLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  placements: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  placement: { minWidth: "47%", flexGrow: 1, borderRadius: radii.inner, borderWidth: 1, padding: 9 },
  placementGood: { backgroundColor: colors.successBg, borderColor: colors.successBorder },
  placementIssue: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
  placementSelected: { borderColor: colors.primary, borderWidth: 2 },
  placementSku: { color: colors.text, fontSize: 12, fontWeight: "800" },
  placementMeta: { marginTop: 3, color: colors.muted, fontSize: 10 },
  placementOutcome: { marginTop: 3, color: colors.text, fontSize: 10, fontWeight: "700" },
  shelfLine: { height: 3, borderRadius: radii.pill, backgroundColor: colors.disabled },
  photoBody: { backgroundColor: colors.text, minHeight: 220, justifyContent: "center" },
  photoFrame: { width: "100%", aspectRatio: 4 / 3, position: "relative", backgroundColor: colors.text },
  photo: { width: "100%", height: "100%" },
  photoEmpty: { color: colors.headerText, textAlign: "center", fontSize: 13 },
  box: { position: "absolute", borderWidth: 2, borderColor: colors.warning, backgroundColor: "transparent" },
  boxSelected: { borderColor: colors.primary, borderWidth: 3 },
  actions: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.inner, overflow: "hidden" },
  actionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  actionTitle: { flex: 1, color: colors.text, fontSize: 12, fontWeight: "800" },
  actionMeta: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  noActions: { borderRadius: radii.inner, backgroundColor: colors.successBg, padding: 10 },
  noActionsText: { color: colors.successDark, fontSize: 12, fontWeight: "700" },
  metrics: { flexDirection: "row", gap: 8 },
  metric: { flex: 1, borderRadius: radii.inner, backgroundColor: colors.bg, padding: 10 },
  metricLabel: { color: colors.muted, fontSize: 10 },
  metricValue: { marginTop: 3, color: colors.text, fontSize: 17, fontWeight: "900" },
})
