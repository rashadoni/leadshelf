import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router } from "expo-router"
import { TabIcon, type TabIconName } from "../../../src/components/TabIcon"
import { t, useLocale, type MessageKey } from "../../../src/i18n"
import { cardShadow, colors, radii } from "../../../src/theme"

const ITEMS: Array<{ icon: TabIconName; key: MessageKey; href: string }> = [
  { icon: "visit", key: "tabVisit", href: "/(app)/(tabs)/visit" },
  { icon: "orders", key: "tabOrders", href: "/(app)/(tabs)/orders" },
  { icon: "profile", key: "tabProfile", href: "/(app)/(tabs)/profile" },
]

export default function MoreTab() {
  useLocale()
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("tabMore")}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {ITEMS.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            onPress={() => router.push(item.href as never)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.icon}>
              <TabIcon name={item.icon} color={colors.primary} />
            </View>
            <Text style={styles.label}>{t(item.key)}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "800", color: colors.text },
  list: { paddingHorizontal: 14, paddingVertical: 8, gap: 10 },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    ...cardShadow,
  },
  rowPressed: { backgroundColor: colors.primarySoft },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radii.inner,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  label: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.text },
  chevron: { color: colors.faint, fontSize: 26, fontWeight: "600" },
})
