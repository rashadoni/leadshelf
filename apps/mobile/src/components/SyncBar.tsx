// Offline-доверие как UX (docs/10 Tier-1 №4): статус синка виден всегда.
import { Pressable, StyleSheet, Text, View } from "react-native"
import { useSync } from "../sync/sync-context"
import { t } from "../i18n"
import { colors, radii } from "../theme"

export function SyncBar({ showRetry = true, compact = false }: { showRetry?: boolean; compact?: boolean }) {
  const { status, sync } = useSync()
  const queued = status.pendingOps + status.pendingPhotos
  const supportCode = status.failure?.correlationId ?? null
  const running = !["idle", "offline", "error", "authLost", "upgradeRequired"].includes(status.phase)
  const canRetry =
    status.phase !== "authLost" &&
    status.phase !== "upgradeRequired" &&
    (queued > 0 || status.phase === "offline" || status.phase === "error")

  const label =
    status.phase === "authLost"
      ? t("sessionRevoked")
      : status.phase === "offline"
      ? t("syncOffline")
      : status.phase === "upgradeRequired"
        ? t("upgradeTitle")
      : status.phase === "error"
        ? queued > 0
          ? t("syncWriteError")
          : t("syncReadError")
        : status.phase === "idle"
          ? queued > 0
            ? t("syncWriteError")
            : status.conflictOps + status.rejectedOps > 0
            ? t("syncNeedsAttention")
            : t("syncIdle")
          : t("syncRunning")

  const color =
    status.phase === "offline" || status.phase === "error" || status.phase === "authLost" || status.phase === "upgradeRequired"
      ? colors.warning
      : status.rejectedOps > 0
        ? colors.danger
        : status.conflictOps > 0 || status.quarantinedPhotos > 0
          ? colors.warning
      : status.phase === "idle"
        ? queued > 0
          ? colors.warning
          : colors.success
        : colors.muted

  return (
    <View style={[styles.bar, compact && styles.barCompact]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.text}>
        {label}
        {queued > 0 ? ` · ${queued} ${t("pendingOps")}` : ""}
        {status.conflictOps > 0 ? ` · ${status.conflictOps} ${t("syncConflicts")}` : ""}
        {status.rejectedOps > 0 ? ` · ${status.rejectedOps} ${t("syncRejected")}` : ""}
        {status.quarantinedPhotos > 0 ? ` · ${status.quarantinedPhotos} ${t("photosStuck")}` : ""}
        {supportCode ? ` · ${t("syncSupportCode", { code: supportCode })}` : ""}
      </Text>
      {showRetry && canRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("syncRetry")}
          accessibilityState={{ disabled: running, busy: running }}
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
    gap: 7,
    minHeight: 34,
    paddingHorizontal: 20,
    paddingVertical: 7,
    backgroundColor: "transparent",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  barCompact: { paddingHorizontal: 0 },
  text: { flex: 1, fontSize: 12, fontWeight: "600", color: colors.muted },
  retry: {
    minHeight: 44,
    borderRadius: radii.inner,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 9,
    paddingVertical: 8,
    backgroundColor: colors.card,
  },
  retryDisabled: { opacity: 0.5 },
  retryText: { fontSize: 12, fontWeight: "800", color: colors.text },
})
