import { type ReactNode, useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { TabIcon } from "../../../src/components/TabIcon"
import type { FieldManagerApprovalsData } from "../../../src/field/contracts"
import { t, useLocale } from "../../../src/i18n"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { HttpError } from "../../../src/sync/ports-error"
import { cardShadow, colors, radii } from "../../../src/theme"

function RequestMeta({ by, at }: { by: string; at: string }) {
  const locale = useLocale()
  return (
    <View style={styles.requestMeta}>
      <Text style={styles.requestBy}>{t("managerRequestedBy")}: {by}</Text>
      <Text style={styles.requestAt}>{t("managerRequestedAt")}: {formatShortDateTime(at, locale)}</Text>
    </View>
  )
}

function Section({
  title,
  count,
  icon,
  children,
}: {
  title: string
  count: number
  icon: "profile" | "route" | "organizations" | "contacts"
  children: ReactNode
}) {
  if (count === 0) return null
  return (
    <>
      <View style={styles.sectionHeading}>
        <View style={styles.sectionIcon}><TabIcon name={icon} color={colors.primary} size={18} /></View>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </View>
      <View style={styles.sectionCard}>{children}</View>
    </>
  )
}

export default function ManagerApprovalsScreen() {
  useLocale()
  const [data, setData] = useState<FieldManagerApprovalsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fieldApi.managerApprovals())
    } catch (reason) {
      setError(reason)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const denied = error instanceof HttpError && error.status === 403
  const total = data
    ? data.counts.hrm + data.counts.routeChanges + data.counts.customers + data.counts.contactChanges
    : 0

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.primary} />}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("managerHomeTitle").toUpperCase()}</Text>
            <Text style={styles.title}>{t("managerApprovalsTitle")}</Text>
            <Text style={styles.subtitle}>{t("managerApprovalsHint")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} disabled={loading} onPress={() => void load()} style={styles.refresh}><Text style={styles.refreshText}>↻</Text></Pressable>
        </View>

        {loading && !data ? <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>{t("managerLoading")}</Text></View> : null}
        {error && !data ? (
          <View style={[styles.state, denied && styles.stateWarning]}>
            <View style={styles.stateIcon}><TabIcon name="inbox" color={denied ? colors.warning : colors.primary} size={25} /></View>
            <Text style={styles.stateTitle}>{denied ? t("managerAccessDeniedTitle") : t("managerUnavailable")}</Text>
            <Text style={styles.stateText}>{denied ? t("managerAccessDeniedBody") : t("managerRetry")}</Text>
            <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>{t("managerRetry")}</Text></Pressable>
          </View>
        ) : null}

        {data ? (
          <>
            <View style={styles.summary}>
              <View style={styles.summaryIcon}><TabIcon name="inbox" color={colors.warning} size={22} /></View>
              <View style={styles.summaryBody}>
                <Text style={styles.summaryValue}>{total}</Text>
                <Text style={styles.summaryLabel}>{t("managerItemsLoaded")}</Text>
              </View>
              <Text style={styles.summaryScope}>{data.scope === "ORGANIZATION" ? t("managerScopeOrganization") : t("managerScopeTeam")}</Text>
            </View>
            {error ? <View style={styles.notice}><Text style={styles.noticeText}>{t("managerUnavailable")}</Text></View> : null}
            {total === 0 ? (
              <View style={styles.empty}><TabIcon name="inbox" color={colors.primary} size={26} /><Text style={styles.emptyText}>{t("managerNoApprovals")}</Text></View>
            ) : (
              <>
                <Section title={t("managerApprovalHrm")} count={data.counts.hrm} icon="profile">
                  {data.hrm.map((item, index) => (
                    <View key={item.id} style={[styles.request, index > 0 && styles.requestBorder]}>
                      <Text style={styles.requestTitle}>{item.agent.name}</Text>
                      <Text style={styles.requestReason} numberOfLines={3}>{item.reason}</Text>
                      <RequestMeta by={item.agent.name} at={item.submittedAt} />
                    </View>
                  ))}
                </Section>
                <Section title={t("managerApprovalRoute")} count={data.counts.routeChanges} icon="route">
                  {data.routeChanges.map((item, index) => (
                    <View key={item.id} style={[styles.request, index > 0 && styles.requestBorder]}>
                      <Text style={styles.requestTitle}>{item.requestedByAgent.name}</Text>
                      <Text style={styles.requestReason} numberOfLines={3}>{item.reason}</Text>
                      <RequestMeta by={item.requestedByAgent.name} at={item.submittedAt} />
                    </View>
                  ))}
                </Section>
                <Section title={t("managerApprovalCustomer")} count={data.counts.customers} icon="organizations">
                  {data.customers.map((item, index) => (
                    <View key={item.id} style={[styles.request, index > 0 && styles.requestBorder]}>
                      <Text style={styles.requestTitle}>{item.name}</Text>
                      <Text style={styles.requestReason} numberOfLines={3}>{item.reason}</Text>
                      <RequestMeta by={item.requestedByAgent.name} at={item.submittedAt} />
                    </View>
                  ))}
                </Section>
                <Section title={t("managerApprovalContact")} count={data.counts.contactChanges} icon="contacts">
                  {data.contactChanges.map((item, index) => (
                    <View key={item.id} style={[styles.request, index > 0 && styles.requestBorder]}>
                      <Text style={styles.requestTitle}>{item.contact.displayName}</Text>
                      <Text style={styles.requestReason} numberOfLines={3}>{item.reason}</Text>
                      <RequestMeta by={item.requestedByAgent.name} at={item.submittedAt} />
                    </View>
                  ))}
                </Section>
              </>
            )}
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
  backText: { color: colors.text, fontSize: 31, lineHeight: 32 },
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.9 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  refresh: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  refreshText: { color: colors.primary, fontSize: 23, fontWeight: "900" },
  summary: { marginHorizontal: 14, marginTop: 16, padding: 14, borderRadius: radii.card, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: "#F6D788", flexDirection: "row", alignItems: "center", gap: 10 },
  summaryIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.cardOverlay, alignItems: "center", justifyContent: "center" },
  summaryBody: { flex: 1 },
  summaryValue: { color: colors.warning, fontSize: 24, lineHeight: 26, fontWeight: "900" },
  summaryLabel: { color: colors.warning, fontSize: 10, fontWeight: "900", marginTop: 1 },
  summaryScope: { maxWidth: 116, color: colors.warning, fontSize: 8, lineHeight: 12, textAlign: "right", fontWeight: "700" },
  notice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder, padding: 11 },
  noticeText: { color: colors.info, fontSize: 10, lineHeight: 15, fontWeight: "800" },
  sectionHeading: { marginHorizontal: 16, marginTop: 22, marginBottom: 7, flexDirection: "row", alignItems: "center", gap: 8 },
  sectionIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  sectionTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "900" },
  sectionCount: { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: colors.primarySoft, color: colors.primary, fontSize: 11, lineHeight: 26, textAlign: "center", fontWeight: "900" },
  sectionCard: { marginHorizontal: 14, borderRadius: radii.card, backgroundColor: colors.card, paddingHorizontal: 14, ...cardShadow },
  request: { paddingVertical: 13 },
  requestBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  requestTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  requestReason: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  requestMeta: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 2 },
  requestBy: { color: colors.primary, fontSize: 8, fontWeight: "800" },
  requestAt: { color: colors.faint, fontSize: 8, fontWeight: "700" },
  empty: { minHeight: 160, margin: 14, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", gap: 10, ...cardShadow },
  emptyText: { color: colors.muted, fontSize: 11, fontWeight: "800", textAlign: "center" },
  state: { minHeight: 230, margin: 14, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", padding: 24, ...cardShadow },
  stateWarning: { backgroundColor: colors.warningBg, borderWidth: 1, borderColor: "#F6D788" },
  stateIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  stateTitle: { color: colors.text, fontSize: 15, fontWeight: "900", textAlign: "center" },
  stateText: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 7 },
  retry: { minHeight: 44, marginTop: 16, borderRadius: 13, paddingHorizontal: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  retryText: { color: colors.headerText, fontSize: 11, fontWeight: "900" },
})
