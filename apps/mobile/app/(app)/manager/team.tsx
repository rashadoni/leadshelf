import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { TabIcon } from "../../../src/components/TabIcon"
import type { FieldManagerTeamAgent, FieldManagerTeamData } from "../../../src/field/contracts"
import { t, useLocale } from "../../../src/i18n"
import { formatShortDateTime, formatTime } from "../../../src/i18n/date-format"
import { HttpError } from "../../../src/sync/ports-error"
import { cardShadow, colors, radii } from "../../../src/theme"

function workdayMeta(agent: FieldManagerTeamAgent): { label: string; background: string; color: string } {
  if (agent.workday?.status === "STARTED") {
    return { label: t("managerWorkdayActive"), background: colors.successBg, color: colors.successDark }
  }
  if (agent.workday?.status === "PAUSED") {
    return { label: t("managerWorkdayPaused"), background: colors.warningBg, color: colors.warning }
  }
  return { label: t("managerWorkdayNone"), background: colors.draftBg, color: colors.draft }
}

export default function ManagerTeamScreen() {
  const locale = useLocale()
  const [data, setData] = useState<FieldManagerTeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fieldApi.managerTeam())
    } catch (reason) {
      setError(reason)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const denied = error instanceof HttpError && error.status === 403

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.primary} />}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("managerHomeTitle").toUpperCase()}</Text>
            <Text style={styles.title}>{t("managerTeamTitle")}</Text>
            <Text style={styles.subtitle}>{t("managerTeamHint")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} disabled={loading} onPress={() => void load()} style={styles.refresh}><Text style={styles.refreshText}>↻</Text></Pressable>
        </View>

        {loading && !data ? <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>{t("managerLoading")}</Text></View> : null}
        {error && !data ? (
          <View style={[styles.state, denied && styles.stateWarning]}>
            <View style={styles.stateIcon}><TabIcon name="profile" color={denied ? colors.warning : colors.primary} size={25} /></View>
            <Text style={styles.stateTitle}>{denied ? t("managerAccessDeniedTitle") : t("managerUnavailable")}</Text>
            <Text style={styles.stateText}>{denied ? t("managerAccessDeniedBody") : t("managerRetry")}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>{t("managerRetry")}</Text></Pressable>
          </View>
        ) : null}

        {data ? (
          <>
            <View style={styles.scope}>
              <TabIcon name="profile" color={colors.primary} size={18} />
              <Text style={styles.scopeText}>{data.scope === "ORGANIZATION" ? t("managerScopeOrganization") : t("managerScopeTeam")}</Text>
              {error ? <Text style={styles.staleText}>{t("managerUnavailable")}</Text> : null}
            </View>
            {data.agents.length === 0 ? (
              <View style={styles.state}><View style={styles.stateIcon}><TabIcon name="profile" color={colors.primary} size={25} /></View><Text style={styles.stateTitle}>{t("managerNoTeam")}</Text></View>
            ) : (
              <View style={styles.list}>
                {data.agents.map((agent) => {
                  const workday = workdayMeta(agent)
                  return (
                    <View key={agent.id} style={styles.card}>
                      <View style={styles.cardTop}>
                        <View style={styles.avatar}><Text style={styles.avatarText}>{agent.name.charAt(0).toUpperCase()}</Text></View>
                        <View style={styles.cardBody}>
                          <Text style={styles.name}>{agent.name}</Text>
                          <Text style={styles.role}>{agent.role}</Text>
                        </View>
                        <View style={[styles.presence, agent.isOnline ? styles.presenceOnline : styles.presenceOffline]}>
                          <View style={[styles.presenceDot, { backgroundColor: agent.isOnline ? colors.success : colors.faint }]} />
                          <Text style={[styles.presenceText, { color: agent.isOnline ? colors.successDark : colors.draft }]}>{agent.isOnline ? t("managerAppOnline") : t("managerAppOffline")}</Text>
                        </View>
                      </View>
                      <View style={styles.divider} />
                      <View style={styles.cardFooter}>
                        <View style={styles.workday}>
                          <View style={[styles.workdayDot, { backgroundColor: workday.color }]} />
                          <Text style={[styles.workdayText, { color: workday.color }]}>{workday.label}</Text>
                          {agent.workday?.startedAt ? <Text style={styles.workdaySince}>{formatTime(agent.workday.startedAt)}</Text> : null}
                        </View>
                        <Text style={styles.lastSeen}>{agent.lastSeenAt ? t("managerLastSeen") + ": " + formatShortDateTime(agent.lastSeenAt, locale) : "—"}</Text>
                      </View>
                    </View>
                  )
                })}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 32 },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.text, fontSize: 31, lineHeight: 32 },
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.9 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  refresh: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  refreshText: { color: colors.primary, fontSize: 23, fontWeight: "900" },
  scope: { marginHorizontal: 14, marginTop: 16, borderRadius: radii.inner, backgroundColor: colors.primarySoft, padding: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  scopeText: { flex: 1, color: colors.primary, fontSize: 10, fontWeight: "900" },
  staleText: { color: colors.warning, fontSize: 9, fontWeight: "800" },
  list: { paddingTop: 3 },
  card: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, backgroundColor: colors.card, padding: 14, ...cardShadow },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.primary, fontSize: 16, fontWeight: "900" },
  cardBody: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 14, fontWeight: "900" },
  role: { color: colors.muted, fontSize: 9, fontWeight: "800", marginTop: 3 },
  presence: { maxWidth: 106, paddingHorizontal: 8, paddingVertical: 6, borderRadius: radii.pill, flexDirection: "row", alignItems: "center", gap: 5 },
  presenceOnline: { backgroundColor: colors.successBg },
  presenceOffline: { backgroundColor: colors.draftBg },
  presenceDot: { width: 6, height: 6, borderRadius: 3 },
  presenceText: { flexShrink: 1, fontSize: 8, lineHeight: 10, fontWeight: "900" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 12 },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  workday: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  workdayDot: { width: 7, height: 7, borderRadius: 4 },
  workdayText: { fontSize: 9, fontWeight: "900" },
  workdaySince: { color: colors.faint, fontSize: 9, fontWeight: "800" },
  lastSeen: { maxWidth: "50%", color: colors.faint, fontSize: 8, textAlign: "right", fontWeight: "700" },
  state: { minHeight: 230, margin: 14, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", padding: 24, ...cardShadow },
  stateWarning: { backgroundColor: colors.warningBg, borderWidth: 1, borderColor: "#F6D788" },
  stateIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  stateTitle: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "center" },
  stateText: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 7 },
  retry: { minHeight: 44, marginTop: 16, borderRadius: 13, paddingHorizontal: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  retryText: { color: colors.headerText, fontSize: 11, fontWeight: "900" },
})
