import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { fieldApi } from "../api/mobile-client"
import type { FieldContactListData, FieldOrganizationListData, FieldRoutePoint } from "./contracts"
import { t, useLocale } from "../i18n"
import { colors, radii } from "../theme"
import { routeTargetKey } from "./route-target"
import { contactTypeLabel, objectTypeLabel } from "./labels"

export { routeTargetKey } from "./route-target"

export type RouteTarget = {
  key: string
  customer: FieldRoutePoint["customer"]
  contact: FieldRoutePoint["contact"]
}

export function RouteTargetPicker({
  excluded,
  onSelect,
  onCancel,
}: {
  excluded: ReadonlySet<string>
  onSelect: (target: RouteTarget) => void
  onCancel: () => void
}) {
  useLocale()
  const [tab, setTab] = useState<"organizations" | "contacts">("organizations")
  const [search, setSearch] = useState("")
  const [organizations, setOrganizations] = useState<FieldOrganizationListData | null>(null)
  const [contacts, setContacts] = useState<FieldContactListData | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const sequence = useRef(0)

  const load = useCallback(async (active: typeof tab, query: string, page = 1, append = false) => {
    const request = ++sequence.current
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(false)
    try {
      if (active === "organizations") {
        const next = await fieldApi.organizations(query, page)
        if (request === sequence.current) {
          setOrganizations((current) => {
            if (!append || !current) return next
            const ids = new Set(current.organizations.map((item) => item.id))
            return { ...next, organizations: [...current.organizations, ...next.organizations.filter((item) => !ids.has(item.id))] }
          })
        }
      } else {
        const next = await fieldApi.contacts(query, page)
        if (request === sequence.current) {
          setContacts((current) => {
            if (!append || !current) return next
            const ids = new Set(current.contacts.map((item) => item.id))
            return { ...next, contacts: [...current.contacts, ...next.contacts.filter((item) => !ids.has(item.id))] }
          })
        }
      }
    } catch {
      if (request === sequence.current) setError(true)
    } finally {
      if (request === sequence.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => void load(tab, search.trim()), 300)
    return () => clearTimeout(id)
  }, [load, search, tab])

  const current = tab === "organizations" ? organizations : contacts
  const loadedCount = tab === "organizations" ? organizations?.organizations.length ?? 0 : contacts?.contacts.length ?? 0
  const hasMore = Boolean(current && loadedCount < current.total)

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerBody}>
          <Text style={styles.title}>{t("addStop")}</Text>
          <Text style={styles.subtitle}>{t("chooseStop")}</Text>
        </View>
        <Pressable onPress={onCancel} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
      </View>
      <View style={styles.tabs}>
        <Pressable onPress={() => setTab("organizations")} style={[styles.tab, tab === "organizations" && styles.tabActive]}><Text style={[styles.tabText, tab === "organizations" && styles.tabTextActive]}>{t("organizationStops")}</Text></Pressable>
        <Pressable onPress={() => setTab("contacts")} style={[styles.tab, tab === "contacts" && styles.tabActive]}><Text style={[styles.tabText, tab === "contacts" && styles.tabTextActive]}>{t("contactStops")}</Text></Pressable>
      </View>
      <View style={styles.search}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput value={search} onChangeText={setSearch} placeholder={tab === "organizations" ? t("organizationsSearch") : t("contactsSearch")} placeholderTextColor={colors.faint} style={styles.searchInput} autoCorrect={false} />
      </View>
      {error ? <Text style={styles.error}>{t("fieldDataError")}</Text> : null}
      {loading && !(tab === "organizations" ? organizations : contacts) ? <Text style={styles.loading}>…</Text> : null}
      <ScrollView nestedScrollEnabled style={styles.results} contentContainerStyle={styles.resultsContent} keyboardShouldPersistTaps="handled">
        {tab === "organizations" ? organizations?.organizations.map((organization) => {
          const key = routeTargetKey(organization.id)
          const disabled = excluded.has(key)
          return (
            <Pressable key={organization.id} disabled={disabled} onPress={() => onSelect({
              key,
              customer: {
                id: organization.id,
                name: organization.name,
                code: organization.code,
                objectType: organization.objectType,
                category: organization.category,
                address: organization.address,
                city: organization.city,
                phone: organization.phone,
                latitude: organization.latitude,
                longitude: organization.longitude,
              },
              contact: null,
            })} style={[styles.result, disabled && styles.disabled]}>
              <View style={styles.orgMark}><Text style={styles.orgMarkText}>{organization.name.charAt(0).toUpperCase()}</Text></View>
              <View style={styles.resultBody}><Text style={styles.resultName}>{organization.name}</Text><Text style={styles.resultMeta}>{objectTypeLabel(organization.objectType)} · {organization.city ?? organization.address ?? "—"}</Text>{disabled ? <Text style={styles.added}>{t("stopAlreadyAdded")}</Text> : null}</View>
              <Text style={styles.plus}>{disabled ? "✓" : "+"}</Text>
            </Pressable>
          )
        }) : contacts?.contacts.map((contact) => (
          <View key={contact.id} style={styles.contactCard}>
            <View style={styles.contactTop}>
              <View style={styles.contactMark}><Text style={styles.contactMarkText}>{contact.displayName.charAt(0).toUpperCase()}</Text></View>
              <View style={styles.resultBody}><Text style={styles.resultName}>{contact.displayName}</Text><Text style={styles.resultMeta}>{contact.specialtyName ?? contactTypeLabel(contact.type)}</Text></View>
            </View>
            {contact.workplaces?.length ? contact.workplaces.map((workplace) => {
              const key = routeTargetKey(workplace.customer.id, contact.id)
              const disabled = excluded.has(key)
              return (
                <Pressable key={workplace.id} disabled={disabled} onPress={() => onSelect({
                  key,
                  customer: workplace.customer,
                  contact: {
                    id: contact.id,
                    displayName: contact.displayName,
                    type: contact.type,
                    specialtyName: contact.specialtyName,
                    phone: contact.phone,
                  },
                })} style={[styles.workplace, disabled && styles.disabled]}>
                  <View style={styles.workplaceBody}><Text style={styles.workplaceName}>{workplace.customer.name}</Text><Text style={styles.workplaceMeta}>{[workplace.customer.city, workplace.customer.address].filter(Boolean).join(" · ") || objectTypeLabel(workplace.customer.objectType)}</Text></View>
                  {workplace.isPrimary ? <Text style={styles.primary}>{t("primaryWorkplace")}</Text> : null}
                  <Text style={styles.plus}>{disabled ? "✓" : "+"}</Text>
                </Pressable>
              )
            }) : <Text style={styles.noWorkplace}>{t("workplacesLabel")}: 0</Text>}
          </View>
        ))}
        {hasMore ? (
          <Pressable
            accessibilityRole="button"
            disabled={loading || loadingMore}
            onPress={() => void load(tab, search.trim(), (current?.page ?? 0) + 1, true)}
            style={[styles.loadMore, (loading || loadingMore) && styles.disabled]}
          >
            <Text style={styles.loadMoreText}>{loadingMore ? t("fieldLoadingMore") : t("fieldLoadMore")}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { marginHorizontal: 14, marginTop: 12, maxHeight: 570, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary },
  header: { flexDirection: "row", alignItems: "center", gap: 10 }, headerBody: { flex: 1 }, title: { color: colors.text, fontSize: 16, fontWeight: "900" }, subtitle: { color: colors.muted, fontSize: 10, marginTop: 3 }, close: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }, closeText: { color: colors.text, fontSize: 23, lineHeight: 24 },
  tabs: { flexDirection: "row", gap: 7, marginTop: 13 }, tab: { flex: 1, minHeight: 39, borderRadius: 11, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 }, tabActive: { backgroundColor: colors.primary }, tabText: { color: colors.muted, fontSize: 10, fontWeight: "900", textAlign: "center" }, tabTextActive: { color: colors.headerText },
  search: { minHeight: 46, marginTop: 10, borderRadius: 11, backgroundColor: colors.bg, flexDirection: "row", alignItems: "center", paddingHorizontal: 11, gap: 7 }, searchIcon: { color: colors.faint, fontSize: 20 }, searchInput: { flex: 1, minHeight: 44, color: colors.text, fontSize: 12 }, error: { color: colors.missed, fontSize: 10, fontWeight: "800", marginTop: 8 }, loading: { color: colors.primary, fontSize: 22, textAlign: "center", marginTop: 15 },
  results: { marginTop: 5 }, resultsContent: { paddingBottom: 6 }, result: { minHeight: 62, marginTop: 8, borderRadius: 13, padding: 10, backgroundColor: colors.bg, flexDirection: "row", alignItems: "center", gap: 9 }, orgMark: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" }, orgMarkText: { color: colors.info, fontSize: 15, fontWeight: "900" }, resultBody: { flex: 1, minWidth: 0 }, resultName: { color: colors.text, fontSize: 12, fontWeight: "900" }, resultMeta: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 3 }, added: { color: colors.successDark, fontSize: 8, fontWeight: "900", marginTop: 3 }, plus: { color: colors.primary, fontSize: 19, fontWeight: "900" },
  contactCard: { marginTop: 8, borderRadius: 14, padding: 10, backgroundColor: colors.bg }, contactTop: { flexDirection: "row", alignItems: "center", gap: 9 }, contactMark: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.holidayBg, alignItems: "center", justifyContent: "center" }, contactMarkText: { color: colors.holiday, fontSize: 15, fontWeight: "900" },
  workplace: { minHeight: 52, marginTop: 8, marginLeft: 47, borderRadius: 11, padding: 9, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 7 }, workplaceBody: { flex: 1, minWidth: 0 }, workplaceName: { color: colors.text, fontSize: 10, fontWeight: "900" }, workplaceMeta: { color: colors.muted, fontSize: 8, marginTop: 3 }, primary: { maxWidth: 56, color: colors.successDark, backgroundColor: colors.successBg, borderRadius: radii.pill, paddingHorizontal: 6, paddingVertical: 4, overflow: "hidden", fontSize: 7, fontWeight: "900", textAlign: "center" }, noWorkplace: { color: colors.faint, fontSize: 9, marginTop: 8, marginLeft: 47 }, loadMore: { minHeight: 43, marginTop: 10, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, loadMoreText: { color: colors.primary, fontSize: 10, fontWeight: "900" }, disabled: { opacity: 0.45 },
})
