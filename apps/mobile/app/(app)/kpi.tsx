import { useCallback, useEffect, useRef, useState } from "react"
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { router } from "expo-router"
import { fieldApi } from "../../src/api/mobile-client"
import { readFieldCache, writeFieldCache } from "../../src/db/local-store"
import { IS_LEADDRIVE_FIELD } from "../../src/config/mobile-variant"
import { t, useLocale } from "../../src/i18n"
import { formatShortDateTime } from "../../src/i18n/date-format"
import type {
  FieldKpiCoverage,
  FieldKpiRatio,
  FieldPersonalKpiData,
} from "../../src/field/contracts"
import { fieldErrorMessage } from "../../src/field/error-message"
import { TabIcon } from "../../src/components/TabIcon"
import { safeFieldBack } from "../../src/navigation/safe-back"
import { cardShadow, colors, radii } from "../../src/theme"
import { useResponsiveLayout } from "../../src/layout/responsive"

type Period = "week" | "month"
type Phase = "loading" | "ready" | "refreshing" | "stale" | "error"

function cacheKey(period: Period): string {
  return `field:personal-kpi:${period}`
}

function formatDistance(meters: number | null): string {
  if (meters == null) return "—"
  if (meters < 1_000) return `${Math.round(meters)} ${t("kpiMetersShort")}`
  return `${(meters / 1_000).toFixed(meters >= 10_000 ? 0 : 1)} ${t("kpiKmShort")}`
}

function formatHours(seconds: number): string {
  return `${(seconds / 3_600).toFixed(1)} ${t("kpiHoursShort")}`
}

function formatAmount(value: number, currency: string, locale: "az" | "ru"): string {
  return `${new Intl.NumberFormat(locale === "az" ? "az-AZ" : "ru-RU", {
    maximumFractionDigits: 2,
  }).format(value)} ${currency}`
}

function Progress({ metric, color = colors.primary }: { metric: FieldKpiRatio; color?: string }) {
  const width = `${Math.max(0, Math.min(100, metric.percentage))}%` as `${number}%`
  return (
    <View style={styles.progressBlock}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressRatio}>{t("kpiOf", { done: metric.numerator, total: metric.denominator })}</Text>
        <Text style={[styles.progressPercent, { color }]}>{metric.percentage.toFixed(metric.percentage % 1 ? 1 : 0)}%</Text>
      </View>
      <View style={styles.track}><View style={[styles.fill, { width, backgroundColor: color }]} /></View>
    </View>
  )
}

function CoverageRow({ label, metric, color }: { label: string; metric: FieldKpiCoverage; color: string }) {
  return (
    <View style={styles.coverageRow}>
      <View style={styles.coverageLabelRow}>
        <Text style={styles.coverageLabel}>{label}</Text>
        {metric.uncovered.length > 0 ? <Text style={styles.coverageException}>−{metric.uncovered.length}</Text> : null}
      </View>
      <Progress metric={metric} color={color} />
    </View>
  )
}

function Stat({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "good" | "warning" }) {
  return (
    <View style={[styles.stat, tone === "good" && styles.statGood, tone === "warning" && styles.statWarning]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tone === "good" && styles.goodText, tone === "warning" && styles.warningText]}>{value}</Text>
    </View>
  )
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  )
}

export default function PersonalKpiScreen() {
  const locale = useLocale()
  const [period, setPeriod] = useState<Period>("week")
  const [data, setData] = useState<FieldPersonalKpiData | null>(null)
  const [phase, setPhase] = useState<Phase>("loading")
  const [error, setError] = useState<string | null>(null)
  const layout = useResponsiveLayout()
  const requestSequence = useRef(0)

  const load = useCallback(async (nextPeriod: Period) => {
    const sequence = ++requestSequence.current
    const cached = readFieldCache<FieldPersonalKpiData>(cacheKey(nextPeriod))
    if (cached) setData(cached.value)
    else setData(null)
    setError(null)
    setPhase(cached ? "refreshing" : "loading")
    try {
      const next = await fieldApi.personalKpi(nextPeriod)
      if (sequence !== requestSequence.current) return
      setData(next)
      writeFieldCache(cacheKey(nextPeriod), next)
      setPhase("ready")
    } catch (reason) {
      if (sequence !== requestSequence.current) return
      setError(fieldErrorMessage(reason, "kpiUnavailable"))
      setPhase(cached ? "stale" : "error")
    }
  }, [])

  useEffect(() => {
    void load(period)
  }, [load, period])

  const refreshing = phase === "refreshing"
  const commercial = !IS_LEADDRIVE_FIELD && data?.commercial.availability === "READY" ? data.commercial.data : null
  const uncovered = data?.coverage.overall.uncovered ?? []
  const exceptionCount = uncovered.length + (data?.tasks.overdue ?? 0) +
    (data?.gps.daysWithoutPoints.length ?? 0) + (data?.visits.missed ?? 0)
  const freshnessLabel = phase === "stale"
    ? t("kpiCached")
    : refreshing
      ? `${t("kpiCached")} · ${t("kpiLoading")}`
      : data ? `${t("kpiUpdated")}: ${formatShortDateTime(data.generatedAt, locale)}` : ""
  const freshnessIcon = phase === "stale" ? "alert" : refreshing ? "refresh" : "check"
  const freshnessColor = phase === "stale" ? colors.warning : refreshing ? colors.primary : colors.successDark

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(period)} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} accessibilityHint={t("personalKpiTitle")} onPress={() => safeFieldBack("/(app)/(tabs)/work")} style={styles.back}>
            <TabIcon name="chevronLeft" color={colors.text} size={23} />
          </Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>LEADDRIVE FIELD</Text>
            <Text style={styles.title}>{t("personalKpiTitle")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={refreshing ? t("kpiLoading") : t("kpiRefresh")} accessibilityHint={t("personalKpiHint")} accessibilityState={{ busy: refreshing, disabled: refreshing }} disabled={refreshing} onPress={() => void load(period)} style={[styles.refreshButton, refreshing && styles.disabled]}>
            <TabIcon name="refresh" color={colors.primary} size={22} />
          </Pressable>
        </View>

        <View style={styles.periodSwitch}>
          {(["week", "month"] as const).map((value) => (
            <Pressable
              accessibilityRole="button"
              key={value}
              accessibilityLabel={value === "week" ? t("kpiPeriodWeek") : t("kpiPeriodMonth")}
              accessibilityHint={t("personalKpiHint")}
              accessibilityState={{ selected: period === value, busy: period === value && (phase === "loading" || refreshing) }}
              onPress={() => setPeriod(value)}
              style={[styles.periodButton, period === value && styles.periodButtonActive]}
            >
              <Text style={[styles.periodText, period === value && styles.periodTextActive]}>
                {value === "week" ? t("kpiPeriodWeek") : t("kpiPeriodMonth")}
              </Text>
            </Pressable>
          ))}
        </View>

        {!data && phase === "loading" ? (
          <View accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.stateCard}><View accessible={false} style={styles.stateIcon}><TabIcon name="refresh" color={colors.primary} size={27} /></View><Text style={styles.stateTitle}>{t("kpiLoading")}</Text></View>
        ) : null}
        {!data && phase === "error" ? (
          <View accessibilityRole="alert" style={[styles.stateCard, styles.errorCard]}>
            <View accessible={false} style={styles.stateIcon}><TabIcon name="alert" color={colors.missed} size={29} /></View>
            <Text style={styles.stateTitle}>{t("kpiUnavailable")}</Text>
            {error ? <Text style={styles.stateBody}>{error}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={t("kpiRefresh")} accessibilityHint={t("personalKpiHint")} accessibilityState={{ busy: false, disabled: false }} onPress={() => void load(period)} style={styles.retry}><TabIcon name="refresh" color={colors.headerText} size={18} /><Text style={styles.retryText}>{t("kpiRefresh")}</Text></Pressable>
          </View>
        ) : null}

        {data ? (
          <>
            <View accessible accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={freshnessLabel} style={[styles.freshness, phase === "stale" && styles.freshnessStale, refreshing && styles.freshnessRefreshing]}>
              <TabIcon name={freshnessIcon} color={freshnessColor} size={17} />
              <Text style={styles.freshnessText}>{freshnessLabel}</Text>
            </View>

            <View style={styles.hero}>
              <View style={styles.heroTop}>
                <View>
                  <Text style={styles.heroLabel}>{t("kpiVisitPlan")}</Text>
                  <Text style={styles.heroPeriod}>{data.period.start} — {data.period.endExclusive}</Text>
                </View>
                <View style={styles.heroBadge}><Text style={styles.heroBadgeText}>{period === "week" ? t("kpiPeriodWeek") : t("kpiPeriodMonth")}</Text></View>
              </View>
              <View style={styles.heroScoreRow}>
                <Text style={styles.heroScore}>{data.visits.fulfillment.percentage.toFixed(data.visits.fulfillment.percentage % 1 ? 1 : 0)}</Text>
                <Text style={styles.heroPercent}>%</Text>
              </View>
              <Text style={styles.heroHint}>{t("kpiVisitPlanHint")}</Text>
              <View style={styles.heroTrack}><View style={[styles.heroFill, { width: `${Math.min(100, data.visits.fulfillment.percentage)}%` as `${number}%` }]} /></View>
              <View style={styles.heroStats}>
                <HeroStat label={t("kpiPlanned")} value={data.visits.planned} />
                <HeroStat label={t("kpiCompleted")} value={data.visits.completedPlanned} />
                <HeroStat label={t("kpiUnplanned")} value={data.visits.unplannedCompleted} />
                <HeroStat label={t("kpiMissed")} value={data.visits.missed} warning={data.visits.missed > 0} />
              </View>
            </View>

            <SectionTitle title={t("kpiCoverage")} hint={t("kpiCoverageHint")} />
            <View style={styles.card}>
              <CoverageRow label={t("kpiOverall")} metric={data.coverage.overall} color={colors.primary} />
              <CoverageRow label={t("kpiDoctors")} metric={data.coverage.doctors} color={colors.holiday} />
              <CoverageRow label={t("kpiPharmacies")} metric={data.coverage.pharmacies} color={colors.success} />
              <CoverageRow label={t("kpiOther")} metric={data.coverage.other} color={colors.info} />
            </View>

            <SectionTitle title={t("kpiWorkQuality")} />
            <View style={styles.grid}>
              <MetricCard tablet={layout.isTablet} label={t("kpiTasks")} value={`${data.tasks.completion.percentage}%`} detail={t("kpiOf", { done: data.tasks.completed, total: data.tasks.assigned })} warning={data.tasks.overdue > 0} />
              <MetricCard tablet={layout.isTablet} label={t("kpiGpsDays")} value={`${data.gps.dayCoverage.percentage}%`} detail={t("kpiOf", { done: data.gps.workdaysWithGps, total: data.gps.workdays })} warning={data.gps.daysWithoutPoints.length > 0} />
              <MetricCard tablet={layout.isTablet} label={t("kpiWorkedTime")} value={formatHours(data.gps.workedSeconds)} detail={`${t("kpiPoints")}: ${data.gps.points}`} />
              <MetricCard tablet={layout.isTablet} label={t("kpiDistance")} value={formatDistance(data.gps.distanceMeters)} detail={`${t("kpiAverageAccuracy")}: ${data.gps.averageAccuracyMeters == null ? "—" : `${data.gps.averageAccuracyMeters} ${t("kpiMetersShort")}`}`} warning={data.gps.truncated} />
            </View>

            {!IS_LEADDRIVE_FIELD ? (
              <>
                <SectionTitle title={t("kpiCommercial")} hint={t("kpiCommercialHint")} />
                {commercial ? (
                  <View style={styles.card}>
                    <View style={styles.commercialHeader}>
                      <View style={styles.sourceBadge}><Text style={styles.sourceBadgeText}>LEADSHELF</Text></View>
                      <Text style={styles.commercialTime}>{formatShortDateTime(commercial.generatedAt, locale)}</Text>
                    </View>
                    <Text style={styles.subsectionTitle}>{t("kpiOrders")}</Text>
                    <View style={styles.statRow}>
                      <Stat label={t("kpiPlaced")} value={commercial.orders.placed} />
                      <Stat label={t("kpiDelivered")} value={commercial.orders.delivered} tone="good" />
                      <Stat label={t("kpiMissed")} value={commercial.orders.cancelled} tone={commercial.orders.cancelled > 0 ? "warning" : "default"} />
                    </View>
                    {commercial.orders.amounts.map((amount) => (
                      <View key={amount.currency} style={styles.amountRow}>
                        <View><Text style={styles.amountLabel}>{t("kpiAmount")}</Text><Text style={styles.amountValue}>{formatAmount(amount.totalAmount, amount.currency, locale)}</Text></View>
                        <Text style={styles.discount}>{t("kpiDiscount")}: {formatAmount(amount.discountAmount, amount.currency, locale)}</Text>
                      </View>
                    ))}
                    <View style={styles.divider} />
                    <Text style={styles.subsectionTitle}>{t("kpiPromotions")}</Text>
                    <View style={styles.statRow}>
                      <Stat label={t("kpiActivePromos")} value={commercial.promotions.active} />
                      <Stat label={t("kpiPromoOrders")} value={commercial.promotions.ordersWithPromotion} tone="good" />
                      <Stat label={t("kpiShelfTasks")} value={`${commercial.shelfTasks.completed}/${commercial.shelfTasks.assigned}`} tone={commercial.shelfTasks.overdue > 0 ? "warning" : "good"} />
                    </View>
                  </View>
                ) : (
                  <View style={[styles.card, styles.commercialUnavailable]}>
                    <View style={styles.unavailableIcon}><Text style={styles.unavailableIconText}>↯</Text></View>
                    <View style={styles.unavailableBody}><Text style={styles.unavailableTitle}>LEADSHELF</Text><Text style={styles.unavailableText}>{t("kpiCommercialUnavailable")}</Text></View>
                  </View>
                )}
              </>
            ) : null}

            <SectionTitle title={t("kpiAttention")} />
            <View style={[styles.card, exceptionCount === 0 && styles.allGoodCard]}>
              {exceptionCount === 0 ? (
                <View accessible accessibilityRole="text" accessibilityLabel={t("kpiNoExceptions")} style={styles.allGood}><View accessible={false} style={styles.allGoodIcon}><TabIcon name="check" color={colors.headerText} size={18} /></View><Text style={styles.allGoodText}>{t("kpiNoExceptions")}</Text></View>
              ) : (
                <>
                  {uncovered.length > 0 ? <ExceptionRow label={t("kpiUncovered")} value={uncovered.length} action={uncovered[0]?.contactId ? "/(app)/contacts" : "/(app)/organizations"} /> : null}
                  {data.tasks.overdue > 0 ? <ExceptionRow label={t("kpiOverdueTasks")} value={data.tasks.overdue} action="/(app)/field-tasks" /> : null}
                  {data.gps.daysWithoutPoints.length > 0 ? <ExceptionRow label={t("kpiGpsGaps")} value={data.gps.daysWithoutPoints.length} action="/(app)/workday" /> : null}
                  {data.visits.missed > 0 ? <ExceptionRow label={t("kpiMissedStops")} value={data.visits.missed} action="/(app)/routes" last /> : null}
                </>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function HeroStat({ label, value, warning }: { label: string; value: number; warning?: boolean }) {
  return <View style={styles.heroStat}><Text style={styles.heroStatLabel}>{label}</Text><Text style={[styles.heroStatValue, warning && styles.heroStatWarning]}>{value}</Text></View>
}

function MetricCard({ label, value, detail, warning, tablet }: { label: string; value: string; detail: string; warning?: boolean; tablet?: boolean }) {
  return <View style={[styles.metricCard, tablet && styles.metricCardTablet, warning && styles.metricCardWarning]}><Text style={styles.metricCardLabel}>{label}</Text><Text style={[styles.metricCardValue, warning && styles.warningText]}>{value}</Text><Text style={styles.metricCardDetail}>{detail}</Text></View>
}

function ExceptionRow({ label, value, action, last }: { label: string; value: number; action: string; last?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} accessibilityHint={t("personalKpiOpen")} onPress={() => router.push(action as never)} style={[styles.exceptionRow, last && styles.exceptionRowLast]}>
      <View style={styles.exceptionCount}><Text style={styles.exceptionCountText}>{value}</Text></View>
      <Text style={styles.exceptionLabel}>{label}</Text>
      <TabIcon name="chevronRight" color={colors.faint} size={20} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 36 },
  header: { paddingHorizontal: 14, paddingTop: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  headerBody: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 24, fontWeight: "900", marginTop: 2 },
  refreshButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.55 },
  periodSwitch: { marginHorizontal: 14, marginTop: 14, padding: 4, borderRadius: 15, backgroundColor: colors.card, flexDirection: "row", borderWidth: 1, borderColor: colors.border },
  periodButton: { flex: 1, minHeight: 44, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  periodButtonActive: { backgroundColor: colors.primary },
  periodText: { color: colors.muted, fontSize: 14, fontWeight: "800" },
  periodTextActive: { color: colors.headerText },
  freshness: { marginHorizontal: 16, marginTop: 12, flexDirection: "row", alignItems: "center", gap: 7 },
  freshnessStale: { padding: 10, borderRadius: radii.inner, backgroundColor: colors.warningBg },
  freshnessRefreshing: { padding: 10, borderRadius: radii.inner, backgroundColor: colors.primarySoft },
  freshnessText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 17 },
  stateCard: { marginHorizontal: 14, marginTop: 20, minHeight: 190, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", padding: 24, ...cardShadow },
  errorCard: { borderWidth: 1, borderColor: colors.dangerBorder },
  stateIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  stateTitle: { color: colors.text, fontSize: 16, fontWeight: "900", textAlign: "center", marginTop: 10 },
  stateBody: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 8 },
  retry: { minHeight: 44, marginTop: 14, paddingHorizontal: 20, borderRadius: 14, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  retryText: { color: colors.headerText, fontSize: 14, fontWeight: "900" },
  hero: { marginHorizontal: 14, marginTop: 12, borderRadius: 24, padding: 18, backgroundColor: colors.primary, ...cardShadow },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  heroLabel: { color: colors.headerText, fontSize: 16, fontWeight: "900" },
  heroPeriod: { color: colors.headerSubtext, fontSize: 11, marginTop: 4 },
  heroBadge: { minHeight: 30, borderRadius: radii.pill, paddingHorizontal: 11, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  heroBadgeText: { color: colors.headerText, fontSize: 11, fontWeight: "900" },
  heroScoreRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 16 },
  heroScore: { color: colors.headerText, fontSize: 56, lineHeight: 60, fontWeight: "900", letterSpacing: -2 },
  heroPercent: { color: colors.headerSubtext, fontSize: 24, fontWeight: "900", marginTop: 7 },
  heroHint: { color: colors.headerSubtext, fontSize: 12, lineHeight: 17, marginTop: 5 },
  heroTrack: { height: 8, borderRadius: 4, marginTop: 14, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.2)" },
  heroFill: { height: "100%", borderRadius: 4, backgroundColor: colors.headerText },
  heroStats: { marginTop: 14, flexDirection: "row", gap: 6 },
  heroStat: { flex: 1, minWidth: 0, padding: 9, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.12)" },
  heroStatLabel: { color: colors.headerSubtext, fontSize: 9, fontWeight: "800" },
  heroStatValue: { color: colors.headerText, fontSize: 18, fontWeight: "900", marginTop: 3 },
  heroStatWarning: { color: "#FDE68A" },
  sectionHeading: { marginHorizontal: 16, marginTop: 24, marginBottom: 9 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  sectionHint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  card: { marginHorizontal: 14, borderRadius: radii.card, backgroundColor: colors.card, padding: 15, ...cardShadow },
  coverageRow: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  coverageLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  coverageLabel: { color: colors.text, fontSize: 14, fontWeight: "800" },
  coverageException: { color: colors.warning, fontSize: 12, fontWeight: "900" },
  progressBlock: { marginTop: 7 },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressRatio: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  progressPercent: { fontSize: 12, fontWeight: "900" },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.skeleton, overflow: "hidden", marginTop: 5 },
  fill: { height: "100%", borderRadius: 3 },
  grid: { marginHorizontal: 14, flexDirection: "row", flexWrap: "wrap", gap: 9 },
  metricCard: { width: "48%", minHeight: 116, borderRadius: radii.card, backgroundColor: colors.card, padding: 14, borderWidth: 1, borderColor: colors.border, ...cardShadow },
  metricCardTablet: { width: "23.5%", flexGrow: 1 },
  metricCardWarning: { borderColor: colors.warning, backgroundColor: "#FFFBEB" },
  metricCardLabel: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  metricCardValue: { color: colors.text, fontSize: 24, fontWeight: "900", marginTop: 8 },
  metricCardDetail: { color: colors.faint, fontSize: 11, lineHeight: 15, marginTop: 5 },
  commercialHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  sourceBadge: { borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.infoBg },
  sourceBadgeText: { color: colors.info, fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  commercialTime: { color: colors.faint, fontSize: 11 },
  subsectionTitle: { color: colors.text, fontSize: 14, fontWeight: "900", marginBottom: 9 },
  statRow: { flexDirection: "row", gap: 7 },
  stat: { flex: 1, minHeight: 70, borderRadius: 12, backgroundColor: colors.bg, padding: 10 },
  statGood: { backgroundColor: colors.successBg },
  statWarning: { backgroundColor: colors.warningBg },
  statLabel: { color: colors.muted, fontSize: 10, lineHeight: 13 },
  statValue: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 5 },
  goodText: { color: colors.successDark },
  warningText: { color: colors.warning },
  amountRow: { marginTop: 10, minHeight: 58, borderRadius: 12, backgroundColor: colors.primarySoft, padding: 11, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  amountLabel: { color: colors.muted, fontSize: 10 },
  amountValue: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 2 },
  discount: { color: colors.primary, fontSize: 10, fontWeight: "800", textAlign: "right" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 15 },
  commercialUnavailable: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderWidth: 1, borderColor: colors.warning },
  unavailableIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.warningBg, alignItems: "center", justifyContent: "center" },
  unavailableIconText: { color: colors.warning, fontSize: 22, fontWeight: "900" },
  unavailableBody: { flex: 1 },
  unavailableTitle: { color: colors.warning, fontSize: 12, fontWeight: "900" },
  unavailableText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  allGoodCard: { backgroundColor: colors.successBg, borderWidth: 1, borderColor: colors.successBorder },
  allGood: { flexDirection: "row", alignItems: "center", gap: 11, minHeight: 52 },
  allGoodIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.success, alignItems: "center", justifyContent: "center" },
  allGoodText: { flex: 1, color: colors.successDark, fontSize: 14, fontWeight: "800" },
  exceptionRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  exceptionRowLast: { borderBottomWidth: 0 },
  exceptionCount: { minWidth: 34, height: 34, borderRadius: 12, backgroundColor: colors.warningBg, alignItems: "center", justifyContent: "center" },
  exceptionCountText: { color: colors.warning, fontSize: 13, fontWeight: "900" },
  exceptionLabel: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "800" },
})
