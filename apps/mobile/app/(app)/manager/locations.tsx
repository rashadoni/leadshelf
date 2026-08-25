import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { TabIcon } from "../../../src/components/TabIcon"
import type { FieldManagerGpsFreshness, FieldManagerLocationAgent, FieldManagerLocationsData } from "../../../src/field/contracts"
import { t, type MessageKey, useLocale } from "../../../src/i18n"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { HttpError } from "../../../src/sync/ports-error"
import { cardShadow, colors, radii } from "../../../src/theme"
import { agentRoleLabel } from "../../../src/field/labels"

const freshnessKeys: Record<FieldManagerGpsFreshness, MessageKey> = {
  ONLINE: "managerFreshness_ONLINE",
  DELAYED: "managerFreshness_DELAYED",
  STALE: "managerFreshness_STALE",
  NO_LOCATION: "managerFreshness_NO_LOCATION",
}

const MANAGER_PAGE_LIMIT = 25

function freshnessColor(freshness: FieldManagerGpsFreshness): { background: string; foreground: string } {
  if (freshness === "ONLINE") return { background: colors.successBg, foreground: colors.successDark }
  if (freshness === "DELAYED") return { background: colors.warningBg, foreground: colors.warning }
  if (freshness === "STALE") return { background: colors.draftBg, foreground: colors.draft }
  return { background: colors.infoBg, foreground: colors.info }
}

function openLiveMap(agent: FieldManagerLocationAgent) {
  const location = agent.liveLocation
  if (!location) return
  const query = String(location.latitude) + "," + String(location.longitude)
  const url = Platform.OS === "ios"
    ? "https://maps.apple.com/?q=" + encodeURIComponent(query)
    : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query)
  void Linking.openURL(url).catch(() => {})
}

export default function ManagerLocationsScreen() {
  const locale = useLocale()
  const [data, setData] = useState<FieldManagerLocationsData | null>(null)
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
      const next = await fieldApi.managerLocations({ page, limit: MANAGER_PAGE_LIMIT, search: query || undefined })
      if (request !== sequence.current) return
      setLoadedSearch(query)
      setData((current) => {
        if (!append || !current) return next
        const existing = new Set(current.locations.map((agent) => agent.id))
        return {
          ...next,
          locations: [...current.locations, ...next.locations.filter((agent) => !existing.has(agent.id))],
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
  const liveCount = useMemo(
    () => data?.locations.filter((agent) => agent.freshness === "ONLINE").length ?? 0,
    [data],
  )
  const hasPendingSearch = loadedSearch !== search.trim()

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load(search.trim())} tintColor={colors.primary} />} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.back}><TabIcon name="chevronLeft" color={colors.text} size={23} /></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("managerHomeTitle").toUpperCase()}</Text>
            <Text style={styles.title}>{t("managerLocationsTitle")}</Text>
            <Text style={styles.subtitle}>{t("managerLocationsHint")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} disabled={loading || loadingMore} onPress={() => void load(search.trim())} style={styles.refresh}><TabIcon name="refresh" color={colors.primary} size={22} /></Pressable>
        </View>

        {loading && !data ? <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>{t("managerLoading")}</Text></View> : null}
        {error && !data ? (
          <View style={[styles.state, denied && styles.stateWarning]}>
            <View style={styles.stateIcon}><TabIcon name="location" color={denied ? colors.warning : colors.primary} size={25} /></View>
            <Text style={styles.stateTitle}>{denied ? t("managerAccessDeniedTitle") : t("managerUnavailable")}</Text>
            <Text style={styles.stateText}>{denied ? t("managerAccessDeniedBody") : t("managerRetry")}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load(search.trim())} style={styles.retry}><Text style={styles.retryText}>{t("managerRetry")}</Text></Pressable>
          </View>
        ) : null}

        {data ? (
          <>
            <View style={styles.searchBox}>
              <TabIcon name="search" color={colors.faint} size={20} />
              <TextInput
                accessibilityLabel={t("managerSearch")}
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
            <View style={styles.summary}>
              <View style={styles.summaryIcon}><TabIcon name="location" color={colors.successDark} size={22} /></View>
              <View style={styles.summaryBody}>
                <Text style={styles.summaryValue}>{liveCount}</Text>
                <Text style={styles.summaryLabel}>{t("managerPageLocationSummary")}</Text>
              </View>
              <Text style={styles.summaryTime}>{t("managerUpdated") + ": " + formatShortDateTime(data.generatedAt, locale)}</Text>
            </View>
            <Text style={styles.pageInfo}>{t("managerLoadedOfTotal", { loaded: data.locations.length, total: data.page.total })}</Text>
            {liveCount === 0 && data.locations.length > 0 ? <View style={styles.notice}><Text style={styles.noticeText}>{t("managerNoLiveLocations")}</Text></View> : null}
            {data.locations.length === 0 ? (
              <View style={styles.state}><View style={styles.stateIcon}><TabIcon name="location" color={colors.primary} size={25} /></View><Text style={styles.stateTitle}>{search.trim() ? t("managerNoSearchResults") : t("managerNoTeam")}</Text></View>
            ) : (
              <View style={styles.list}>
                {data.locations.map((agent) => {
                  const tone = freshnessColor(agent.freshness)
                  const point = agent.liveLocation ?? agent.lastKnownLocation
                  return (
                    <View key={agent.id} style={styles.card}>
                      <View style={styles.cardTop}>
                        <View style={[styles.avatar, { backgroundColor: tone.background }]}><Text style={[styles.avatarText, { color: tone.foreground }]}>{agent.name.charAt(0).toUpperCase()}</Text></View>
                        <View style={styles.cardBody}>
                          <Text style={styles.name}>{agent.name}</Text>
                          <Text style={styles.role}>{agentRoleLabel(agent.role)}</Text>
                        </View>
                        <View style={[styles.freshness, { backgroundColor: tone.background }]}><Text style={[styles.freshnessText, { color: tone.foreground }]}>{t(freshnessKeys[agent.freshness])}</Text></View>
                      </View>
                      {point ? (
                        <View style={styles.locationLine}>
                          <TabIcon name="location" color={tone.foreground} size={17} />
                          <View style={styles.locationBody}>
                            <Text style={[styles.locationTime, { color: tone.foreground }]}>{formatShortDateTime(point.recordedAt, locale)}</Text>
                            {agent.freshness !== "ONLINE" ? <Text style={styles.locationHint}>{t("managerLastKnownNotLive")}</Text> : null}
                          </View>
                          {agent.freshness === "ONLINE" && agent.liveLocation ? (
                            <Pressable accessibilityRole="button" accessibilityLabel={t("managerOpenLiveMap")} onPress={() => openLiveMap(agent)} style={styles.mapButton}>
                              <TabIcon name="route" color={colors.primary} size={18} />
                            </Pressable>
                          ) : null}
                        </View>
                      ) : (
                        <View style={styles.noLocation}><Text style={styles.noLocationText}>{t("managerFreshness_NO_LOCATION")}</Text></View>
                      )}
                      <View style={styles.cardFooter}>
                        <Text style={styles.presence}>{agent.isOnline ? t("managerAppOnline") : t("managerAppOffline")}</Text>
                        <Text style={styles.lastSeen}>{agent.lastSeenAt ? t("managerLastSeen") + ": " + formatShortDateTime(agent.lastSeenAt, locale) : "—"}</Text>
                      </View>
                    </View>
                  )
                })}
              </View>
            )}
            {data.page.hasMore && !hasPendingSearch ? (
              <Pressable
                accessibilityRole="button"
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
  searchBox: { minHeight: 48, marginHorizontal: 14, marginTop: 16, borderRadius: radii.inner, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13 },
  searchInput: { flex: 1, minHeight: 46, color: colors.text, fontSize: 12 },
  summary: { marginHorizontal: 14, marginTop: 16, padding: 14, borderRadius: radii.card, backgroundColor: colors.successBg, borderWidth: 1, borderColor: colors.successBorder, flexDirection: "row", alignItems: "center", gap: 10 },
  summaryIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.cardOverlay, alignItems: "center", justifyContent: "center" },
  summaryBody: { flex: 1 },
  summaryValue: { color: colors.successDark, fontSize: 24, lineHeight: 26, fontWeight: "900" },
  summaryLabel: { color: colors.successDark, fontSize: 10, fontWeight: "900", marginTop: 1 },
  summaryTime: { maxWidth: 114, color: colors.successDark, fontSize: 8, lineHeight: 12, textAlign: "right", fontWeight: "700" },
  pageInfo: { marginHorizontal: 16, marginTop: 7, color: colors.muted, fontSize: 9, fontWeight: "800" },
  notice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder, padding: 11 },
  noticeText: { color: colors.info, fontSize: 10, lineHeight: 15, fontWeight: "800" },
  list: { paddingTop: 1 },
  card: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, backgroundColor: colors.card, padding: 14, ...cardShadow },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontWeight: "900" },
  cardBody: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 14, fontWeight: "900" },
  role: { color: colors.muted, fontSize: 9, fontWeight: "800", marginTop: 3 },
  freshness: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: radii.pill },
  freshnessText: { fontSize: 8, fontWeight: "900" },
  locationLine: { marginTop: 12, borderRadius: radii.inner, backgroundColor: colors.bg, padding: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  locationBody: { flex: 1, minWidth: 0 },
  locationTime: { fontSize: 10, fontWeight: "900" },
  locationHint: { color: colors.muted, fontSize: 8, lineHeight: 12, marginTop: 2 },
  mapButton: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  noLocation: { marginTop: 12, borderRadius: radii.inner, backgroundColor: colors.infoBg, padding: 10 },
  noLocationText: { color: colors.info, fontSize: 10, fontWeight: "800" },
  cardFooter: { marginTop: 11, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, flexDirection: "row", justifyContent: "space-between", gap: 10 },
  presence: { color: colors.muted, fontSize: 8, fontWeight: "800" },
  lastSeen: { maxWidth: "55%", color: colors.faint, fontSize: 8, textAlign: "right", fontWeight: "700" },
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
