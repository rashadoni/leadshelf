import { useCallback, useEffect, useState } from "react"
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { readFieldCache, writeFieldCache } from "../../../src/db/local-store"
import type { FieldCustomerRequest, FieldCustomerRequestsData } from "../../../src/field/contracts"
import { fieldErrorMessage } from "../../../src/field/error-message"
import { t, useLocale } from "../../../src/i18n"
import { formatCalendarDate } from "../../../src/i18n/date-format"
import { colors, cardShadow, radii } from "../../../src/theme"
import { objectTypeLabel } from "../../../src/field/labels"
import { TabIcon } from "../../../src/components/TabIcon"

const CACHE_KEY = "field.customer-requests"

function statusLabel(status: string): string {
  switch (status) {
    case "DRAFT": return t("requestStatus_DRAFT")
    case "SUBMITTED": return t("requestStatus_SUBMITTED")
    case "IN_REVIEW": return t("requestStatus_IN_REVIEW")
    case "NEEDS_INFO": return t("requestStatus_NEEDS_INFO")
    case "APPROVED": return t("requestStatus_APPROVED")
    case "REJECTED": return t("requestStatus_REJECTED")
    case "CANCELLED": return t("requestStatus_CANCELLED")
    default: return t("lifecycleStatus_UNKNOWN")
  }
}

function statusColors(status: string): { background: string; foreground: string } {
  if (status === "APPROVED") return { background: colors.successBg, foreground: colors.successDark }
  if (status === "REJECTED" || status === "CANCELLED") return { background: colors.dangerBg, foreground: colors.missed }
  if (status === "NEEDS_INFO") return { background: colors.warningBg, foreground: colors.warning }
  if (status === "IN_REVIEW") return { background: colors.infoBg, foreground: colors.info }
  return { background: colors.primarySoft, foreground: colors.primary }
}

export default function CustomerRequestsScreen() {
  useLocale()
  const cached = readFieldCache<FieldCustomerRequestsData>(CACHE_KEY)
  const [data, setData] = useState<FieldCustomerRequestsData | null>(cached?.value ?? null)
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await fieldApi.customerRequests()
      setData(next)
      writeFieldCache(CACHE_KEY, next)
    } catch (reason) {
      setError(fieldErrorMessage(reason, "fieldDataError"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.back}>
            <TabIcon name="chevronLeft" color={colors.text} size={23} />
          </Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("tabWork").toUpperCase()}</Text>
            <Text style={styles.title}>{t("myCustomerRequests")}</Text>
            <Text style={styles.subtitle}>{t("customerRequestsHint")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("newCustomerRequest")} onPress={() => router.push("/(app)/customer-requests/new" as never)} style={styles.add}>
            <TabIcon name="add" color={colors.headerText} size={23} />
          </Pressable>
        </View>

        {error ? <View style={styles.notice}><Text style={styles.noticeText}>{data ? t("fieldDataStale") : t("fieldDataError")}</Text></View> : null}
        {data?.requests.length ? (
          <View style={styles.list}>
            {data.requests.map((request) => <RequestCard key={request.id} request={request} />)}
          </View>
        ) : !loading ? (
          <View style={styles.empty}>
            <View style={styles.emptyMark}><TabIcon name="add" color={colors.primary} size={28} /></View>
            <Text style={styles.emptyTitle}>{t("customerRequestsEmpty")}</Text>
            <Text style={styles.emptyBody}>{t("newCustomerHint")}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t("newCustomerRequest")} onPress={() => router.push("/(app)/customer-requests/new" as never)} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{t("newCustomerRequest")}</Text></Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function RequestCard({ request }: { request: FieldCustomerRequest }) {
  const locale = useLocale()
  const tone = statusColors(request.status)
  const submittedAt = request.submittedAt ?? request.updatedAt
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardBody}>
          <Text style={styles.cardName}>{request.name}</Text>
          <Text style={styles.cardMeta}>{objectTypeLabel(request.objectType)}{request.city ? ` · ${request.city}` : ""}</Text>
        </View>
        <View style={[styles.status, { backgroundColor: tone.background }]}><Text style={[styles.statusText, { color: tone.foreground }]}>{statusLabel(request.status)}</Text></View>
      </View>
      {request.address ? <Text style={styles.address}>{request.address}</Text> : null}
      <Text style={styles.reason}>{request.reason}</Text>
      <View style={styles.cardFooter}>
        <Text style={styles.footerText}>{formatCalendarDate(submittedAt.slice(0, 10), locale) || "—"}</Text>
        {request.route ? <View style={styles.routeInfo}><TabIcon name="route" color={colors.info} size={14} /><Text style={styles.routeText} numberOfLines={1}>{request.route.name ?? request.route.id}</Text></View> : null}
      </View>
      {request.duplicateCandidates.length > 0 ? (
        <View style={styles.duplicateLine}><TabIcon name="alert" color={colors.warning} size={16} /><Text style={styles.duplicateText}>{t("duplicateWarning")} · {request.duplicateCandidates.length}</Text></View>
      ) : null}
      {request.approvedCustomer ? <View style={styles.approved}><TabIcon name="check" color={colors.successDark} size={16} /><Text style={styles.approvedText}>{request.approvedCustomer.name}</Text></View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { minHeight: "100%", paddingBottom: 30 },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 }, back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  headerBody: { flex: 1 }, eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 }, title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 }, subtitle: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  add: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  notice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.warningBg }, noticeText: { color: colors.warning, fontSize: 11, fontWeight: "800" }, list: { paddingTop: 3 },
  card: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, ...cardShadow }, cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 }, cardBody: { flex: 1, minWidth: 0 }, cardName: { color: colors.text, fontSize: 15, fontWeight: "900" }, cardMeta: { color: colors.primary, fontSize: 10, fontWeight: "800", marginTop: 3 },
  status: { borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 6 }, statusText: { fontSize: 9, fontWeight: "900" }, address: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 9 }, reason: { color: colors.text, fontSize: 12, lineHeight: 17, marginTop: 9 },
  cardFooter: { marginTop: 11, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: "row", justifyContent: "space-between", gap: 8 }, footerText: { color: colors.faint, fontSize: 9, fontWeight: "700" }, routeInfo: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 }, routeText: { color: colors.info, fontSize: 9, fontWeight: "800", flexShrink: 1 },
  duplicateLine: { marginTop: 10, borderRadius: 10, padding: 9, backgroundColor: colors.warningBg, flexDirection: "row", alignItems: "center", gap: 7 }, duplicateText: { color: colors.warning, fontSize: 10, fontWeight: "900", flex: 1 }, approved: { marginTop: 10, flexDirection: "row", alignItems: "center", gap: 6 }, approvedText: { color: colors.successDark, fontSize: 11, fontWeight: "900", flex: 1 },
  empty: { margin: 14, minHeight: 320, borderRadius: radii.card, padding: 28, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", ...cardShadow }, emptyMark: { width: 54, height: 54, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 16 }, emptyBody: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 7 },
  primaryButton: { minHeight: 46, marginTop: 20, borderRadius: radii.inner, paddingHorizontal: 18, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, primaryButtonText: { color: colors.headerText, fontSize: 12, fontWeight: "900" },
})
