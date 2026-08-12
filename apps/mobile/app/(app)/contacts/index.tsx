import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { readFieldCache, writeFieldCache } from "../../../src/db/local-store"
import type { FieldContactListData } from "../../../src/field/contracts"
import { t, useLocale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"
import { useResponsiveLayout } from "../../../src/layout/responsive"

const CACHE_KEY = "field.contacts"

export default function ContactsScreen() {
  useLocale()
  const cached = readFieldCache<FieldContactListData>(CACHE_KEY)
  const [data, setData] = useState<FieldContactListData | null>(cached?.value ?? null)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)
  const layout = useResponsiveLayout()

  const load = useCallback(async (query = "") => {
    const request = ++sequence.current
    setLoading(true)
    setError(null)
    try {
      const next = await fieldApi.contacts(query)
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
            <Text style={styles.title}>{t("contactsTitle")}</Text>
            <Text style={styles.subtitle}>{data?.total ?? 0}</Text>
          </View>
        </View>

        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder={t("contactsSearch")} placeholderTextColor={colors.faint} autoCorrect={false} />
        </View>
        {error ? <View style={styles.notice}><Text style={styles.noticeText}>{data ? t("fieldDataStale") : t("fieldDataError")}</Text></View> : null}

        {data?.contacts.length ? (
          <View style={[styles.list, layout.isTablet && styles.listTablet]}>
            {data.contacts.map((contact) => {
              const primary = contact.workplaces?.find((workplace) => workplace.isPrimary) ?? contact.workplaces?.[0]
              return (
                <Pressable key={contact.id} onPress={() => router.push(`/(app)/contacts/${contact.id}` as never)} style={({ pressed }) => [styles.card, layout.isTablet && styles.cardTablet, pressed && styles.pressed]}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{contact.displayName.charAt(0).toUpperCase()}</Text></View>
                  <View style={styles.body}>
                    <Text style={styles.name}>{contact.displayName}</Text>
                    <Text style={styles.meta}>{contact.specialtyName ?? contact.type} · {t("categoryLabel")} {contact.category}</Text>
                    {primary ? <Text style={styles.workplace} numberOfLines={2}>{primary.customer.name}{primary.customer.city ? ` · ${primary.customer.city}` : ""}</Text> : null}
                    {contact.phone ? <Text style={styles.phone}>{contact.phone}</Text> : null}
                  </View>
                  <Text style={styles.arrow}>›</Text>
                </Pressable>
              )
            })}
          </View>
        ) : !loading ? <View style={styles.empty}><Text style={styles.emptyText}>{t("contactsEmpty")}</Text></View> : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { minHeight: "100%", paddingBottom: 28 },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  backText: { color: colors.text, fontSize: 30, lineHeight: 31 }, headerBody: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 }, title: { color: colors.text, fontSize: 23, fontWeight: "900", marginTop: 2 }, subtitle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  searchBox: { marginHorizontal: 14, marginTop: 14, minHeight: 50, borderRadius: radii.inner, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, gap: 8 },
  searchIcon: { color: colors.faint, fontSize: 21 }, searchInput: { flex: 1, color: colors.text, fontSize: 14, minHeight: 48 },
  notice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.warningBg }, noticeText: { color: colors.warning, fontSize: 11, fontWeight: "800" },
  list: { paddingTop: 4 }, card: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, backgroundColor: colors.card, padding: 13, flexDirection: "row", alignItems: "flex-start", gap: 11, ...cardShadow },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.holidayBg, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.holiday, fontSize: 17, fontWeight: "900" },
  body: { flex: 1, minWidth: 0 }, name: { color: colors.text, fontSize: 14, fontWeight: "900" }, meta: { color: colors.primary, fontSize: 10, fontWeight: "700", marginTop: 3 }, workplace: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 5 }, phone: { color: colors.successDark, fontSize: 10, fontWeight: "800", marginTop: 5 },
  arrow: { color: colors.faint, fontSize: 26, lineHeight: 29 }, empty: { margin: 14, minHeight: 220, backgroundColor: colors.card, borderRadius: radii.card, alignItems: "center", justifyContent: "center" }, emptyText: { color: colors.muted, fontSize: 14, fontWeight: "700" }, pressed: { opacity: 0.7 },
  listTablet: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 14, paddingTop: 12, alignItems: "flex-start" },
  cardTablet: { flexBasis: "48%", flexGrow: 1, marginHorizontal: 0, marginTop: 0 },
})
