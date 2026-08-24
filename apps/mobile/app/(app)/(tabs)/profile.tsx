// Вкладка «Профиль»: агент, язык интерфейса, синхронизация, выход.
import { useEffect, useState } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router } from "expo-router"
import { SyncBar } from "../../../src/components/SyncBar"
import { SectionHint } from "../../../src/components/SectionHint"
import { mobileLogout } from "../../../src/api/mobile-client"
import { tokenStore } from "../../../src/auth/token-store"
import { requiresLogoutConfirmation } from "../../../src/auth/logout-policy"
import { getLocalDatabaseCapacity, getLogoutDataSummary, purgeLocalOperationalData } from "../../../src/db/local-store"
import { formatCapacityBytes, photoCapacityLevel } from "../../../src/db/capacity"
import { readPhotoOutboxUsage } from "../../../src/photos/photo-store"
import { useSync } from "../../../src/sync/sync-context"
import { setLocale, t, useLocale, type Locale } from "../../../src/i18n"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { colors, radii } from "../../../src/theme"
import { useField } from "../../../src/field/field-context"
import { stopWorkdayTracking } from "../../../src/location/workday-tracking"
import {
  deleteAllEncryptedMedia,
  readEncryptedMediaUsage,
} from "../../../src/media/encrypted-media-store"
import { useResponsiveLayout } from "../../../src/layout/responsive"
import { TabIcon } from "../../../src/components/TabIcon"
import { IS_LEADDRIVE_FIELD } from "../../../src/config/mobile-variant"
import { agentRoleLabel } from "../../../src/field/labels"

const LOCALES: Locale[] = ["az", "ru"]

export default function ProfileTab() {
  const locale = useLocale()
  const { status, sync } = useSync()
  const field = useField()
  const layout = useResponsiveLayout()
  const [userName, setUserName] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [capacity, setCapacity] = useState<{
    databaseBytes: number
    photoFiles: number
    photoBytes: number
    photoLevel: ReturnType<typeof photoCapacityLevel>
  } | null>(null)

  async function refreshCapacity() {
    const database = getLocalDatabaseCapacity()
    const [photos, media] = await Promise.all([
      readPhotoOutboxUsage(),
      readEncryptedMediaUsage(),
    ])
    setCapacity({
      databaseBytes: database.allocatedBytes,
      photoFiles: media.files,
      photoBytes: media.bytes,
      photoLevel: photoCapacityLevel(photos),
    })
  }

  useEffect(() => {
    void tokenStore.getUserName().then((name) => setUserName(name))
    void refreshCapacity()
  }, [])

  async function onSyncNow() {
    setSyncing(true)
    try {
      await Promise.all([sync(), field.refresh()])
      await refreshCapacity()
    } finally {
      setSyncing(false)
    }
  }

  async function completeLogout() {
    try {
      await stopWorkdayTracking().catch(() => {})
      await mobileLogout() // best-effort отзыв refresh-сессии на сервере
      // Сначала удаляем чувствительные media-файлы; при ошибке сессия остаётся,
      // чтобы пользователь мог повторить безопасную очистку.
      await deleteAllEncryptedMedia()
      purgeLocalOperationalData()
      await tokenStore.clearSession()
      router.replace("/(auth)/login" as never)
    } catch {
      Alert.alert(t("logoutFailed"))
    }
  }

  function logout() {
    const summary = getLogoutDataSummary()
    if (!requiresLogoutConfirmation(summary)) {
      void completeLogout()
      return
    }
    Alert.alert(
      t("logoutUnsyncedTitle"),
      t("logoutUnsyncedBody")
        .replace("{operations}", String(summary.unsyncedOperations))
        .replace("{photos}", String(summary.unsyncedPhotos)),
      [
        { text: t("cancel"), style: "cancel" },
        { text: t("logoutDiscard"), style: "destructive", onPress: () => void completeLogout() },
      ],
    )
  }

  const agent = field.profile?.agent
  const displayName = agent?.name ?? userName
  const initial = (displayName ?? "?").trim().charAt(0).toUpperCase() || "?"
  const running = !["idle", "offline", "error", "authLost", "upgradeRequired"].includes(status.phase)
  const issueCount = status.conflictOps + status.rejectedOps + status.quarantinedPhotos
  const duration = status.lastDurationMs == null
    ? t("profileNever")
    : `${Math.max(0, Math.round(status.lastDurationMs / 1000))} ${t("secondsShort")}`
  const queueAge = status.oldestPendingAgeMs == null
    ? "—"
    : `${Math.max(1, Math.ceil(status.oldestPendingAgeMs / 60_000))} ${t("minutesShort")}`
  const syncMetrics = [
    [t("profileSyncLast"), status.lastSyncAt ? formatShortDateTime(status.lastSyncAt, locale) : t("profileNever")],
    [t("profileSyncDuration"), duration],
    [t("profileQueueAge"), queueAge],
    [t("profileSyncIssues"), String(issueCount)],
  ]

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("tabProfile")}</Text>
        </View>
        <SectionHint section="profile" icon="profile" titleKey="profileHintTitle" bodyKey="profileHintBody" />

        <View style={[styles.profileGrid, layout.isTablet && styles.profileGridTablet]}>
          <View style={layout.isTablet ? styles.profileColumn : undefined}>
        <View style={[styles.card, styles.accountCard, layout.isTablet && styles.cardTablet]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.accountBody}>
            <Text style={styles.accountLabel}>{t("profileAccount")}</Text>
            <Text style={styles.accountName} numberOfLines={1}>
              {displayName ?? "—"}
            </Text>
            {agent?.role ? <Text style={styles.accountMeta}>{agentRoleLabel(agent.role)}</Text> : null}
          </View>
        </View>

        {agent ? (
          <View style={[styles.card, layout.isTablet && styles.cardTablet]}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>{t("organization")}</Text>
              <Text style={styles.detailValue}>{agent.organizationName}</Text>
            </View>
            <View style={[styles.detailRow, IS_LEADDRIVE_FIELD && styles.detailRowLast]}>
              <Text style={styles.detailLabel}>{t("manager")}</Text>
              <Text style={styles.detailValue}>{agent.manager?.name ?? "—"}</Text>
            </View>
            {!IS_LEADDRIVE_FIELD ? (
              <View style={[styles.detailRow, styles.detailRowLast]}>
                <Text style={styles.detailLabel}>{t("shelfConnection")}</Text>
                <View style={styles.connectionValue}>
                  <View style={[styles.connectionDot, { backgroundColor: field.profile?.capabilities.shelfExecution.enabled ? colors.success : colors.warning }]} />
                  <Text style={styles.detailValue}>{field.profile?.capabilities.shelfExecution.enabled ? t("shelfConnected") : t("shelfUnavailable")}</Text>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(app)/kpi" as never)}
          style={({ pressed }) => [styles.card, styles.kpiEntry, layout.isTablet && styles.cardTablet, pressed && styles.kpiEntryPressed]}
        >
          <View style={styles.kpiIcon}><Text style={styles.kpiIconText}>%</Text></View>
          <View style={styles.kpiBody}>
            <Text style={styles.kpiTitle}>{t("personalKpiTitle")}</Text>
            <Text style={styles.kpiHint}>{t("personalKpiHint")}</Text>
            <Text style={styles.kpiAction}>{t("personalKpiOpen")}</Text>
          </View>
          <Text style={styles.kpiArrow}>›</Text>
        </Pressable>

        {IS_LEADDRIVE_FIELD ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(app)/hrm" as never)}
            style={({ pressed }) => [styles.card, styles.hrmEntry, layout.isTablet && styles.cardTablet, pressed && styles.hrmEntryPressed]}
          >
            <View style={styles.hrmIcon}><TabIcon name="week" color={colors.primary} size={23} /></View>
            <View style={styles.hrmBody}>
              <Text style={styles.hrmTitle}>{t("moduleHrm")}</Text>
              <Text style={styles.hrmHint}>{t("fieldHrmEntryHint")}</Text>
            </View>
            <Text style={styles.hrmArrow}>›</Text>
          </Pressable>
        ) : null}
          </View>

          <View style={layout.isTablet ? styles.profileColumn : undefined}>

        <View style={[styles.card, layout.isTablet && styles.cardTablet]}>
          <Text style={styles.sectionTitle}>{t("profileLanguage")}</Text>
          <View style={styles.localeRow}>
            {LOCALES.map((l) => (
              <Pressable
                key={l}
                onPress={() => {
                  setLocale(l)
                  void tokenStore.setLocale(l)
                }}
                style={[styles.localeBtn, locale === l && styles.localeActive]}
              >
                <Text style={[styles.localeText, locale === l && styles.localeTextActive]}>
                  {l === "az" ? t("languageAz") : t("languageRu")}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.card, layout.isTablet && styles.cardTablet]}>
          <Text style={styles.sectionTitle}>{t("profileSync")}</Text>
          <SyncBar />
          <View style={styles.metricsGrid}>
            {syncMetrics.map(([label, value], index) => (
              <View key={label} style={styles.metric}>
                <Text style={styles.metricLabel}>{label}</Text>
                <Text style={[styles.metricValue, index === 3 && issueCount > 0 && styles.metricWarning]}>
                  {value}
                </Text>
              </View>
            ))}
          </View>
          {issueCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(app)/sync-center" as never)}
              style={styles.recoveryButton}
            >
              <View style={styles.recoveryMark}><Text style={styles.recoveryMarkText}>!</Text></View>
              <Text style={styles.recoveryText}>{t("syncCenterOpen")}</Text>
              <Text style={styles.recoveryArrow}>›</Text>
            </Pressable>
          ) : null}
          <Pressable
            disabled={running || syncing}
            onPress={() => void onSyncNow()}
            style={({ pressed }) => [
              styles.syncButton,
              pressed && styles.syncPressed,
              (running || syncing) && styles.syncDisabled,
            ]}
          >
            <Text style={styles.syncText}>{running || syncing ? t("syncRunning") : t("syncNow")}</Text>
          </Pressable>
        </View>

        <View style={[styles.card, layout.isTablet && styles.cardTablet]}>
          <Text style={styles.sectionTitle}>{t("profileStorage")}</Text>
          <View style={styles.metricsGrid}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>{t("profileSqliteSize")}</Text>
              <Text style={styles.metricValue}>{capacity ? formatCapacityBytes(capacity.databaseBytes) : "—"}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>{t("profileOfflineMedia")}</Text>
              <Text style={[
                styles.metricValue,
                capacity && capacity.photoLevel !== "ok" && styles.metricWarning,
              ]}>
                {capacity
                  ? `${capacity.photoFiles} · ${formatCapacityBytes(capacity.photoBytes)}`
                  : "—"}
              </Text>
            </View>
          </View>
          {capacity && capacity.photoLevel !== "ok" ? (
            <Text style={styles.capacityHint}>{t("profileStorageWarning")}</Text>
          ) : null}
        </View>
          </View>
        </View>

        <Pressable onPress={() => void logout()} style={({ pressed }) => [styles.logout, layout.isTablet && styles.logoutTablet, pressed && styles.logoutPressed]}>
          <Text style={styles.logoutText}>{t("logout")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 24 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 9 },
  title: { fontSize: 28, fontWeight: "900", color: colors.text, letterSpacing: -0.7 },
  card: {
    backgroundColor: colors.card,
    marginHorizontal: 20,
    marginTop: 16,
    padding: 17,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  accountCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.navy, borderColor: colors.navy },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.headerText, fontSize: 22, fontWeight: "800" },
  accountBody: { flex: 1, minWidth: 0 },
  accountLabel: { fontSize: 9, fontWeight: "800", color: colors.headerSubtext, letterSpacing: 0.9, textTransform: "uppercase" },
  accountName: { fontSize: 18, fontWeight: "900", color: colors.headerText, marginTop: 3 },
  accountMeta: { color: colors.headerSubtext, fontSize: 11, marginTop: 3 },
  kpiEntry: { minHeight: 104, flexDirection: "row", alignItems: "center", gap: 13 },
  kpiEntryPressed: { backgroundColor: colors.primarySoft },
  kpiIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  kpiIconText: { color: colors.primary, fontSize: 20, fontWeight: "900" },
  kpiBody: { flex: 1, minWidth: 0 },
  kpiTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  kpiHint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  kpiAction: { color: colors.primary, fontSize: 11, fontWeight: "900", marginTop: 7 },
  kpiArrow: { color: colors.primary, fontSize: 30, fontWeight: "500" },
  hrmEntry: { minHeight: 88, flexDirection: "row", alignItems: "center", gap: 13 },
  hrmEntryPressed: { backgroundColor: colors.primarySoft },
  hrmIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  hrmBody: { flex: 1, minWidth: 0 },
  hrmTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  hrmHint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  hrmArrow: { color: colors.primary, fontSize: 30, fontWeight: "500" },
  detailRow: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailRowLast: { borderBottomWidth: 0 },
  detailLabel: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  detailValue: { flexShrink: 1, color: colors.text, fontSize: 12, fontWeight: "800", textAlign: "right" },
  connectionValue: { flexDirection: "row", alignItems: "center", gap: 6 },
  connectionDot: { width: 7, height: 7, borderRadius: 4 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.text, marginBottom: 10 },
  localeRow: { flexDirection: "row", gap: 8 },
  localeBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: radii.inner,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  localeActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  localeText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  localeTextActive: { color: colors.primary, fontWeight: "800" },
  syncButton: {
    marginTop: 12,
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: radii.inner,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 12, gap: 8 },
  metric: {
    width: "48%",
    minHeight: 64,
    borderRadius: radii.inner,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    padding: 10,
  },
  metricLabel: { fontSize: 11, color: colors.muted },
  metricValue: { marginTop: 5, fontSize: 13, fontWeight: "800", color: colors.text },
  metricWarning: { color: colors.warning },
  capacityHint: { marginTop: 10, fontSize: 12, lineHeight: 17, color: colors.warning },
  recoveryButton: { minHeight: 50, marginTop: 12, borderRadius: radii.inner, paddingHorizontal: 10, backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: colors.dangerBorder, flexDirection: "row", alignItems: "center", gap: 9 },
  recoveryMark: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  recoveryMarkText: { color: colors.dangerPressed, fontSize: 14, fontWeight: "900" },
  recoveryText: { flex: 1, color: colors.dangerPressed, fontSize: 11, fontWeight: "900" },
  recoveryArrow: { color: colors.dangerPressed, fontSize: 22 },
  syncPressed: { backgroundColor: colors.primaryPressed },
  syncDisabled: { backgroundColor: colors.disabled },
  syncText: { color: colors.headerText, fontSize: 13, fontWeight: "800" },
  logout: {
    marginHorizontal: 20,
    marginTop: 18,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: radii.inner,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  profileGrid: { width: "100%" },
  profileGridTablet: { flexDirection: "row", alignItems: "flex-start", gap: 18, paddingHorizontal: 20 },
  profileColumn: { flex: 1, minWidth: 0 },
  cardTablet: { marginHorizontal: 0 },
  logoutTablet: { marginHorizontal: 20 },
  logoutPressed: { backgroundColor: colors.dangerBg },
  logoutText: { color: colors.danger, fontSize: 14, fontWeight: "800" },
})
