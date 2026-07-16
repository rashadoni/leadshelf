import { useCallback, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { router, useFocusEffect } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { countOpenTasks, readFieldCommitments, readFieldDocuments, readFieldHrm } from "../../../src/db/local-store"
import { useField } from "../../../src/field/field-context"
import { t, useLocale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"

type Module = {
  label: string
  hint: string
  glyph: string
  href: string
  background: string
  color: string
  badge?: number
}

export default function WorkTab() {
  const locale = useLocale()
  const field = useField()
  const shelfOpenTasks = countOpenTasks()
  const [openCommitments, setOpenCommitments] = useState(() => (
    readFieldCommitments().commitments.filter((item) => !item.fulfillment).length
  ))
  const [requiredDocuments, setRequiredDocuments] = useState(() => (
    readFieldDocuments().documents.filter((item) => item.assignment.required && !item.assignment.readAt).length
  ))
  const [pendingHrm, setPendingHrm] = useState(() => (
    readFieldHrm()?.requests.filter((item) => item.status === "PENDING").length ?? 0
  ))
  useFocusEffect(useCallback(() => {
    setOpenCommitments(readFieldCommitments().commitments.filter((item) => !item.fulfillment).length)
    setRequiredDocuments(readFieldDocuments().documents.filter((item) => item.assignment.required && !item.assignment.readAt).length)
    setPendingHrm(readFieldHrm()?.requests.filter((item) => item.status === "PENDING").length ?? 0)
  }, []))
  const agentOpenTasks = field.agentTasks?.tasks.filter((task) => (
    task.status !== "COMPLETED" && task.status !== "CANCELLED"
  )).length ?? 0
  const modules: Module[] = [
    { label: t("workdayTitle"), hint: t("workdayHint"), glyph: "◷", href: "/(app)/workday", background: colors.successBg, color: colors.successDark },
    { label: locale === "az" ? "Sənədlər" : "Документы", hint: locale === "az" ? "Vacib və oflayn fayllar" : "Обязательные и офлайн-файлы", glyph: "□", href: "/(app)/documents", background: colors.infoBg, color: colors.info, badge: requiredDocuments },
    { label: locale === "az" ? "Qrafik və HRM" : "График и HRM", hint: locale === "az" ? "İş günləri və müraciətlər" : "Рабочие дни и заявки", glyph: "◫", href: "/(app)/hrm", background: colors.holidayBg, color: colors.holiday, badge: pendingHrm },
    { label: t("tabRoute"), hint: t("todayRoute"), glyph: "↗", href: "/(app)/routes", background: colors.infoBg, color: colors.info },
    { label: t("moduleOrganizations"), hint: t("organizationsSearch"), glyph: "⌂", href: "/(app)/organizations", background: colors.primarySoft, color: colors.primary },
    { label: t("moduleContacts"), hint: t("contactsSearch"), glyph: "◎", href: "/(app)/contacts", background: colors.holidayBg, color: colors.holiday },
    { label: t("myCustomerRequests"), hint: t("newCustomerHint"), glyph: "+", href: "/(app)/customer-requests", background: colors.warningBg, color: colors.warning },
    { label: t("agentTasksTitle"), hint: t("agentTasksHint"), glyph: "✓", href: "/(app)/field-tasks", background: colors.warningBg, color: colors.warning, badge: agentOpenTasks },
    { label: t("commitmentsTitle"), hint: t("commitmentsHint"), glyph: "◇", href: "/(app)/commitments", background: colors.holidayBg, color: colors.holiday, badge: openCommitments },
    { label: t("shelfTasksTitle"), hint: t("shelfTasksHint"), glyph: "▦", href: "/(app)/(tabs)/tasks", background: colors.infoBg, color: colors.info, badge: shelfOpenTasks },
    { label: t("commercialCenterTitle"), hint: t("commercialCenterHint"), glyph: "₼", href: "/(app)/commercial", background: colors.successBg, color: colors.successDark },
    { label: t("tabOrders"), hint: t("selectedOrderSummary"), glyph: "▤", href: "/(app)/(tabs)/orders", background: colors.successBg, color: colors.successDark },
    { label: t("tabShelves"), hint: t("shelvesSectionSubtitle"), glyph: "▦", href: "/(app)/(tabs)/shelves", background: colors.holidayBg, color: colors.holiday },
    { label: t("tabPlanograms"), hint: t("planogramsSectionSubtitle"), glyph: "▥", href: "/(app)/(tabs)/planograms", background: colors.primarySoft, color: colors.primary },
    { label: t("tabDashboard"), hint: t("todayOverview"), glyph: "▥", href: "/(app)/(tabs)/dashboard", background: colors.draftBg, color: colors.draft },
  ]

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>{t("tabWork").toUpperCase()}</Text>
          <Text style={styles.title}>{t("workTitle")}</Text>
          <Text style={styles.subtitle}>{t("workSubtitle")}</Text>
        </View>

        <View style={styles.identityCard}>
          <View style={styles.identityMark}>
            <Text style={styles.identityInitial}>{field.profile?.agent.organizationName?.charAt(0).toUpperCase() ?? "L"}</Text>
          </View>
          <View style={styles.identityBody}>
            <Text style={styles.identityLabel}>{t("organization")}</Text>
            <Text style={styles.identityName}>{field.profile?.agent.organizationName ?? "LeadDrive"}</Text>
          </View>
          <View style={[styles.connection, field.profile?.capabilities.shelfExecution.enabled ? styles.connectionOn : styles.connectionOff]}>
            <View style={[styles.connectionDot, { backgroundColor: field.profile?.capabilities.shelfExecution.enabled ? colors.success : colors.warning }]} />
            <Text style={styles.connectionText}>{field.profile?.capabilities.shelfExecution.enabled ? t("shelfConnected") : t("shelfUnavailable")}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>{t("quickActions")}</Text>
        <View style={styles.grid}>
          {modules.map((module) => (
            <Pressable
              key={module.href}
              onPress={() => router.push(module.href as never)}
              style={({ pressed }) => [styles.moduleCard, pressed && styles.pressed]}
            >
              <View style={[styles.glyph, { backgroundColor: module.background }]}>
                <Text style={[styles.glyphText, { color: module.color }]}>{module.glyph}</Text>
              </View>
              {module.badge ? <View style={styles.badge}><Text style={styles.badgeText}>{module.badge > 99 ? "99+" : module.badge}</Text></View> : null}
              <Text style={styles.moduleLabel}>{module.label}</Text>
              <Text style={styles.moduleHint} numberOfLines={2}>{module.hint}</Text>
              <Text style={[styles.open, { color: module.color }]}>→</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 28 },
  header: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  title: { color: colors.text, fontSize: 27, fontWeight: "900", letterSpacing: -0.6, marginTop: 4 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 5, maxWidth: 330 },
  identityCard: { marginHorizontal: 14, marginTop: 5, backgroundColor: colors.card, borderRadius: radii.card, padding: 14, flexDirection: "row", alignItems: "center", gap: 11, ...cardShadow },
  identityMark: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  identityInitial: { color: colors.headerText, fontSize: 18, fontWeight: "900" },
  identityBody: { flex: 1, minWidth: 0 },
  identityLabel: { color: colors.faint, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  identityName: { color: colors.text, fontSize: 14, fontWeight: "900", marginTop: 2 },
  connection: { maxWidth: 105, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  connectionOn: { backgroundColor: colors.successBg },
  connectionOff: { backgroundColor: colors.warningBg },
  connectionDot: { width: 6, height: 6, borderRadius: 3 },
  connectionText: { flexShrink: 1, color: colors.text, fontSize: 9, fontWeight: "800" },
  sectionTitle: { marginHorizontal: 16, marginTop: 22, marginBottom: 10, color: colors.text, fontSize: 17, fontWeight: "900" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: 9 },
  moduleCard: { width: "46%", minHeight: 168, marginHorizontal: "2%", marginBottom: 12, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, position: "relative", ...cardShadow },
  glyph: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  glyphText: { fontSize: 19, fontWeight: "900" },
  badge: { position: "absolute", top: 12, right: 12, minWidth: 24, height: 24, borderRadius: 12, backgroundColor: colors.danger, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  badgeText: { color: colors.headerText, fontSize: 10, fontWeight: "900" },
  moduleLabel: { color: colors.text, fontSize: 15, fontWeight: "900", marginTop: 13 },
  moduleHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4, paddingRight: 4 },
  open: { position: "absolute", bottom: 12, right: 14, fontSize: 19, fontWeight: "700" },
  pressed: { opacity: 0.7, transform: [{ scale: 0.985 }] },
})
