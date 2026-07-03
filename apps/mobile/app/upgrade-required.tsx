import { StyleSheet, Text, View } from "react-native"
import { t } from "../src/i18n"

export default function UpgradeRequired() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t("upgradeTitle")}</Text>
      <Text style={styles.body}>{t("upgradeBody")}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 8 },
  title: { fontSize: 20, fontWeight: "700" },
  body: { textAlign: "center", color: "#737373" },
})
