import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Alert, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { TabIcon } from "../../../src/components/TabIcon"
import type { FieldManagerGpsFreshness, FieldManagerLocationsData } from "../../../src/field/contracts"
import { t, type MessageKey, useLocale } from "../../../src/i18n"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { HttpError } from "../../../src/sync/ports-error"
import { cardShadow, colors, radii } from "../../../src/theme"
import { agentRoleLabel } from "../../../src/field/labels"
import { managerLiveMapUrl } from "../../../src/field/manager-location-map"
import { safeFieldBack } from "../../../src/navigation/safe-back"
import { FieldScreenChrome } from "../../../src/components/FieldScreenChrome"
import { useResponsiveLayout } from "../../../src/layout/responsive"
import { useField } from "../../../src/field/field-context"

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

async function openLiveMap(url: string, onUnavailable: () => void) {
  try {
    if (!await Linking.canOpenURL(url)) {
      onUnavailable()
      return
    }
    await Linking.openURL(url)
  } catch {
    onUnavailable()
  }
}

export default function ManagerLocationsScreen() {
  const locale = useLocale()
  const field = useField()
  const layout = useResponsiveLayout()
  const tenantTimeZone = field.profile?.todaySummary.timezone
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
      <FieldScreenChrome />
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load(search.trim())} tintColor={colors.primary} />} keyboardShouldPersistTaps="handled">
        <View style={[styles.content, layout.isTablet && styles.contentTablet]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => safeFieldBack("/(app)/manager")} style={styles.back}><TabIcon name="chevronLeft" color={colors.text} size={23} /></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("managerHomeTitle").toUpperCase()}</Text>
            <Text style={styles.title}>{t("managerLocationsTitle")}</Text>
            <Text style={styles.subtitle}>{t("managerLocationsHint")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} accessibilityState={{ busy: loading || loadingMore, disabled: loading || loadingMore }} disabled={loading || loadingMore} onPress={() => void load(search.trim())} style={styles.refresh}><TabIcon name="refresh" color={colors.primary} size={22} /></Pressable>
        </View>

        {loading && !data ? <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>{t("managerLoading")}</Text></View> : null}
        {error && !data ? (
          <View style={[styles.state, denied && styles.stateWarning]}>
            <View style={styles.stateIcon}><TabIcon name="location" color={denied ? colors.warning : colors.primary} size={25} /></View>
            <Text style={styles.stateTitle}>{denied ? t("managerAccessDeniedTitle") : t("managerUnavailable")}</Text>
            <Text style={styles.stateText}>{denied ? t("managerAccessDeniedBody") : t("managerRetry")}</Text>
            <Pressable accessibilityLabel={t("managerRetry")} accessibilityRole="button" accessibilityState={{ busy: loading }} onPress={() => void load(search.trim())} style={styles.retry}><Text style={styles.retryText}>{t("managerRetry")}</Text></Pressable>
          </View>
        ) : null}

        {data ? (
          <>
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
            <View accessible accessibilityRole="text" accessibilityLabel={String(liveCount) + " " + t("managerPageLocationSummary") + ". " + t("managerUpdated") + ": " + formatShortDateTime(data.generatedAt, locale, tenantTimeZone)} style={styles.summary}>
              <View style={styles.summaryIcon}><TabIcon name="location" color={colors.successDark} size={22} /></View>
              <View style={styles.summaryBody}>
                <Text style={styles.summaryValue}>{liveCount}</Text>
                <Text style={styles.summaryLabel}>{t("managerPageLocationSummary")}</Text>
                <Text style={styles.summaryTime}>{t("managerUpdated") + ": " + formatShortDateTime(data.generatedAt, locale, tenantTimeZone)}</Text>
              </View>
            </View>
            <Text style={styles.pageInfo}>{t("managerLoadedOfTotal", { loaded: data.locations.length, total: data.page.total })}</Text>
            {liveCount === 0 && data.locations.length > 0 ? <View style={styles.notice}><Text style={styles.noticeText}>{t("managerNoLiveLocations")}</Text></View> : null}
            {data.locations.length === 0 ? (
              <View style={styles.state}><View style={styles.stateIcon}><TabIcon name="location" color={colors.primary} size={25} /></View><Text style={styles.stateTitle}>{search.trim() ? t("managerNoSearchResults") : t("managerNoTeam")}</Text></View>
            ) : (
              <View style={[styles.list, layout.isTablet && styles.listTablet]}>
                {data.locations.map((agent) => {
                  const tone = freshnessColor(agent.freshness)
                  const point = agent.liveLocation ?? agent.lastKnownLocation
                  const liveMapUrl = managerLiveMapUrl(agent, Platform.OS)
                  const freshness = t(freshnessKeys[agent.freshness])
                  const pointState = point
                    ? agent.freshness === "ONLINE" ? t("managerFreshness_ONLINE") : t("managerLastKnownNotLive")
                    : t("managerFreshness_NO_LOCATION")
                  const lastSeen = agent.lastSeenAt
                    ? t("managerLastSeen") + ": " + formatShortDateTime(agent.lastSeenAt, locale, tenantTimeZone)
                    : t("managerLastSeen") + ": —"
                  return (
                    <View key={agent.id} style={[styles.card, layout.isTablet && styles.cardTablet]}>
                      <View accessible accessibilityRole="text" accessibilityLabel={agent.name + ". " + agentRoleLabel(agent.role) + ". " + freshness} style={styles.cardTop}>
                        <View style={[styles.avatar, { backgroundColor: tone.background }]}><Text style={[styles.avatarText, { color: tone.foreground }]}>{agent.name.charAt(0).toUpperCase()}</Text></View>
                        <View style={styles.cardBody}>
                          <Text style={styles.name}>{agent.name}</Text>
                          <Text style={styles.role}>{agentRoleLabel(agent.role)}</Text>
                        </View>
                        <View style={[styles.freshness, { backgroundColor: tone.background }]}><Text style={[styles.freshnessText, { color: tone.foreground }]}>{t(freshnessKeys[agent.freshness])}</Text></View>
                      </View>
                      {point ? (
                        <>
                          <View style={styles.locationLine}>
                            <TabIcon name="location" color={tone.foreground} size={17} />
                            <View
                              accessible
                              accessibilityLabel={pointState + ". " + t("managerUpdated") + ": " + formatShortDateTime(point.recordedAt, locale, tenantTimeZone)}
                              accessibilityRole="text"
                              style={styles.locationBody}
                            >
                              <Text style={[styles.locationState, { color: tone.foreground }]}>{pointState}</Text>
                              <Text style={styles.locationTime}>{t("managerUpdated") + ": " + formatShortDateTime(point.recordedAt, locale, tenantTimeZone)}</Text>
                              {agent.freshness !== "ONLINE" ? <Text style={styles.locationHint}>{t("managerLastKnownNotLive")}</Text> : null}
                            </View>
                          </View>
                          {liveMapUrl ? (
                            <Pressable accessibilityHint={t("managerOpenLiveMapHint")} accessibilityRole="button" accessibilityLabel={t("managerOpenLiveMap") + ": " + agent.name} onPress={() => void openLiveMap(liveMapUrl, () => Alert.alert(t("managerLiveMapUnavailable")))} style={({ pressed }) => [styles.mapButton, pressed && styles.pressed]}>
                              <TabIcon name="route" color={colors.primary} size={18} />
                              <Text style={styles.mapButtonText}>{t("managerOpenLiveMap")}</Text>
                              <TabIcon name="chevronRight" color={colors.primary} size={19} />
                            </Pressable>
                          ) : null}
                        </>
                      ) : (
                        <View accessible accessibilityRole="text" accessibilityLabel={pointState} style={styles.noLocation}><Text style={styles.noLocationText}>{t("managerFreshness_NO_LOCATION")}</Text></View>
                      )}
                      <View accessible accessibilityRole="text" accessibilityLabel={(agent.isOnline ? t("managerAppOnline") : t("managerAppOffline")) + ". " + lastSeen} style={styles.cardFooter}>
                        <Text style={styles.presence}>{agent.isOnline ? t("managerAppOnline") : t("managerAppOffline")}</Text>
                        <Text style={styles.lastSeen}>{agent.lastSeenAt ? t("managerLastSeen") + ": " + formatShortDateTime(agent.lastSeenAt, locale, tenantTimeZone) : "—"}</Text>
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
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 32 },
  content: { width: "100%" },
  contentTablet: { maxWidth: 1_060, alignSelf: "center" },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.9 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  refresh: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  searchBox: { minHeight: 48, marginHorizontal: 14, marginTop: 16, borderRadius: radii.inner, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13 },
  searchInput: { flex: 1, minHeight: 46, color: colors.text, fontSize: 13 },
  summary: { marginHorizontal: 14, marginTop: 16, padding: 14, borderRadius: radii.card, backgroundColor: colors.successBg, borderWidth: 1, borderColor: colors.successBorder, flexDirection: "row", alignItems: "center", gap: 10 },
  summaryIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.cardOverlay, alignItems: "center", justifyContent: "center" },
  summaryBody: { flex: 1 },
  summaryValue: { color: colors.successDark, fontSize: 24, lineHeight: 26, fontWeight: "900" },
  summaryLabel: { color: colors.successDark, fontSize: 11, fontWeight: "900", marginTop: 1 },
  summaryTime: { color: colors.successDark, fontSize: 11, lineHeight: 16, marginTop: 3, fontWeight: "700" },
  pageInfo: { marginHorizontal: 16, marginTop: 7, color: colors.muted, fontSize: 11, fontWeight: "800" },
  notice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder, padding: 11 },
  noticeText: { color: colors.info, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  list: { paddingTop: 1 },
  listTablet: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 14, paddingTop: 12, alignItems: "flex-start" },
  card: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, backgroundColor: colors.card, padding: 14, ...cardShadow },
  cardTablet: { flexBasis: "48%", flexGrow: 1, marginHorizontal: 0, marginTop: 0 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontWeight: "900" },
  cardBody: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 15, fontWeight: "900" },
  role: { color: colors.muted, fontSize: 11, fontWeight: "800", marginTop: 3 },
  freshness: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: radii.pill },
  freshnessText: { fontSize: 11, fontWeight: "900" },
  locationLine: { minHeight: 60, marginTop: 12, borderRadius: radii.inner, backgroundColor: colors.bg, padding: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  locationBody: { flex: 1, minWidth: 0 },
  locationState: { fontSize: 12, fontWeight: "900" },
  locationTime: { color: colors.muted, fontSize: 11, lineHeight: 16, fontWeight: "700", marginTop: 2 },
  locationHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  mapButton: { minHeight: 46, marginTop: 8, borderRadius: 13, paddingHorizontal: 12, backgroundColor: colors.primarySoft, flexDirection: "row", alignItems: "center", gap: 8 },
  mapButtonText: { flex: 1, color: colors.primary, fontSize: 12, fontWeight: "900" },
  noLocation: { marginTop: 12, borderRadius: radii.inner, backgroundColor: colors.infoBg, padding: 10 },
  noLocationText: { color: colors.info, fontSize: 11, fontWeight: "800" },
  cardFooter: { marginTop: 11, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, flexDirection: "row", justifyContent: "space-between", gap: 10 },
  presence: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  lastSeen: { maxWidth: "55%", color: colors.faint, fontSize: 11, textAlign: "right", fontWeight: "700" },
  state: { minHeight: 230, margin: 14, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", padding: 24, ...cardShadow },
  stateWarning: { backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.warningBorder },
  stateIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  stateTitle: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "center" },
  stateText: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 7 },
  retry: { minHeight: 44, marginTop: 16, borderRadius: 13, paddingHorizontal: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  retryText: { color: colors.headerText, fontSize: 11, fontWeight: "900" },
  loadMore: { minHeight: 44, marginHorizontal: 14, marginTop: 12, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  loadMoreText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.45 }, pressed: { opacity: 0.72 },
})
