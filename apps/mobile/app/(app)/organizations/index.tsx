import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { readFieldCache, writeFieldCache } from "../../../src/db/local-store"
import type { FieldOrganizationListData } from "../../../src/field/contracts"
import { fieldErrorMessage } from "../../../src/field/error-message"
import { t, useLocale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"
import { useResponsiveLayout } from "../../../src/layout/responsive"
import { objectTypeLabel } from "../../../src/field/labels"
import { TabIcon } from "../../../src/components/TabIcon"
import { safeFieldBack } from "../../../src/navigation/safe-back"

const CACHE_KEY = "field.organizations"

export default function OrganizationsScreen() {
  useLocale()
  const cached = readFieldCache<FieldOrganizationListData>(CACHE_KEY)
  const [data, setData] = useState<FieldOrganizationListData | null>(cached?.value ?? null)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(!cached)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)
  const layout = useResponsiveLayout()

  const load = useCallback(async (query = "", page = 1, append = false) => {
    const request = ++sequence.current
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const next = await fieldApi.organizations({ search: query, page })
      if (request !== sequence.current) return
      setData((current) => {
        if (!append || !current) return next
        const ids = new Set(current.organizations.map((item) => item.id))
        return { ...next, organizations: [...current.organizations, ...next.organizations.filter((item) => !ids.has(item.id))] }
      })
      if (!query && !append) writeFieldCache(CACHE_KEY, next)
    } catch (reason) {
      if (request === sequence.current) setError(fieldErrorMessage(reason, "fieldDataError"))
    } finally {
      if (request === sequence.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => void load(search.trim()), 350)
    return () => clearTimeout(id)
  }, [load, search])

  const hasMore = Boolean(data && data.organizations.length < data.total)

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load(search.trim())} />}
      >
        <View style={[styles.content, layout.isTablet && styles.contentTablet]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => safeFieldBack("/(app)/(tabs)/work")} style={styles.back}>
            <TabIcon name="chevronLeft" color={colors.text} size={23} />
          </Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("tabWork").toUpperCase()}</Text>
            <Text style={styles.title}>{t("organizationsTitle")}</Text>
            <Text style={styles.subtitle}>{data?.total ?? 0}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("newCustomerRequest")} onPress={() => router.push("/(app)/customer-requests/new" as never)} style={styles.addButton}>
            <TabIcon name="add" color={colors.headerText} size={23} />
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <TabIcon name="search" color={colors.faint} size={20} />
          <TextInput
            accessibilityLabel={t("organizationsSearch")}
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={t("organizationsSearch")}
            placeholderTextColor={colors.faint}
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>

        {error ? <View style={styles.notice}><Text style={styles.noticeText}>{data ? t("fieldDataStale") : t("fieldDataError")}</Text></View> : null}

        {data?.organizations.length ? (
          <>
          <View style={[styles.list, layout.isTablet && styles.listTablet]}>
            {data.organizations.map((organization) => (
              <Pressable
                key={organization.id}
                accessibilityRole="button"
                accessibilityLabel={`${t("organizationsTitle")}: ${organization.name}`}
                onPress={() => router.push(`/(app)/organizations/${organization.id}` as never)}
                style={({ pressed }) => [styles.card, layout.isTablet && styles.cardTablet, pressed && styles.pressed]}
              >
                <View style={styles.orgMark}><Text style={styles.orgMarkText}>{organization.name.charAt(0).toUpperCase()}</Text></View>
                <View style={styles.body}>
                  <Text style={styles.name}>{organization.name}</Text>
                  <Text style={styles.meta}>{objectTypeLabel(organization.objectType)} · {t("categoryLabel")} {organization.category}</Text>
                  {organization.address || organization.city ? <Text style={styles.address} numberOfLines={2}>{[organization.city, organization.address].filter(Boolean).join(" · ")}</Text> : null}
                  <View style={styles.statsRow}>
                    <Text style={styles.stat}>{organization._count?.contactWorkplaces ?? 0} {t("contactsLabel").toLowerCase()}</Text>
                    <Text style={styles.stat}>{organization._count?.visits ?? 0} {t("visitsLabel").toLowerCase()}</Text>
                  </View>
                </View>
                <TabIcon name="chevronRight" color={colors.faint} size={21} />
              </Pressable>
            ))}
          </View>
          {hasMore ? <Pressable accessibilityRole="button" accessibilityLabel={loadingMore ? t("fieldLoadingMore") : t("fieldLoadMore")} accessibilityState={{ disabled: loading || loadingMore }} disabled={loading || loadingMore} onPress={() => void load(search.trim(), (data?.page ?? 0) + 1, true)} style={[styles.loadMore, (loading || loadingMore) && styles.pressed]}><Text style={styles.loadMoreText}>{loadingMore ? t("fieldLoadingMore") : t("fieldLoadMore")}</Text></Pressable> : null}
          </>
        ) : !loading ? (
          <View style={styles.empty}><Text style={styles.emptyText}>{t("organizationsEmpty")}</Text></View>
        ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 28 },
  content: { width: "100%" },
  contentTablet: { maxWidth: 1_060, alignSelf: "center" },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  headerBody: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 23, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  addButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  searchBox: { marginHorizontal: 14, marginTop: 14, minHeight: 50, borderRadius: radii.inner, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, gap: 8 },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, minHeight: 48 },
  notice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.warningBg },
  noticeText: { color: colors.warning, fontSize: 11, fontWeight: "800" },
  list: { paddingTop: 4 },
  card: { minHeight: 68, marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, backgroundColor: colors.card, padding: 13, flexDirection: "row", alignItems: "flex-start", gap: 11, ...cardShadow },
  orgMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" },
  orgMarkText: { color: colors.info, fontSize: 17, fontWeight: "900" },
  body: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 14, fontWeight: "900" },
  meta: { color: colors.primary, fontSize: 11, fontWeight: "700", marginTop: 3 },
  address: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 5 },
  statsRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  stat: { color: colors.faint, fontSize: 11, fontWeight: "700" },
  empty: { margin: 14, minHeight: 220, backgroundColor: colors.card, borderRadius: radii.card, alignItems: "center", justifyContent: "center" },
  emptyText: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  loadMore: { minHeight: 46, marginHorizontal: 14, marginTop: 12, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  loadMoreText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  pressed: { opacity: 0.7 },
  listTablet: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 14, paddingTop: 12, alignItems: "flex-start" },
  cardTablet: { flexBasis: "48%", flexGrow: 1, marginHorizontal: 0, marginTop: 0 },
})
