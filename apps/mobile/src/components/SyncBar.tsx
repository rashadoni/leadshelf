// Offline-доверие как UX (docs/10 Tier-1 №4): статус синка виден всегда.
import { StyleSheet, Text, View } from "react-native"
import { useSync } from "../sync/sync-context"
import { t } from "../i18n"

export function SyncBar() {
  const { status } = useSync()
  const queued = status.pendingOps + status.pendingPhotos

  const label =
    status.phase === "offline"
      ? t("syncOffline")
      : status.phase === "upgradeRequired"
        ? t("upgradeTitle")
      : status.phase === "error"
        ? t("syncError")
        : status.phase === "idle"
          ? t("syncIdle")
          : t("syncRunning")

  const color =
    status.phase === "offline" || status.phase === "error" || status.phase === "upgradeRequired"
      ? "#d97706"
      : status.phase === "idle"
        ? "#16a34a"
        : "#525252"

  return (
    <View style={styles.bar}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.text}>
        {label}
        {queued > 0 ? ` · ${queued} ${t("pendingOps")}` : ""}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#f5f5f4",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 12, color: "#525252" },
})
