import { Camera, Map, Marker } from "@maplibre/maplibre-react-native"
import { StyleSheet, Text, View } from "react-native"
import type { ManagerTeamMapPoint, ManagerTeamMapViewport } from "../field/manager-location-map"
import { colors, radii } from "../theme"

const DEFAULT_MAP_STYLE = "https://tiles.openfreemap.org/styles/positron"

function markerTone(point: ManagerTeamMapPoint): { background: string; border: string } {
  if (point.evidence === "LIVE") return { background: colors.success, border: colors.card }
  if (point.freshness === "DELAYED") return { background: colors.warning, border: colors.card }
  return { background: colors.draft, border: colors.card }
}

export function ManagerTeamMap({
  points,
  viewport,
  selectedAgentId,
  onSelect,
  accessibilityLabel,
  liveLabel,
  delayedLabel,
  staleLabel,
}: {
  points: readonly ManagerTeamMapPoint[]
  viewport: ManagerTeamMapViewport
  selectedAgentId: string | null
  onSelect: (agentId: string) => void
  accessibilityLabel: string
  liveLabel: string
  delayedLabel: string
  staleLabel: string
}) {
  const mapStyle = process.env.EXPO_PUBLIC_MAP_STYLE_URL?.trim() || DEFAULT_MAP_STYLE
  const frameKey = points
    .map((point) => `${point.agentId}:${point.longitude}:${point.latitude}`)
    .sort()
    .join("|")

  return (
    <View style={styles.frame}>
      <Map attribution key={frameKey} mapStyle={mapStyle} style={styles.map}>
        <Camera initialViewState={{ center: viewport.center, zoom: viewport.zoom }} />
        {points.map((point) => {
          const tone = markerTone(point)
          const selected = selectedAgentId === point.agentId
          const evidenceLabel = point.evidence === "LIVE"
            ? liveLabel
            : point.freshness === "DELAYED"
              ? delayedLabel
              : staleLabel
          return (
            <Marker
              key={point.agentId}
              id={point.agentId}
              lngLat={[point.longitude, point.latitude]}
              onPress={() => onSelect(point.agentId)}
            >
              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel={`${point.name}. ${evidenceLabel}`}
                style={[
                  styles.marker,
                  { backgroundColor: tone.background, borderColor: tone.border },
                  selected && styles.markerSelected,
                ]}
              >
                <Text style={styles.markerText}>{point.name.charAt(0).toUpperCase()}</Text>
              </View>
            </Marker>
          )
        })}
      </Map>
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${accessibilityLabel}. ${liveLabel}, ${delayedLabel}, ${staleLabel}`}
        pointerEvents="none"
        style={styles.legend}
      >
        <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
        <Text style={styles.legendText}>{liveLabel}</Text>
        <View style={[styles.legendDot, { backgroundColor: colors.warning }]} />
        <Text style={styles.legendText}>{delayedLabel}</Text>
        <View style={[styles.legendDot, { backgroundColor: colors.draft }]} />
        <Text style={styles.legendText}>{staleLabel}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    minHeight: 280,
    overflow: "hidden",
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  map: { flex: 1, minHeight: 280 },
  marker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  markerSelected: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 4,
    shadowColor: colors.navy,
    shadowOpacity: 0.22,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  markerText: { color: colors.headerText, fontSize: 13, fontWeight: "900" },
  legend: {
    position: "absolute",
    left: 10,
    right: 10,
    top: 10,
    minHeight: 38,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.cardOverlay,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.text, fontSize: 11, fontWeight: "800", marginRight: 3 },
})
