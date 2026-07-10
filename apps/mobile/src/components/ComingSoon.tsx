import { StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { t } from "../i18n"

// Заглушка для разделов, экраны которых ещё не реализованы (Vizit, Planoqram,
// İcmal, Sifarişlər). Единый дружелюбный вид вместо пустоты.
export function ComingSoon({ emoji, title }: { emoji: string; title: string }) {
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.body}>
        <Text style={styles.emoji}>{emoji}</Text>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{t("sectionSoon")}</Text>
        </View>
        <Text style={styles.note}>{t("sectionSoonBody")}</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f5f5f4" },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 },
  emoji: { fontSize: 60 },
  title: { fontSize: 22, fontWeight: "800", color: "#1c1917" },
  badge: { backgroundColor: "#e7e5e4", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: "700", color: "#57534e", textTransform: "uppercase", letterSpacing: 0.5 },
  note: { fontSize: 14, color: "#a8a29e", textAlign: "center" },
})
