// Вкладка «Профиль»: агент, язык интерфейса, синхронизация, выход.
import { type ReactNode, useEffect, useState } from "react"
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
import { TabIcon, type TabIconName } from "../../../src/components/TabIcon"
import { FieldScreenChrome } from "../../../src/components/FieldScreenChrome"
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
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ work: true })

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

  function requestOrganizationSwitch() {
    Alert.alert(
      t("switchOrganizationTitle"),
      t("switchOrganizationBody"),
      [
        { text: t("cancel"), style: "cancel" },
        { text: t("switchOrganizationConfirm"), onPress: logout },
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
  const syncNeedsAttention = status.phase !== "idle" || status.pendingOps + status.pendingPhotos > 0 || issueCount > 0
  const syncHasDanger = status.rejectedOps > 0
  const storageNeedsAttention = capacity?.photoLevel !== "ok"
  const toggleSection = (section: string) => setOpenSections((current) => ({ ...current, [section]: !current[section] }))

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <FieldScreenChrome />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("tabProfile")}</Text>
        </View>
        <SectionHint section="profile" icon="profile" titleKey="profileHintTitle" bodyKey="profileHintBody" />

        <View style={[styles.profileGrid, layout.isTablet && styles.profileGridTablet]}>
          <View style={layout.isTablet ? styles.profileColumn : undefined}>
            <View style={[styles.card, styles.accountCard, layout.isTablet && styles.cardTablet]}>
              <View style={styles.accountTop}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
                <View style={styles.accountBody}>
                  <Text style={styles.accountLabel}>{t("profileAccount")}</Text>
                  <Text style={styles.accountName} numberOfLines={2}>{displayName ?? "—"}</Text>
                  {agent?.role ? <Text style={styles.accountMeta}>{agentRoleLabel(agent.role)}</Text> : null}
                </View>
              </View>
              {agent ? (
                <View style={styles.accountDetails}>
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
            </View>

            <ProfileDisclosure
              title={t("profileWorkTools")}
              icon="work"
              open={Boolean(openSections.work)}
              onPress={() => toggleSection("work")}
              tablet={layout.isTablet}
            >
              <ProfileEntry
                icon="dashboard"
                title={t("personalKpiTitle")}
                hint={t("personalKpiHint")}
                accessibilityHint={t("personalKpiHint")}
                onPress={() => router.push("/(app)/kpi" as never)}
              />
              {IS_LEADDRIVE_FIELD ? (
                <ProfileEntry
                  icon="week"
                  title={t("moduleHrm")}
                  hint={t("fieldHrmEntryHint")}
                  accessibilityHint={t("fieldHrmEntryHint")}
                  onPress={() => router.push("/(app)/hrm" as never)}
                />
              ) : null}
            </ProfileDisclosure>
          </View>

          <View style={layout.isTablet ? styles.profileColumn : undefined}>
            <ProfileDisclosure
              title={t("profileSync")}
              icon="refresh"
              open={Boolean(openSections.sync) || syncNeedsAttention}
              onPress={() => toggleSection("sync")}
              tablet={layout.isTablet}
            >
              <SyncBar compact showRetry={false} />
              <View style={styles.metricsGrid}>
                {syncMetrics.map(([label, value], index) => (
                  <View key={label} style={styles.metric}>
                    <Text style={styles.metricLabel}>{label}</Text>
                    <Text style={[
                      styles.metricValue,
                      index === 3 && issueCount > 0 && (syncHasDanger ? styles.metricDanger : styles.metricWarning),
                    ]}>
                      {value}
                    </Text>
                  </View>
                ))}
              </View>
              {issueCount > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("syncCenterOpen")}
                  accessibilityHint={t("profileSyncIssues")}
                  onPress={() => router.push("/(app)/sync-center" as never)}
                  style={({ pressed }) => [styles.recoveryButton, syncHasDanger && styles.recoveryButtonDanger, pressed && styles.recoveryPressed]}
                >
                  <View accessible={false} style={styles.recoveryMark}><TabIcon name="alert" color={syncHasDanger ? colors.dangerPressed : colors.warning} size={18} /></View>
                  <Text style={[styles.recoveryText, syncHasDanger && styles.recoveryTextDanger]}>{t("syncCenterOpen")}</Text>
                  <View accessible={false} style={styles.entryChevron}><TabIcon name="chevronRight" color={syncHasDanger ? colors.dangerPressed : colors.warning} size={20} /></View>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={running || syncing ? t("syncRunning") : t("syncNow")}
                accessibilityState={{ disabled: running || syncing, busy: running || syncing }}
                disabled={running || syncing}
                onPress={() => void onSyncNow()}
                style={({ pressed }) => [styles.syncButton, pressed && styles.syncPressed, (running || syncing) && styles.syncDisabled]}
              >
                <View accessible={false}><TabIcon name="refresh" color={colors.headerText} size={19} /></View>
                <Text style={styles.syncText}>{running || syncing ? t("syncRunning") : t("syncNow")}</Text>
              </Pressable>
            </ProfileDisclosure>

            <ProfileDisclosure
              title={t("profileStorage")}
              icon="document"
              open={Boolean(openSections.storage) || storageNeedsAttention}
              onPress={() => toggleSection("storage")}
              tablet={layout.isTablet}
            >
              <View style={styles.metricsGrid}>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>{t("profileSqliteSize")}</Text>
                  <Text style={styles.metricValue}>{capacity ? formatCapacityBytes(capacity.databaseBytes) : "—"}</Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>{t("profileOfflineMedia")}</Text>
                  <Text style={[styles.metricValue, storageNeedsAttention && styles.metricWarning]}>
                    {capacity ? `${capacity.photoFiles} · ${formatCapacityBytes(capacity.photoBytes)}` : "—"}
                  </Text>
                </View>
              </View>
              {storageNeedsAttention ? <Text style={styles.capacityHint}>{t("profileStorageWarning")}</Text> : null}
            </ProfileDisclosure>

            <ProfileDisclosure
              title={t("profileLanguage")}
              icon="profile"
              open={Boolean(openSections.language)}
              onPress={() => toggleSection("language")}
              tablet={layout.isTablet}
            >
              <View accessibilityRole="radiogroup" accessibilityLabel={t("profileLanguage")} style={styles.localeRow}>
                {LOCALES.map((l) => (
                  <Pressable
                    key={l}
                    accessibilityRole="radio"
                    accessibilityLabel={`${t("profileLanguage")}: ${l === "az" ? t("languageAz") : t("languageRu")}`}
                    accessibilityState={{ selected: locale === l }}
                    onPress={() => {
                      setLocale(l)
                      void tokenStore.setLocale(l)
                    }}
                    style={({ pressed }) => [styles.localeBtn, locale === l && styles.localeActive, pressed && styles.localePressed]}
                  >
                    <Text style={[styles.localeText, locale === l && styles.localeTextActive]}>{l === "az" ? t("languageAz") : t("languageRu")}</Text>
                    {locale === l ? <View accessible={false} style={styles.localeCheck}><TabIcon name="check" color={colors.primary} size={18} /></View> : null}
                  </Pressable>
                ))}
              </View>
            </ProfileDisclosure>
          </View>
        </View>

        <ProfileDisclosure
          title={t("profileSession")}
          icon="profile"
          open={Boolean(openSections.session)}
          onPress={() => toggleSection("session")}
          tablet={false}
        >
          <ProfileEntry
            icon="organizations"
            title={t("switchOrganization")}
            hint={t("switchOrganizationHint")}
            accessibilityHint={t("switchOrganizationHint")}
            onPress={requestOrganizationSwitch}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("logout")}
            onPress={() => void logout()}
            style={({ pressed }) => [styles.sessionLogout, pressed && styles.logoutPressed]}
          >
            <View accessible={false} style={[styles.entryIcon, styles.entryIconDanger]}><TabIcon name="close" color={colors.danger} size={19} /></View>
            <Text style={styles.sessionLogoutText}>{t("logout")}</Text>
            <View accessible={false} style={styles.entryChevron}><TabIcon name="chevronRight" color={colors.danger} size={21} /></View>
          </Pressable>
        </ProfileDisclosure>
      </ScrollView>
    </SafeAreaView>
  )
}

function ProfileDisclosure({
  title,
  icon,
  open,
  onPress,
  children,
  tablet,
}: {
  title: string
  icon: TabIconName
  open: boolean
  onPress: () => void
  children: ReactNode
  tablet: boolean
}) {
  return (
    <View style={[styles.disclosure, tablet && styles.disclosureTablet]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={onPress}
        style={({ pressed }) => [styles.disclosureToggle, pressed && styles.disclosurePressed]}
      >
        <View accessible={false} style={styles.disclosureIcon}><TabIcon name={icon} color={colors.primary} size={19} /></View>
        <Text style={styles.disclosureTitle} numberOfLines={1}>{title}</Text>
        <View accessible={false} style={styles.entryChevron}><TabIcon name={open ? "chevronUp" : "chevronDown"} color={colors.primary} size={21} /></View>
      </Pressable>
      {open ? <View style={styles.disclosureContent}>{children}</View> : null}
    </View>
  )
}

function ProfileEntry({
  icon,
  title,
  hint,
  accessibilityHint,
  onPress,
}: {
  icon: TabIconName
  title: string
  hint: string
  accessibilityHint: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [styles.entry, pressed && styles.entryPressed]}
    >
      <View accessible={false} style={styles.entryIcon}><TabIcon name={icon} color={colors.primary} size={20} /></View>
      <View style={styles.entryBody}>
        <Text style={styles.entryTitle}>{title}</Text>
        <Text style={styles.entryHint} numberOfLines={1}>{hint}</Text>
      </View>
      <View accessible={false} style={styles.entryChevron}><TabIcon name="chevronRight" color={colors.primary} size={21} /></View>
    </Pressable>
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
  accountCard: { backgroundColor: colors.card, borderColor: colors.border },
  accountTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primary, fontSize: 22, fontWeight: "800" },
  accountBody: { flex: 1, minWidth: 0 },
  accountLabel: { fontSize: 12, fontWeight: "800", color: colors.muted, letterSpacing: 0.7, textTransform: "uppercase" },
  accountName: { fontSize: 18, lineHeight: 23, fontWeight: "900", color: colors.text, marginTop: 3 },
  accountMeta: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  accountDetails: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 2 },
  entryChevron: { width: 24, minHeight: 44, alignItems: "center", justifyContent: "center" },
  detailRow: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailRowLast: { borderBottomWidth: 0 },
  detailLabel: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  detailValue: { flexShrink: 1, color: colors.text, fontSize: 12, fontWeight: "800", textAlign: "right" },
  connectionValue: { flexDirection: "row", alignItems: "center", gap: 6 },
  connectionDot: { width: 7, height: 7, borderRadius: 4 },
  disclosure: { marginHorizontal: 20, marginTop: 16, borderRadius: radii.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  disclosureTablet: { marginHorizontal: 0 },
  disclosureToggle: { minHeight: 58, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 11 },
  disclosurePressed: { backgroundColor: colors.primarySoft },
  disclosureIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  disclosureTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, fontWeight: "900" },
  disclosureContent: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 14, paddingBottom: 14 },
  entry: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  entryPressed: { backgroundColor: colors.primarySoft },
  entryIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  entryIconDanger: { backgroundColor: colors.dangerBg },
  entryBody: { flex: 1, minWidth: 0 },
  entryTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  entryHint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  localeRow: { flexDirection: "row", gap: 8 },
  localeBtn: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 10,
    borderRadius: radii.inner,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  localeActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  localePressed: { opacity: 0.82 },
  localeText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  localeTextActive: { color: colors.primary, fontWeight: "800" },
  localeCheck: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  syncButton: {
    marginTop: 12,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
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
  metricLabel: { fontSize: 12, color: colors.muted },
  metricValue: { marginTop: 5, fontSize: 13, fontWeight: "800", color: colors.text },
  metricWarning: { color: colors.warning },
  metricDanger: { color: colors.dangerPressed },
  capacityHint: { marginTop: 10, fontSize: 12, lineHeight: 17, color: colors.warning },
  recoveryButton: { minHeight: 50, marginTop: 12, borderRadius: radii.inner, paddingHorizontal: 10, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.warningBorder, flexDirection: "row", alignItems: "center", gap: 9 },
  recoveryButtonDanger: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
  recoveryPressed: { opacity: 0.78 },
  recoveryMark: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  recoveryText: { flex: 1, color: colors.warning, fontSize: 12, lineHeight: 17, fontWeight: "900" },
  recoveryTextDanger: { color: colors.dangerPressed },
  syncPressed: { backgroundColor: colors.primaryPressed },
  syncDisabled: { backgroundColor: colors.disabled },
  syncText: { color: colors.headerText, fontSize: 13, fontWeight: "800" },
  sessionLogout: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 11 },
  sessionLogoutText: { flex: 1, minWidth: 0, color: colors.danger, fontSize: 14, fontWeight: "900" },
  profileGrid: { width: "100%" },
  profileGridTablet: { flexDirection: "row", alignItems: "flex-start", gap: 18, paddingHorizontal: 20 },
  profileColumn: { flex: 1, minWidth: 0 },
  cardTablet: { marginHorizontal: 0 },
  logoutPressed: { backgroundColor: colors.dangerBg },
})
