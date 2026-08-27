import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { fieldApi } from "../api/mobile-client"
import type {
  FieldOrganization,
  FieldRouteTargetCatalogData,
  FieldRouteTargetCatalogItem,
  FieldRouteTargetType,
  FieldRoutePoint,
} from "./contracts"
import { t, type MessageKey, useLocale } from "../i18n"
import { formatLongCalendarDate } from "../i18n/date-format"
import { colors, radii } from "../theme"
import { useResponsiveLayout } from "../layout/responsive"
import { routeTargetKey } from "./route-target"
import { routeTargetLoadFailure, type RouteTargetLoadFailure } from "./route-target-error"
import { contactTypeLabel, objectTypeLabel } from "./labels"
import { TabIcon } from "../components/TabIcon"
import { useSync } from "../sync/sync-context"
import { AuthLostError } from "../sync/ports-error"
import {
  assignedOrganizationTarget,
  canSearchUnassignedOrganization,
  existingOrganizationAssignmentFailure,
} from "./organization-assignment"

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

function organizationMeta(item: FieldOrganization): string {
  return [objectTypeLabel(item.objectType), item.city, item.address].filter(Boolean).join(" · ")
}

export function RouteTargetPicker({
  excluded,
  agentId,
  agentName,
  date,
  canAssignExisting,
  onSelect,
  onCancel,
}: {
  excluded: ReadonlySet<string>
  agentId: string
  agentName: string | null
  date: string
  canAssignExisting: boolean
  onSelect: (target: RouteTarget) => void
  onCancel: () => void
}) {
  const locale = useLocale()
  const layout = useResponsiveLayout()
  const { endSession } = useSync()
  const [targetTypeId, setTargetTypeId] = useState<string | null>(null)
  const [targetTypes, setTargetTypes] = useState<FieldRouteTargetType[]>([])
  const [catalog, setCatalog] = useState<FieldRouteTargetCatalogData | null>(null)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<RouteTargetLoadFailure | null>(null)
  const [assignmentOpen, setAssignmentOpen] = useState(false)
  const [assignmentSearch, setAssignmentSearch] = useState("")
  const [assignmentResults, setAssignmentResults] = useState<FieldOrganization[]>([])
  const [assignmentCandidate, setAssignmentCandidate] = useState<FieldOrganization | null>(null)
  const [assignmentLoading, setAssignmentLoading] = useState(false)
  const [assignmentSaving, setAssignmentSaving] = useState(false)
  const [assignmentError, setAssignmentError] = useState<MessageKey | null>(null)
  const [assignmentReload, setAssignmentReload] = useState(0)
  const sequence = useRef(0)
  const assignmentSequence = useRef(0)

  const load = useCallback(async (typeId: string | undefined, query: string, page = 1, append = false) => {
    const request = ++sequence.current
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
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
    } catch (reason) {
      if (request !== sequence.current) return
      const failure = routeTargetLoadFailure(reason)
      if (failure.kind === "session") {
        await endSession().catch(() => {})
        return
      }
      setError(failure)
    } finally {
      if (request === sequence.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [agentId, date, endSession])

  useEffect(() => {
    const id = setTimeout(() => void load(targetTypeId ?? undefined, search.trim()), 300)
    return () => clearTimeout(id)
  }, [load, search, targetTypeId])

  const selectedTypeId = targetTypeId ?? catalog?.targetType.id ?? targetTypes[0]?.id ?? null
  const selectedTargetType = catalog?.targetType ?? targetTypes.find((item) => item.id === selectedTypeId) ?? null
  const canAssignOrganization = canAssignExisting && Boolean(selectedTargetType && selectedTargetType.direction !== "DOCTOR")
  const scopeDate = formatLongCalendarDate(date, locale)
  const scopeHint = agentName
    ? t("routeTargetScopeWithAgent", { agent: agentName, date: scopeDate })
    : t("routeTargetScope")
  const maxHeight = layout.isTablet
    ? Math.max(420, Math.min(720, layout.height - 180))
    : 590

  useEffect(() => {
    const request = ++assignmentSequence.current
    if (!assignmentOpen || !canAssignOrganization) {
      setAssignmentLoading(false)
      return
    }
    const query = assignmentSearch.trim()
    if (!canSearchUnassignedOrganization(query)) {
      setAssignmentResults([])
      setAssignmentCandidate(null)
      setAssignmentError(null)
      setAssignmentLoading(false)
      return
    }
    const id = setTimeout(() => {
      setAssignmentLoading(true)
      setAssignmentError(null)
      void fieldApi.organizations({
        search: query,
        page: 1,
        limit: 20,
        assignmentState: "UNASSIGNED",
        asOf: date,
        status: "ACTIVE",
        objectType: selectedTargetType?.objectType ?? undefined,
        organizationKind: selectedTargetType?.organizationKind ?? undefined,
      }).then((next) => {
        if (request !== assignmentSequence.current) return
        setAssignmentResults(next.organizations)
        setAssignmentCandidate((current) => (
          current && next.organizations.some((item) => item.id === current.id) ? current : null
        ))
      }).catch(async (reason) => {
        if (request !== assignmentSequence.current) return
        if (reason instanceof AuthLostError) {
          await endSession().catch(() => {})
          return
        }
        setAssignmentResults([])
        setAssignmentCandidate(null)
        setAssignmentError(
          existingOrganizationAssignmentFailure(reason) === "denied"
            ? "routeTargetExistingDenied"
            : "routeTargetExistingSearchError",
        )
      }).finally(() => {
        if (request === assignmentSequence.current) setAssignmentLoading(false)
      })
    }, 350)
    return () => clearTimeout(id)
  }, [
    assignmentOpen,
    assignmentReload,
    assignmentSearch,
    canAssignOrganization,
    date,
    endSession,
    selectedTargetType?.objectType,
    selectedTargetType?.organizationKind,
  ])

  function changeTargetType(id: string) {
    if (id === selectedTypeId) return
    setCatalog(null)
    setTargetTypeId(id)
    setAssignmentOpen(false)
    setAssignmentSearch("")
    setAssignmentResults([])
    setAssignmentCandidate(null)
    setAssignmentError(null)
  }

  function select(item: FieldRouteTargetCatalogItem) {
    onSelect({
      key: item.targetKey,
      customer: item.customer,
      contact: item.contact,
    })
  }

  async function assignExistingOrganization() {
    if (!assignmentCandidate || !canAssignOrganization || assignmentSaving) return
    const candidate = assignmentCandidate
    let assigned = false
    setAssignmentSaving(true)
    setAssignmentError(null)
    try {
      await fieldApi.assignOrganization({
        organizationId: candidate.id,
        agentId,
        effectiveFrom: date,
      })
      assigned = true
      const refreshed = await fieldApi.routeTargets({
        agentId,
        date,
        targetTypeId: selectedTypeId ?? undefined,
        search: candidate.name,
        page: 1,
      })
      const target = assignedOrganizationTarget(refreshed.items, candidate.id)
      setTargetTypes(refreshed.targetTypes)
      if (!target) {
        setAssignmentCandidate(null)
        setAssignmentResults((current) => current.filter((item) => item.id !== candidate.id))
        setAssignmentError("routeTargetExistingRefreshError")
        return
      }
      select(target)
      void load(selectedTypeId ?? undefined, search.trim())
      setAssignmentOpen(false)
      setAssignmentSearch("")
      setAssignmentResults([])
      setAssignmentCandidate(null)
      setAssignmentError(null)
    } catch (reason) {
      if (reason instanceof AuthLostError) {
        await endSession().catch(() => {})
        return
      }
      if (assigned) {
        setAssignmentCandidate(null)
        setAssignmentResults((current) => current.filter((item) => item.id !== candidate.id))
        setAssignmentError("routeTargetExistingRefreshError")
        return
      }
      const failure = existingOrganizationAssignmentFailure(reason)
      setAssignmentError(
        failure === "denied"
          ? "routeTargetExistingDenied"
          : failure === "alreadyAssigned"
            ? "routeTargetExistingConflict"
            : "routeTargetExistingAssignError",
      )
      if (failure === "alreadyAssigned") {
        setAssignmentCandidate(null)
        setAssignmentResults((current) => current.filter((item) => item.id !== candidate.id))
      }
    } finally {
      setAssignmentSaving(false)
    }
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
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorCard}>
          <Text style={styles.error}>{t(error.messageKey)}</Text>
          {error.correlationId ? <Text style={styles.errorMeta}>{t("syncSupportCode", { code: error.correlationId })}</Text> : null}
          {error.retryable ? (
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
          ) : null}
        </View>
      ) : null}
      {loading && !catalog ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel={t("routeTargetLoading")} style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>{t("routeTargetLoading")}</Text>
        </View>
      ) : null}
      {canAssignOrganization ? (
        <View style={styles.assignmentDisclosure}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("routeTargetExistingDisclosure")}
            accessibilityHint={t("routeTargetExistingHint")}
            accessibilityState={{ expanded: assignmentOpen, disabled: assignmentSaving }}
            disabled={assignmentSaving}
            onPress={() => {
              setAssignmentOpen((value) => !value)
              setAssignmentError(null)
              setAssignmentCandidate(null)
            }}
            style={({ pressed }) => [styles.assignmentDisclosureButton, pressed && styles.pressed]}
          >
            <View style={styles.assignmentDisclosureIcon}><TabIcon name="organizations" color={colors.primary} size={19} /></View>
            <Text style={styles.assignmentDisclosureText}>{t("routeTargetExistingDisclosure")}</Text>
            <TabIcon name={assignmentOpen ? "chevronUp" : "chevronDown"} color={colors.primary} size={19} />
          </Pressable>
          {assignmentOpen ? (
            <View style={styles.assignmentPanel}>
              <Text style={styles.assignmentHint}>{t("routeTargetExistingHint")}</Text>
              <View style={styles.assignmentSearch}>
                <TabIcon name="search" color={colors.faint} size={18} />
                <TextInput
                  value={assignmentSearch}
                  onChangeText={setAssignmentSearch}
                  accessibilityLabel={t("routeTargetExistingSearch")}
                  accessibilityHint={t("routeTargetExistingHint")}
                  accessibilityState={{ disabled: assignmentSaving }}
                  editable={!assignmentSaving}
                  placeholder={t("routeTargetExistingSearch")}
                  placeholderTextColor={colors.faint}
                  autoCorrect={false}
                  returnKeyType="search"
                  style={styles.assignmentSearchInput}
                />
              </View>
              {!canSearchUnassignedOrganization(assignmentSearch) ? (
                <Text style={styles.assignmentGuide}>{t("routeTargetExistingSearchShort")}</Text>
              ) : null}
              {assignmentLoading ? (
                <View accessible accessibilityRole="progressbar" accessibilityLabel={t("routeTargetLoading")} style={styles.assignmentLoading}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.loadingText}>{t("routeTargetLoading")}</Text>
                </View>
              ) : null}
              {assignmentError ? (
                <View accessibilityRole="alert" style={styles.assignmentError}>
                  <Text style={styles.assignmentErrorText}>{t(assignmentError)}</Text>
                  {assignmentError === "routeTargetExistingSearchError" ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("routeTargetRetry")}
                      onPress={() => setAssignmentReload((value) => value + 1)}
                      style={({ pressed }) => [styles.assignmentRetry, pressed && styles.pressed]}
                    >
                      <TabIcon name="refresh" color={colors.primary} size={16} />
                      <Text style={styles.retryText}>{t("routeTargetRetry")}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              {!assignmentLoading && !assignmentError && canSearchUnassignedOrganization(assignmentSearch) && assignmentResults.length === 0 ? (
                <Text style={styles.assignmentEmpty}>{t("routeTargetExistingEmpty")}</Text>
              ) : null}
              {assignmentResults.length > 0 ? (
                <ScrollView nestedScrollEnabled style={styles.assignmentResults} keyboardShouldPersistTaps="handled">
                  {assignmentResults.map((organization) => {
                    const selected = assignmentCandidate?.id === organization.id
                    return (
                      <Pressable
                        key={organization.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${organization.name}. ${organizationMeta(organization)}`}
                        accessibilityState={{ selected, disabled: assignmentSaving }}
                        disabled={assignmentSaving}
                        onPress={() => { setAssignmentCandidate(organization); setAssignmentError(null) }}
                        style={({ pressed }) => [styles.assignmentResult, selected && styles.assignmentResultSelected, pressed && styles.pressed]}
                      >
                        <View style={styles.assignmentResultIcon}><TabIcon name="organizations" color={colors.info} size={18} /></View>
                        <View style={styles.assignmentResultBody}>
                          <Text numberOfLines={1} style={styles.assignmentResultName}>{organization.name}</Text>
                          <Text numberOfLines={2} style={styles.assignmentResultMeta}>{organizationMeta(organization)}</Text>
                        </View>
                        <TabIcon name={selected ? "check" : "chevronRight"} color={selected ? colors.successDark : colors.primary} size={19} />
                      </Pressable>
                    )
                  })}
                </ScrollView>
              ) : null}
              {assignmentCandidate ? (
                <View style={styles.assignmentConfirm}>
                  <Text style={styles.assignmentConfirmText}>{t("routeTargetExistingConfirm", {
                    customer: assignmentCandidate.name,
                    agent: agentName ?? t("routeWizardAgent"),
                    date: scopeDate,
                  })}</Text>
                  <View style={styles.assignmentConfirmActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("cancel")}
                      accessibilityState={{ disabled: assignmentSaving }}
                      disabled={assignmentSaving}
                      onPress={() => setAssignmentCandidate(null)}
                      style={styles.assignmentCancel}
                    >
                      <Text style={styles.assignmentCancelText}>{t("cancel")}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("routeTargetExistingAssign")}
                      accessibilityState={{ disabled: assignmentSaving, busy: assignmentSaving }}
                      disabled={assignmentSaving}
                      onPress={() => void assignExistingOrganization()}
                      style={[styles.assignmentSubmit, assignmentSaving && styles.disabled]}
                    >
                      {assignmentSaving ? <ActivityIndicator color={colors.headerText} size="small" /> : <TabIcon name="add" color={colors.headerText} size={18} />}
                      <Text style={styles.assignmentSubmitText}>{t(assignmentSaving ? "routeTargetExistingAssigning" : "routeTargetExistingAssign")}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : selectedTargetType?.direction === "DOCTOR" && canAssignExisting ? (
        <View style={styles.assignmentInfo}><TabIcon name="info" color={colors.info} size={17} /><Text style={styles.assignmentInfoText}>{t("routeTargetContactAssignmentHint")}</Text></View>
      ) : catalog && !loading && catalog.items.length === 0 ? (
        <View style={styles.assignmentInfo}><TabIcon name="info" color={colors.info} size={17} /><Text style={styles.assignmentInfoText}>{t("routeTargetManagerHint")}</Text></View>
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
  search: { minHeight: 46, marginTop: 10, borderRadius: 11, backgroundColor: colors.bg, flexDirection: "row", alignItems: "center", paddingHorizontal: 11, gap: 7 }, searchInput: { flex: 1, minHeight: 44, color: colors.text, fontSize: 12 }, errorCard: { marginTop: 9, padding: 10, borderRadius: 11, backgroundColor: colors.missedBg, borderWidth: 1, borderColor: colors.missedBorder }, error: { color: colors.missed, fontSize: 11, lineHeight: 15, fontWeight: "800" }, errorMeta: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 4 }, retryButton: { minHeight: 44, alignSelf: "flex-start", marginTop: 6, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.card }, retryButtonPressed: { opacity: 0.55 }, retryText: { color: colors.primary, fontSize: 11, fontWeight: "900" }, loading: { minHeight: 64, marginTop: 12, alignItems: "center", justifyContent: "center", gap: 8 }, loadingText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  assignmentDisclosure: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  assignmentDisclosureButton: { minHeight: 48, borderRadius: 12, backgroundColor: colors.primarySoft, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10 },
  assignmentDisclosureIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  assignmentDisclosureText: { flex: 1, color: colors.primary, fontSize: 12, lineHeight: 17, fontWeight: "900" },
  assignmentPanel: { paddingTop: 10, gap: 8 },
  assignmentHint: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  assignmentSearch: { minHeight: 46, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 7 },
  assignmentSearchInput: { flex: 1, minHeight: 44, color: colors.text, fontSize: 12 },
  assignmentGuide: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  assignmentLoading: { minHeight: 52, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  assignmentError: { borderRadius: 11, padding: 10, backgroundColor: colors.missedBg, borderWidth: 1, borderColor: colors.missedBorder },
  assignmentErrorText: { color: colors.missed, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  assignmentRetry: { minHeight: 44, alignSelf: "flex-start", marginTop: 5, borderRadius: 10, backgroundColor: colors.card, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  assignmentEmpty: { color: colors.muted, fontSize: 11, lineHeight: 16, paddingVertical: 10, textAlign: "center" },
  assignmentResults: { maxHeight: 194 },
  assignmentResult: { minHeight: 64, borderRadius: 12, backgroundColor: colors.bg, padding: 9, marginBottom: 7, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: colors.border },
  assignmentResultSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  assignmentResultIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" },
  assignmentResultBody: { flex: 1, minWidth: 0 },
  assignmentResultName: { color: colors.text, fontSize: 12, fontWeight: "900" },
  assignmentResultMeta: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  assignmentConfirm: { borderRadius: 12, borderWidth: 1, borderColor: colors.infoBorder, backgroundColor: colors.infoBg, padding: 10, gap: 9 },
  assignmentConfirmText: { color: colors.info, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  assignmentConfirmActions: { flexDirection: "row", gap: 7 },
  assignmentCancel: { minHeight: 44, minWidth: 78, borderRadius: 11, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  assignmentCancelText: { color: colors.text, fontSize: 11, fontWeight: "900" },
  assignmentSubmit: { flex: 1, minHeight: 44, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, paddingHorizontal: 10 },
  assignmentSubmitText: { color: colors.headerText, fontSize: 11, lineHeight: 15, fontWeight: "900", textAlign: "center" },
  assignmentInfo: { minHeight: 44, marginTop: 10, borderRadius: 11, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder, padding: 9, flexDirection: "row", alignItems: "flex-start", gap: 7 },
  assignmentInfoText: { flex: 1, color: colors.info, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  results: { marginTop: 5 }, resultsContent: { paddingBottom: 6 }, resultsContentTablet: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 10, paddingTop: 8 }, result: { minHeight: 88, marginTop: 8, borderRadius: 13, padding: 10, backgroundColor: colors.bg, flexDirection: "row", alignItems: "center", gap: 9 }, resultTablet: { flexBasis: "48%", flexGrow: 1, marginTop: 0 }, resultMark: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" }, organizationMark: { backgroundColor: colors.infoBg }, contactMark: { backgroundColor: colors.holidayBg }, resultBody: { flex: 1, minWidth: 0 }, resultName: { color: colors.text, fontSize: 12, fontWeight: "900" }, resultMeta: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 }, scopeBadge: { alignSelf: "flex-start", color: colors.primary, backgroundColor: colors.primarySoft, borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 3, overflow: "hidden", fontSize: 11, lineHeight: 14, fontWeight: "900", marginTop: 5 }, added: { color: colors.successDark, fontSize: 11, lineHeight: 14, fontWeight: "900", marginTop: 3 }, actionMark: { width: 26, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingHorizontal: 22, paddingVertical: 28, gap: 7 }, emptyTablet: { flexBasis: "100%" }, emptyTitle: { color: colors.text, fontSize: 12, fontWeight: "900", textAlign: "center" }, emptyHint: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center" }, loadMore: { minHeight: 44, marginTop: 10, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, loadMoreTablet: { flexBasis: "100%", marginTop: 0 }, loadMoreText: { color: colors.primary, fontSize: 11, fontWeight: "900" }, disabled: { opacity: 0.45 },
})
