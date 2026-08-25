import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { TabIcon } from "../../../src/components/TabIcon"
import type { FieldManagerTeamAgent, FieldManagerTeamData } from "../../../src/field/contracts"
import { t, useLocale } from "../../../src/i18n"
import { formatShortDateTime, formatTime } from "../../../src/i18n/date-format"
import { HttpError } from "../../../src/sync/ports-error"
import { cardShadow, colors, radii } from "../../../src/theme"
import { agentRoleLabel } from "../../../src/field/labels"
import { safeFieldBack } from "../../../src/navigation/safe-back"

type WorkdayMeta = {
  label: string
  background: string
  color: string
  startedAt: string | null
  workedSeconds: number | null
}

const MANAGER_PAGE_LIMIT = 25

function compactWorkedTime(totalSeconds: number): string {
  const minutes = Math.max(0, Math.floor(totalSeconds / 60))
  const hours = Math.floor(minutes / 60)
  return String(hours).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0")
}

function workdayMeta(agent: FieldManagerTeamAgent, supportsTodayContract: boolean): WorkdayMeta {
  const today = agent.todayWorkday
  if (supportsTodayContract && today?.status === "STARTED") {
    return {
      label: t("managerWorkdayActive"),
      background: colors.successBg,
      color: colors.successDark,
      startedAt: today.startedAt,
      workedSeconds: today.durationAnomalous ? null : today.workedSeconds,
    }
  }
  if (supportsTodayContract && today?.status === "PAUSED") {
    return {
      label: t("managerWorkdayPaused"),
      background: colors.warningBg,
      color: colors.warning,
      startedAt: today.startedAt,
      workedSeconds: today.durationAnomalous ? null : today.workedSeconds,
    }
  }
  if (supportsTodayContract && today?.status === "COMPLETED") {
    return {
      label: t("managerWorkdayCompleted"),
      background: colors.successBg,
      color: colors.successDark,
      startedAt: today.startedAt,
      workedSeconds: today.durationAnomalous ? null : today.workedSeconds,
    }
  }
  if (supportsTodayContract && agent.workday) {
    return {
      label: t("managerWorkdayCarryOver"),
      background: colors.warningBg,
      color: colors.warning,
      startedAt: agent.workday.startedAt,
      workedSeconds: null,
    }
  }
  if (supportsTodayContract) {
    return {
      label: t("managerWorkdayNoEntry"),
      background: colors.draftBg,
      color: colors.draft,
      startedAt: null,
      workedSeconds: null,
    }
  }
  if (agent.workday?.status === "STARTED") {
    return {
      label: t("managerWorkdayActive"),
      background: colors.successBg,
      color: colors.successDark,
      startedAt: agent.workday.startedAt,
      workedSeconds: null,
    }
  }
  if (agent.workday?.status === "PAUSED") {
    return {
      label: t("managerWorkdayPaused"),
      background: colors.warningBg,
      color: colors.warning,
      startedAt: agent.workday.startedAt,
      workedSeconds: null,
    }
  }
  return {
    label: t("managerWorkdayNone"),
    background: colors.draftBg,
    color: colors.draft,
    startedAt: null,
    workedSeconds: null,
  }
}

export default function ManagerTeamScreen() {
  const locale = useLocale()
  const [data, setData] = useState<FieldManagerTeamData | null>(null)
  const [search, setSearch] = useState("")
  const [loadedSearch, setLoadedSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const sequence = useRef(0)

  const load = useCallback(async (query: string, page = 1, append = false) => {
    const request = ++sequence.current
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const next = await fieldApi.managerTeam({ page, limit: MANAGER_PAGE_LIMIT, search: query || undefined })
      if (request !== sequence.current) return
      setLoadedSearch(query)
      setData((current) => {
        if (!append || !current) return next
        const existing = new Set(current.agents.map((agent) => agent.id))
        return {
          ...next,
          agents: [...current.agents, ...next.agents.filter((agent) => !existing.has(agent.id))],
        }
      })
    } catch (reason) {
      if (request === sequence.current) setError(reason)
    } finally {
      if (request === sequence.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => void load(search.trim()), 300)
    return () => clearTimeout(id)
  }, [load, search])

  const denied = error instanceof HttpError && error.status === 403
  const supportsTodayContract = data?.today !== null && data?.today !== undefined
  const todayAgents = data?.agents.filter((agent) => agent.todayWorkday != null) ?? []
  const activeToday = todayAgents.filter((agent) => agent.todayWorkday?.status === "STARTED").length
  const pausedToday = todayAgents.filter((agent) => agent.todayWorkday?.status === "PAUSED").length
  const completedToday = todayAgents.filter((agent) => agent.todayWorkday?.status === "COMPLETED").length
  const hasPendingSearch = loadedSearch !== search.trim()

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load(search.trim())} tintColor={colors.primary} />} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => safeFieldBack("/(app)/manager")} style={styles.back}><TabIcon name="chevronLeft" color={colors.text} size={23} /></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("managerHomeTitle").toUpperCase()}</Text>
            <Text style={styles.title}>{t("managerTeamTitle")}</Text>
            <Text style={styles.subtitle}>{t("managerTeamHint")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} accessibilityState={{ busy: loading || loadingMore, disabled: loading || loadingMore }} disabled={loading || loadingMore} onPress={() => void load(search.trim())} style={styles.refresh}><TabIcon name="refresh" color={colors.primary} size={22} /></Pressable>
        </View>

        {loading && !data ? <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>{t("managerLoading")}</Text></View> : null}
        {error && !data ? (
          <View style={[styles.state, denied && styles.stateWarning]}>
            <View style={styles.stateIcon}><TabIcon name="profile" color={denied ? colors.warning : colors.primary} size={25} /></View>
            <Text style={styles.stateTitle}>{denied ? t("managerAccessDeniedTitle") : t("managerUnavailable")}</Text>
            <Text style={styles.stateText}>{denied ? t("managerAccessDeniedBody") : t("managerRetry")}</Text>
            <Pressable accessibilityLabel={t("managerRetry")} accessibilityRole="button" accessibilityState={{ busy: loading }} onPress={() => void load(search.trim())} style={styles.retry}><Text style={styles.retryText}>{t("managerRetry")}</Text></Pressable>
          </View>
        ) : null}

        {data ? (
          <>
            <View style={styles.scope}>
              <TabIcon name="profile" color={colors.primary} size={18} />
              <Text style={styles.scopeText}>{data.scope === "ORGANIZATION" ? t("managerScopeOrganization") : t("managerScopeTeam")}</Text>
              {error ? <Text style={styles.staleText}>{t("managerUnavailable")}</Text> : null}
            </View>
            <View style={styles.searchBox}>
              <TabIcon name="search" color={colors.faint} size={20} />
              <TextInput
                accessibilityLabel={t("managerSearch")}
                accessibilityHint={t("managerSearchHint")}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={120}
                onChangeText={(value) => {
                  sequence.current += 1
                  setSearch(value)
                }}
                placeholder={t("managerSearchHint")}
                placeholderTextColor={colors.faint}
                returnKeyType="search"
                style={styles.searchInput}
                value={search}
              />
            </View>
            <Text style={styles.pageInfo}>{t("managerLoadedOfTotal", { loaded: data.agents.length, total: data.page.total })}</Text>
            {supportsTodayContract && data.today ? (
              <View style={styles.todaySummary}>
                <View style={styles.todaySummaryTop}>
                  <View style={styles.todaySummaryIcon}><TabIcon name="today" color={colors.primary} size={21} /></View>
                  <View style={styles.todaySummaryBody}>
                    <Text style={styles.todaySummaryTitle}>{t("managerTodayWorkdays")}</Text>
                    <Text style={styles.todaySummaryHint}>{t("managerPageActivitySummary") + " · " + t("managerTodaySnapshot", { time: formatShortDateTime(data.today.generatedAt, locale) })}</Text>
                  </View>
                </View>
                <View style={styles.todayStats}>
                  <View style={styles.todayStat}><Text style={[styles.todayStatValue, { color: colors.successDark }]}>{activeToday}</Text><Text style={styles.todayStatLabel}>{t("managerWorkingNow")}</Text></View>
                  <View style={styles.todayStat}><Text style={[styles.todayStatValue, { color: colors.warning }]}>{pausedToday}</Text><Text style={styles.todayStatLabel}>{t("managerPaused")}</Text></View>
                  <View style={styles.todayStat}><Text style={[styles.todayStatValue, { color: colors.info }]}>{completedToday}</Text><Text style={styles.todayStatLabel}>{t("managerCompleted")}</Text></View>
                </View>
              </View>
            ) : null}
            {data.agents.length === 0 ? (
              <View style={styles.state}><View style={styles.stateIcon}><TabIcon name="profile" color={colors.primary} size={25} /></View><Text style={styles.stateTitle}>{search.trim() ? t("managerNoSearchResults") : t("managerNoTeam")}</Text></View>
            ) : (
              <View style={styles.list}>
                {data.agents.map((agent) => {
                  const workday = workdayMeta(agent, supportsTodayContract)
                  const presence = agent.isOnline ? t("managerAppOnline") : t("managerAppOffline")
                  const workdayFact = workday.workedSeconds != null
                    ? t("managerWorkedTime", { time: compactWorkedTime(workday.workedSeconds) })
                    : workday.startedAt ? t("managerWorkdayStartedAt", { time: formatTime(workday.startedAt) }) : null
                  const lastSeen = agent.lastSeenAt
                    ? t("managerLastSeen") + ": " + formatShortDateTime(agent.lastSeenAt, locale)
                    : t("managerLastSeen") + ": —"
                  return (
                    <View
                      accessible
                      accessibilityLabel={agent.name + ". " + agentRoleLabel(agent.role) + ". " + presence + ". " + workday.label + (workdayFact ? ". " + workdayFact : "") + ". " + lastSeen}
                      accessibilityRole="text"
                      key={agent.id}
                      style={styles.card}
                    >
                      <View style={styles.cardTop}>
                        <View style={styles.avatar}><TabIcon name="profile" color={colors.primary} size={22} /></View>
                        <View style={styles.cardBody}>
                          <Text style={styles.name}>{agent.name}</Text>
                          <Text style={styles.role}>{agentRoleLabel(agent.role)}</Text>
                        </View>
                        <View style={[styles.presence, agent.isOnline ? styles.presenceOnline : styles.presenceOffline]}>
                          <View style={[styles.presenceDot, { backgroundColor: agent.isOnline ? colors.success : colors.faint }]} />
                          <Text style={[styles.presenceText, { color: agent.isOnline ? colors.successDark : colors.draft }]}>{presence}</Text>
                        </View>
                      </View>
                      <View style={styles.divider} />
                      <View style={styles.cardFooter}>
                        <View style={styles.workday}>
                          <View style={[styles.workdayDot, { backgroundColor: workday.color }]} />
                          <Text style={[styles.workdayText, { color: workday.color }]}>{workday.label}</Text>
                          {workday.workedSeconds != null ? <Text style={styles.workdaySince}>{t("managerWorkedTime", { time: compactWorkedTime(workday.workedSeconds) })}</Text> : null}
                          {workday.workedSeconds == null && workday.startedAt ? <Text style={styles.workdaySince}>{t("managerWorkdayStartedAt", { time: formatTime(workday.startedAt) })}</Text> : null}
                        </View>
                        <Text style={styles.lastSeen}>{agent.lastSeenAt ? lastSeen : "—"}</Text>
                      </View>
                    </View>
                  )
                })}
              </View>
            )}
            {data.page.hasMore && !hasPendingSearch ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={loadingMore ? t("fieldLoadingMore") : t("fieldLoadMore")}
                accessibilityState={{ busy: loadingMore, disabled: loading || loadingMore }}
                disabled={loading || loadingMore}
                onPress={() => void load(search.trim(), data.page.number + 1, true)}
                style={[styles.loadMore, (loading || loadingMore) && styles.disabled]}
              >
                <Text style={styles.loadMoreText}>{loadingMore ? t("fieldLoadingMore") : t("fieldLoadMore")}</Text>
              </Pressable>
            ) : null}
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
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.9 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  refresh: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  scope: { marginHorizontal: 14, marginTop: 16, borderRadius: radii.inner, backgroundColor: colors.primarySoft, padding: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  scopeText: { flex: 1, color: colors.primary, fontSize: 10, fontWeight: "900" },
  staleText: { color: colors.warning, fontSize: 9, fontWeight: "800" },
  searchBox: { minHeight: 48, marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13 },
  searchInput: { flex: 1, minHeight: 46, color: colors.text, fontSize: 12 },
  pageInfo: { marginHorizontal: 16, marginTop: 7, color: colors.muted, fontSize: 9, fontWeight: "800" },
  todaySummary: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, padding: 13, ...cardShadow },
  todaySummaryTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  todaySummaryIcon: { width: 39, height: 39, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  todaySummaryBody: { flex: 1, minWidth: 0 },
  todaySummaryTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  todaySummaryHint: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 2 },
  todayStats: { marginTop: 13, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, flexDirection: "row" },
  todayStat: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  todayStatValue: { fontSize: 19, lineHeight: 22, fontWeight: "900" },
  todayStatLabel: { color: colors.muted, fontSize: 8, lineHeight: 11, fontWeight: "800", textAlign: "center", marginTop: 2 },
  list: { paddingTop: 3 },
  card: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, backgroundColor: colors.card, padding: 14, ...cardShadow },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
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
  loadMore: { minHeight: 44, marginHorizontal: 14, marginTop: 12, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  loadMoreText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.45 },
})
