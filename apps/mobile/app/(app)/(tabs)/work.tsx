import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { countOpenTasks } from "../../../src/db/local-store"
import { useField } from "../../../src/field/field-context"
import { t, useLocale } from "../../../src/i18n"
import { TabIcon, type TabIconName } from "../../../src/components/TabIcon"
import { colors, radii } from "../../../src/theme"
import { useResponsiveLayout } from "../../../src/layout/responsive"

type Module = {
  label: string
  hint: string
  icon: TabIconName
  href: string
  badge?: number
}

export default function WorkTab() {
  useLocale()
  const field = useField()
  const layout = useResponsiveLayout()
  const shelfOpenTasks = countOpenTasks()
  const modules: Module[] = [
    { label: t("workdayTitle"), hint: t("workdayHint"), icon: "today", href: "/(app)/workday" },
    { label: t("tabRoute"), hint: t("todayRoute"), icon: "route", href: "/(app)/routes" },
    { label: t("shelfTasksTitle"), hint: t("shelfTasksHint"), icon: "tasks", href: "/(app)/(tabs)/tasks", badge: shelfOpenTasks },
    { label: t("tabShelves"), hint: t("shelvesSectionSubtitle"), icon: "shelves", href: "/(app)/(tabs)/shelves" },
    { label: t("tabPlanograms"), hint: t("planogramsSectionSubtitle"), icon: "planograms", href: "/(app)/(tabs)/planograms" },
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
            <Text style={styles.identityName}>{field.profile?.agent.organizationName ?? "LeadShelf"}</Text>
          </View>
          <View style={[styles.connection, field.profile?.capabilities.shelfExecution.enabled ? styles.connectionOn : styles.connectionOff]}>
            <View style={[styles.connectionDot, { backgroundColor: field.profile?.capabilities.shelfExecution.enabled ? colors.success : colors.warning }]} />
            <Text style={styles.connectionText}>{field.profile?.capabilities.shelfExecution.enabled ? t("shelfConnected") : t("shelfUnavailable")}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>{t("quickActions")}</Text>
        <View style={[styles.moduleList, layout.isTablet && styles.moduleGridTablet]}>
          {modules.map((module, index) => (
            <Pressable
              key={module.href}
              onPress={() => router.push(module.href as never)}
              style={({ pressed }) => [styles.moduleRow, index > 0 && !layout.isTablet && styles.moduleBorder, layout.isTablet && styles.moduleRowTablet, pressed && styles.pressed]}
            >
              <View style={styles.glyph}><TabIcon name={module.icon} color={colors.primary} size={21} /></View>
              {module.badge ? <View style={styles.badge}><Text style={styles.badgeText}>{module.badge > 99 ? "99+" : module.badge}</Text></View> : null}
              <View style={styles.moduleBody}>
                <Text style={styles.moduleLabel}>{module.label}</Text>
                <Text style={styles.moduleHint} numberOfLines={1}>{module.hint}</Text>
              </View>
              <Text style={styles.open}>›</Text>
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
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 13 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.3 },
  title: { color: colors.text, fontSize: 29, fontWeight: "900", letterSpacing: -0.8, marginTop: 5 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 5, maxWidth: 330 },
  identityCard: { marginHorizontal: 20, marginTop: 5, backgroundColor: colors.navy, borderRadius: radii.card, padding: 15, flexDirection: "row", alignItems: "center", gap: 12 },
  identityMark: { width: 44, height: 44, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  identityInitial: { color: colors.headerText, fontSize: 18, fontWeight: "900" },
  identityBody: { flex: 1, minWidth: 0 },
  identityLabel: { color: colors.headerSubtext, fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  identityName: { color: colors.headerText, fontSize: 15, fontWeight: "900", marginTop: 3 },
  connection: { maxWidth: 105, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  connectionOn: { backgroundColor: colors.successBg },
  connectionOff: { backgroundColor: colors.warningBg },
  connectionDot: { width: 6, height: 6, borderRadius: 3 },
  connectionText: { flexShrink: 1, color: colors.headerText, fontSize: 9, fontWeight: "800" },
  sectionTitle: { marginHorizontal: 20, marginTop: 25, marginBottom: 10, color: colors.text, fontSize: 16, fontWeight: "900" },
  moduleList: { marginHorizontal: 20, borderRadius: radii.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  moduleRow: { minHeight: 72, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12, position: "relative" },
  moduleBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  glyph: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", left: 43, top: 10, minWidth: 19, height: 19, borderRadius: 10, backgroundColor: colors.danger, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", zIndex: 2 },
  badgeText: { color: colors.headerText, fontSize: 10, fontWeight: "900" },
  moduleBody: { flex: 1, minWidth: 0 },
  moduleLabel: { color: colors.text, fontSize: 14, fontWeight: "900" },
  moduleHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  open: { color: colors.faint, fontSize: 25, fontWeight: "400" },
  pressed: { opacity: 0.7 },
  moduleGridTablet: { flexDirection: "row", flexWrap: "wrap", gap: 12, padding: 12, borderWidth: 0, backgroundColor: "transparent", overflow: "visible" },
  moduleRowTablet: { flexBasis: "48%", flexGrow: 1, minHeight: 88, borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, backgroundColor: colors.card },
})
