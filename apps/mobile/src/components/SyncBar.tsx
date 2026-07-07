// Offline-доверие как UX (docs/10 Tier-1 №4): статус синка виден всегда.
import { Pressable, StyleSheet, Text, View } from "react-native"
import { useSync } from "../sync/sync-context"
import { t } from "../i18n"

export function SyncBar() {
  const { status, sync } = useSync()
  const queued = status.pendingOps + status.pendingPhotos
  const running = !["idle", "offline", "error", "upgradeRequired"].includes(status.phase)
  const canRetry =
    status.phase !== "upgradeRequired" &&
    (queued > 0 || status.phase === "offline" || status.phase === "error")

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
        {status.quarantinedPhotos > 0 ? ` · ${status.quarantinedPhotos} ${t("photosStuck")}` : ""}
      </Text>
      {canRetry ? (
        <Pressable
          disabled={running}
          onPress={() => void sync()}
          style={[styles.retry, running && styles.retryDisabled]}
        >
          <Text style={styles.retryText}>{t("syncRetry")}</Text>
        </Pressable>
      ) : null}
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
  text: { flex: 1, fontSize: 12, color: "#525252" },
  retry: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#d4d4d4",
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "white",
  },
  retryDisabled: { opacity: 0.5 },
  retryText: { fontSize: 12, fontWeight: "600", color: "#404040" },
})
