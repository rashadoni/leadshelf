import { Pressable, ScrollView, StyleSheet, Text } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router } from "expo-router"
import { t, type MessageKey } from "../../../src/i18n"

// «Ещё»: разделы, не поместившиеся в 5 основных вкладок. href-ы ведут на
// скрытые (href:null) экраны того же таб-навигатора.
const ITEMS: Array<{ emoji: string; key: MessageKey; href: string }> = [
  { emoji: "📊", key: "tabDashboard", href: "/(app)/(tabs)/dashboard" },
  { emoji: "🧾", key: "tabOrders", href: "/(app)/(tabs)/orders" },
  { emoji: "👤", key: "tabProfile", href: "/(app)/(tabs)/profile" },
]

export default function MoreScreen() {
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Text style={styles.title}>{t("moreTitle")}</Text>
      <ScrollView contentContainerStyle={styles.list}>
        {ITEMS.map((item) => (
          <Pressable
            key={item.key}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => router.push(item.href as never)}
          >
            <Text style={styles.rowEmoji}>{item.emoji}</Text>
            <Text style={styles.rowLabel}>{t(item.key)}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f5f5f4" },
  title: { fontSize: 26, fontWeight: "800", color: "#1c1917", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  list: { paddingVertical: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "white",
    marginHorizontal: 12,
    marginVertical: 5,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#eeece9",
  },
  rowPressed: { backgroundColor: "#fafaf9", borderColor: "#e7e5e4" },
  rowEmoji: { fontSize: 24 },
  rowLabel: { flex: 1, fontSize: 17, fontWeight: "700", color: "#1c1917" },
  chevron: { fontSize: 28, color: "#d6d3d1", fontWeight: "700" },
})
