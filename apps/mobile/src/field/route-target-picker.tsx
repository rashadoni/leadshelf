import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { fieldApi } from "../api/mobile-client"
import type {
  FieldRouteTargetCatalogData,
  FieldRouteTargetCatalogItem,
  FieldRouteTargetType,
  FieldRoutePoint,
} from "./contracts"
import { t, useLocale } from "../i18n"
import { formatLongCalendarDate } from "../i18n/date-format"
import { colors, radii } from "../theme"
import { useResponsiveLayout } from "../layout/responsive"
import { routeTargetKey } from "./route-target"
import { contactTypeLabel, objectTypeLabel } from "./labels"
import { TabIcon } from "../components/TabIcon"

export { routeTargetKey } from "./route-target"

export type RouteTarget = {
  key: string
  customer: FieldRoutePoint["customer"]
  contact: FieldRoutePoint["contact"]
}

function targetTypeLabel(targetType: FieldRouteTargetType, locale: "az" | "ru"): string {
  return targetType.labels[locale] || targetType.labels.az
}

function targetMeta(item: FieldRouteTargetCatalogItem): string {
  if (item.contact) {
    return [item.contact.specialtyName ?? contactTypeLabel(item.contact.type), item.customer.name].filter(Boolean).join(" · ")
  }
  return item.customer.city ?? item.customer.address ?? objectTypeLabel(item.customer.objectType)
}

function availabilityLabel(item: FieldRouteTargetCatalogItem): string {
  if (item.availability.source === "DIRECT_CONTACT_ASSIGNMENT") return t("routeTargetSourceContact")
  if (item.availability.source === "WORKPLACE_ASSIGNMENT") return t("routeTargetSourceWorkplace")
  return t("routeTargetSourceCustomer")
}

export function RouteTargetPicker({
  excluded,
  agentId,
  agentName,
  date,
  onSelect,
  onCancel,
}: {
  excluded: ReadonlySet<string>
  agentId: string
  agentName: string | null
  date: string
  onSelect: (target: RouteTarget) => void
  onCancel: () => void
}) {
  const locale = useLocale()
  const layout = useResponsiveLayout()
  const [targetTypeId, setTargetTypeId] = useState<string | null>(null)
  const [targetTypes, setTargetTypes] = useState<FieldRouteTargetType[]>([])
  const [catalog, setCatalog] = useState<FieldRouteTargetCatalogData | null>(null)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const sequence = useRef(0)

  const load = useCallback(async (typeId: string | undefined, query: string, page = 1, append = false) => {
    const request = ++sequence.current
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(false)
    try {
      const next = await fieldApi.routeTargets({
        agentId,
        date,
        targetTypeId: typeId,
        search: query || undefined,
        page,
      })
      if (request !== sequence.current) return
      setTargetTypes(next.targetTypes)
      setCatalog((current) => {
        if (!append || !current) return next
        const existing = new Set(current.items.map((item) => item.targetKey + ":" + item.customer.id))
        return {
          ...next,
          items: [...current.items, ...next.items.filter((item) => !existing.has(item.targetKey + ":" + item.customer.id))],
        }
      })
    } catch {
      if (request === sequence.current) setError(true)
    } finally {
      if (request === sequence.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [agentId, date])

  useEffect(() => {
    const id = setTimeout(() => void load(targetTypeId ?? undefined, search.trim()), 300)
    return () => clearTimeout(id)
  }, [load, search, targetTypeId])

  const selectedTypeId = targetTypeId ?? catalog?.targetType.id ?? targetTypes[0]?.id ?? null
  const scopeDate = formatLongCalendarDate(date, locale)
  const scopeHint = agentName
    ? t("routeTargetScopeWithAgent", { agent: agentName, date: scopeDate })
    : t("routeTargetScope")
  const maxHeight = layout.isTablet
    ? Math.max(420, Math.min(720, layout.height - 180))
    : 590

  function changeTargetType(id: string) {
    if (id === selectedTypeId) return
    setCatalog(null)
    setTargetTypeId(id)
  }

  function select(item: FieldRouteTargetCatalogItem) {
    onSelect({
      key: item.targetKey,
      customer: item.customer,
      contact: item.contact,
    })
  }

  return (
    <View style={[styles.root, { maxHeight }, layout.isTablet && styles.rootTablet]}>
      <View style={styles.header}>
        <View style={styles.headerBody}>
          <Text style={styles.title}>{t("addStop")}</Text>
          <Text style={styles.subtitle}>{scopeHint}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t("cancel")} onPress={onCancel} style={styles.close}>
          <TabIcon name="close" color={colors.text} size={20} />
        </Pressable>
      </View>
      {targetTypes.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll} contentContainerStyle={styles.typeTabs}>
          {targetTypes.map((targetType) => {
            const active = targetType.id === selectedTypeId
            const icon: "contacts" | "organizations" = targetType.direction === "DOCTOR" ? "contacts" : "organizations"
            return (
              <Pressable
                key={targetType.id}
                accessibilityRole="button"
                accessibilityLabel={targetTypeLabel(targetType, locale)}
                accessibilityState={{ selected: active }}
                onPress={() => changeTargetType(targetType.id)}
                style={[styles.typeTab, active && styles.typeTabActive]}
              >
                <TabIcon name={icon} color={active ? colors.headerText : colors.primary} size={15} />
                <Text style={[styles.typeTabText, active && styles.typeTabTextActive]}>{targetTypeLabel(targetType, locale)}</Text>
              </Pressable>
            )
          })}
        </ScrollView>
      ) : null}
      <View style={styles.search}>
        <TabIcon name="contacts" color={colors.faint} size={18} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          accessibilityLabel={t("routeTargetSearch")}
          accessibilityHint={t("routeTargetSearchHint")}
          placeholder={t("routeTargetSearch")}
          placeholderTextColor={colors.faint}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      {error ? (
        <View accessibilityLiveRegion="polite" style={styles.errorCard}>
          <Text style={styles.error}>{t("routeTargetLoadError")}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("routeTargetRetry")}
            accessibilityState={{ busy: loading }}
            disabled={loading}
            onPress={() => void load(targetTypeId ?? selectedTypeId ?? undefined, search.trim())}
            style={({ pressed }) => [styles.retryButton, (loading || pressed) && styles.retryButtonPressed]}
          >
            <TabIcon name="refresh" color={colors.primary} size={16} />
            <Text style={styles.retryText}>{t("routeTargetRetry")}</Text>
          </Pressable>
        </View>
      ) : null}
      {loading && !catalog ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel={t("routeTargetLoading")} style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>{t("routeTargetLoading")}</Text>
        </View>
      ) : null}
      <ScrollView nestedScrollEnabled style={styles.results} contentContainerStyle={[styles.resultsContent, layout.isTablet && styles.resultsContentTablet]} keyboardShouldPersistTaps="handled">
        {catalog?.items.map((item) => {
          const disabled = excluded.has(item.targetKey)
          const contact = item.contact
          return (
            <Pressable
              key={item.targetKey + ":" + item.customer.id}
              accessibilityRole="button"
              accessibilityLabel={[
                contact?.displayName ?? item.customer.name,
                targetMeta(item),
                availabilityLabel(item),
                disabled ? t("stopAlreadyAdded") : t("addStop"),
              ].filter(Boolean).join(". ")}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => select(item)}
              style={[styles.result, layout.isTablet && styles.resultTablet, disabled && styles.disabled]}
            >
              <View style={[styles.resultMark, contact ? styles.contactMark : styles.organizationMark]}>
                <TabIcon name={contact ? "contacts" : "organizations"} color={contact ? colors.holiday : colors.info} size={20} />
              </View>
              <View style={styles.resultBody}>
                <Text style={styles.resultName} numberOfLines={1}>{contact?.displayName ?? item.customer.name}</Text>
                <Text style={styles.resultMeta} numberOfLines={2}>{targetMeta(item)}</Text>
                <Text style={styles.scopeBadge}>{availabilityLabel(item)}</Text>
                {disabled ? <Text style={styles.added}>{t("stopAlreadyAdded")}</Text> : null}
              </View>
              <View style={styles.actionMark}>
                <TabIcon name={disabled ? "check" : "add"} color={disabled ? colors.successDark : colors.primary} size={20} />
              </View>
            </Pressable>
          )
        })}
        {catalog && !loading && catalog.items.length === 0 ? (
          <View style={[styles.empty, layout.isTablet && styles.emptyTablet]}>
            <TabIcon name="organizations" color={colors.faint} size={25} />
            <Text style={styles.emptyTitle}>{t("routeTargetEmpty")}</Text>
            <Text style={styles.emptyHint}>{t("routeTargetEmptyHint")}</Text>
          </View>
        ) : null}
        {catalog?.page.hasMore ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={loadingMore ? t("fieldLoadingMore") : t("fieldLoadMore")}
            accessibilityState={{ busy: loadingMore, disabled: loading || loadingMore }}
            disabled={loading || loadingMore}
            onPress={() => void load(selectedTypeId ?? undefined, search.trim(), catalog.page.number + 1, true)}
            style={[styles.loadMore, layout.isTablet && styles.loadMoreTablet, (loading || loadingMore) && styles.disabled]}
          >
            <Text style={styles.loadMoreText}>{loadingMore ? t("fieldLoadingMore") : t("fieldLoadMore")}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary },
  rootTablet: { padding: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 10 }, headerBody: { flex: 1, minWidth: 0 }, title: { color: colors.text, fontSize: 16, fontWeight: "900" }, subtitle: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 }, close: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  typeScroll: { marginTop: 13, marginHorizontal: -2 }, typeTabs: { gap: 7, paddingHorizontal: 2 }, typeTab: { minHeight: 44, maxWidth: 150, borderRadius: 11, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, paddingHorizontal: 11 }, typeTabActive: { backgroundColor: colors.primary }, typeTabText: { color: colors.primary, fontSize: 11, fontWeight: "900" }, typeTabTextActive: { color: colors.headerText },
  search: { minHeight: 46, marginTop: 10, borderRadius: 11, backgroundColor: colors.bg, flexDirection: "row", alignItems: "center", paddingHorizontal: 11, gap: 7 }, searchInput: { flex: 1, minHeight: 44, color: colors.text, fontSize: 12 }, errorCard: { marginTop: 9, padding: 10, borderRadius: 11, backgroundColor: colors.missedBg, borderWidth: 1, borderColor: colors.missedBorder }, error: { color: colors.missed, fontSize: 11, lineHeight: 15, fontWeight: "800" }, retryButton: { minHeight: 44, alignSelf: "flex-start", marginTop: 6, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.card }, retryButtonPressed: { opacity: 0.55 }, retryText: { color: colors.primary, fontSize: 11, fontWeight: "900" }, loading: { minHeight: 64, marginTop: 12, alignItems: "center", justifyContent: "center", gap: 8 }, loadingText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  results: { marginTop: 5 }, resultsContent: { paddingBottom: 6 }, resultsContentTablet: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 10, paddingTop: 8 }, result: { minHeight: 88, marginTop: 8, borderRadius: 13, padding: 10, backgroundColor: colors.bg, flexDirection: "row", alignItems: "center", gap: 9 }, resultTablet: { flexBasis: "48%", flexGrow: 1, marginTop: 0 }, resultMark: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" }, organizationMark: { backgroundColor: colors.infoBg }, contactMark: { backgroundColor: colors.holidayBg }, resultBody: { flex: 1, minWidth: 0 }, resultName: { color: colors.text, fontSize: 12, fontWeight: "900" }, resultMeta: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 }, scopeBadge: { alignSelf: "flex-start", color: colors.primary, backgroundColor: colors.primarySoft, borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 3, overflow: "hidden", fontSize: 11, lineHeight: 14, fontWeight: "900", marginTop: 5 }, added: { color: colors.successDark, fontSize: 11, lineHeight: 14, fontWeight: "900", marginTop: 3 }, actionMark: { width: 26, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingHorizontal: 22, paddingVertical: 28, gap: 7 }, emptyTablet: { flexBasis: "100%" }, emptyTitle: { color: colors.text, fontSize: 12, fontWeight: "900", textAlign: "center" }, emptyHint: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center" }, loadMore: { minHeight: 44, marginTop: 10, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, loadMoreTablet: { flexBasis: "100%", marginTop: 0 }, loadMoreText: { color: colors.primary, fontSize: 11, fontWeight: "900" }, disabled: { opacity: 0.45 },
})
