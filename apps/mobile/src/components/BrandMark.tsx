import { StyleSheet, Text, View } from "react-native"
import Svg, { Path, Rect } from "react-native-svg"
import { colors } from "../theme"
import { IS_LEADDRIVE_FIELD, mobileVariant } from "../config/mobile-variant"

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const size = compact ? 36 : 48
  return (
    <View style={styles.row}>
      <View style={[styles.mark, { width: size, height: size, borderRadius: compact ? 10 : 13 }]}>
        <Svg width={compact ? 22 : 28} height={compact ? 22 : 28} viewBox="0 0 28 28" fill="none">
          <Rect x="4" y="4" width="20" height="20" rx="5" stroke="#FFFFFF" strokeWidth="2" />
          <Path d="M8 10h12M8 15h12M8 20h12M10 7v15M18 7v15" stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" />
        </Svg>
      </View>
      {!compact ? (
        <View>
          <Text style={styles.name}>{mobileVariant.appName}</Text>
          <Text style={styles.tagline}>{IS_LEADDRIVE_FIELD ? "ZEYTUNPHARM · MTM" : "RETAIL EXECUTION"}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  mark: { backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  name: { color: colors.text, fontSize: 24, fontWeight: "900", letterSpacing: -0.7 },
  tagline: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.7, marginTop: 2 },
})
