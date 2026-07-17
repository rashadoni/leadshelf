import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { readFieldCache, writeFieldCache } from "../../../src/db/local-store"
import type { FieldOrganizationListData } from "../../../src/field/contracts"
import { t, useLocale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"

const CACHE_KEY = "field.organizations"

export default function OrganizationsScreen() {
  useLocale()
  const cached = readFieldCache<FieldOrganizationListData>(CACHE_KEY)
  const [data, setData] = useState<FieldOrganizationListData | null>(cached?.value ?? null)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)

  const load = useCallback(async (query = "") => {
    const request = ++sequence.current
    setLoading(true)
    setError(null)
    try {
      const next = await fieldApi.organizations(query)
      if (request !== sequence.current) return
      setData(next)
      if (!query) writeFieldCache(CACHE_KEY, next)
    } catch (reason) {
      if (request === sequence.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (request === sequence.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => void load(search.trim()), 350)
    return () => clearTimeout(id)
  }, [load, search])

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load(search.trim())} />}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("tabWork").toUpperCase()}</Text>
            <Text style={styles.title}>{t("organizationsTitle")}</Text>
            <Text style={styles.subtitle}>{data?.total ?? 0}</Text>
          </View>
          <Pressable onPress={() => router.push("/(app)/customer-requests/new" as never)} style={styles.addButton}><Text style={styles.addText}>＋</Text></Pressable>
        </View>

        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={t("organizationsSearch")}
            placeholderTextColor={colors.faint}
            autoCorrect={false}
          />
        </View>

        {error ? <View style={styles.notice}><Text style={styles.noticeText}>{data ? t("fieldDataStale") : t("fieldDataError")}</Text></View> : null}

        {data?.organizations.length ? (
          <View style={styles.list}>
            {data.organizations.map((organization) => (
              <Pressable
                key={organization.id}
                onPress={() => router.push(`/(app)/organizations/${organization.id}` as never)}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                <View style={styles.orgMark}><Text style={styles.orgMarkText}>{organization.name.charAt(0).toUpperCase()}</Text></View>
                <View style={styles.body}>
                  <Text style={styles.name}>{organization.name}</Text>
                  <Text style={styles.meta}>{organization.objectType} · {t("categoryLabel")} {organization.category}</Text>
                  {organization.address || organization.city ? <Text style={styles.address} numberOfLines={2}>{[organization.city, organization.address].filter(Boolean).join(" · ")}</Text> : null}
                  <View style={styles.statsRow}>
                    <Text style={styles.stat}>{organization._count?.contactWorkplaces ?? 0} {t("contactsLabel").toLowerCase()}</Text>
                    <Text style={styles.stat}>{organization._count?.visits ?? 0} {t("visitsLabel").toLowerCase()}</Text>
                  </View>
                </View>
                <Text style={styles.arrow}>›</Text>
              </Pressable>
            ))}
          </View>
        ) : !loading ? (
          <View style={styles.empty}><Text style={styles.emptyText}>{t("organizationsEmpty")}</Text></View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 28 },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  backText: { color: colors.text, fontSize: 30, lineHeight: 31 },
  headerBody: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 23, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  addButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  addText: { color: colors.headerText, fontSize: 23, lineHeight: 25 },
  searchBox: { marginHorizontal: 14, marginTop: 14, minHeight: 50, borderRadius: radii.inner, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, gap: 8 },
  searchIcon: { color: colors.faint, fontSize: 21 },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, minHeight: 48 },
  notice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.warningBg },
  noticeText: { color: colors.warning, fontSize: 11, fontWeight: "800" },
  list: { paddingTop: 4 },
  card: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, backgroundColor: colors.card, padding: 13, flexDirection: "row", alignItems: "flex-start", gap: 11, ...cardShadow },
  orgMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" },
  orgMarkText: { color: colors.info, fontSize: 17, fontWeight: "900" },
  body: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 14, fontWeight: "900" },
  meta: { color: colors.primary, fontSize: 10, fontWeight: "700", marginTop: 3 },
  address: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 5 },
  statsRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  stat: { color: colors.faint, fontSize: 10, fontWeight: "700" },
  arrow: { color: colors.faint, fontSize: 26, lineHeight: 29 },
  empty: { margin: 14, minHeight: 220, backgroundColor: colors.card, borderRadius: radii.card, alignItems: "center", justifyContent: "center" },
  emptyText: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  pressed: { opacity: 0.7 },
})
