import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { countOpenTasks } from "../../../src/db/local-store"
import { useField } from "../../../src/field/field-context"
import type { FieldWorkdayStatus } from "../../../src/field/contracts"
import { t, type MessageKey, useLocale } from "../../../src/i18n"
import { TabIcon, type TabIconName } from "../../../src/components/TabIcon"
import { colors, radii } from "../../../src/theme"
import { useResponsiveLayout } from "../../../src/layout/responsive"
import { IS_LEADDRIVE_FIELD } from "../../../src/config/mobile-variant"
import { hasFieldManagerRole } from "../../../src/field/manager-access"

type Module = {
  label: string
  hint: string
  icon: TabIconName
  href: string
  badge?: number
}

type DisplayWorkdayStatus = FieldWorkdayStatus | "NOT_STARTED"

const workdayStatusKeys: Record<DisplayWorkdayStatus, MessageKey> = {
  NOT_STARTED: "workdayStatus_NOT_STARTED",
  STARTED: "workdayStatus_STARTED",
  PAUSED: "workdayStatus_PAUSED",
  COMPLETED: "workdayStatus_COMPLETED",
}

export default function WorkTab() {
  useLocale()
  const field = useField()
  const layout = useResponsiveLayout()
  const [moreOpen, setMoreOpen] = useState(false)
  const shelfOpenTasks = IS_LEADDRIVE_FIELD ? 0 : countOpenTasks()
  const fieldOpenTasks = field.agentTasks?.tasks.filter((task) => task.status !== "COMPLETED" && task.status !== "CANCELLED").length ?? 0
  const workdayStatus: DisplayWorkdayStatus = field.workday?.workday?.status ?? "NOT_STARTED"
  const activeWorkday = workdayStatus === "STARTED"
  const pausedWorkday = workdayStatus === "PAUSED"
  const completedWorkday = workdayStatus === "COMPLETED"
  const workdayStatusLabel = t(workdayStatusKeys[workdayStatus])
  const workdayStatusIcon: TabIconName = activeWorkday ? "play" : pausedWorkday ? "pause" : completedWorkday ? "check" : "today"
  const workdayStatusColor = activeWorkday || completedWorkday ? colors.successDark : pausedWorkday ? colors.warning : colors.muted
  const shelfExecutionEnabled = Boolean(field.profile?.capabilities.shelfExecution.enabled)
  const shelfStatusLabel = t(shelfExecutionEnabled ? "shelfConnected" : "shelfUnavailable")
  const canOpenManager = IS_LEADDRIVE_FIELD && hasFieldManagerRole(field.profile?.agent.role)
  const modules: Module[] = IS_LEADDRIVE_FIELD
    ? [
        { label: t("workdayTitle"), hint: t("workdayHint"), icon: "today", href: "/(app)/workday" },
        { label: t("tabRoute"), hint: t("todayRoute"), icon: "route", href: "/(app)/routes" },
        { label: t("agentTasksTitle"), hint: t("agentTasksSubtitle"), icon: "tasks", href: "/(app)/field-tasks", badge: fieldOpenTasks },
        { label: t("moduleOrganizations"), hint: t("organizationsSearch"), icon: "organizations", href: "/(app)/organizations" },
        { label: t("moduleContacts"), hint: t("contactsSearch"), icon: "contacts", href: "/(app)/contacts" },
        ...(canOpenManager ? [{ label: t("managerHomeTitle"), hint: t("managerHomeSubtitle"), icon: "dashboard" as const, href: "/(app)/manager" }] : []),
      ]
    : [
        { label: t("workdayTitle"), hint: t("workdayHint"), icon: "today", href: "/(app)/workday" },
        { label: t("tabRoute"), hint: t("todayRoute"), icon: "route", href: "/(app)/routes" },
        { label: t("shelfTasksTitle"), hint: t("shelfTasksHint"), icon: "tasks", href: "/(app)/(tabs)/tasks", badge: shelfOpenTasks },
        { label: t("tabShelves"), hint: t("shelvesSectionSubtitle"), icon: "shelves", href: "/(app)/(tabs)/shelves" },
        { label: t("tabPlanograms"), hint: t("planogramsSectionSubtitle"), icon: "planograms", href: "/(app)/(tabs)/planograms" },
      ]
  const moreModules: Module[] = IS_LEADDRIVE_FIELD
    ? [
        { label: t("moduleDocuments"), hint: t("moduleDocumentsHint"), icon: "document", href: "/(app)/documents" },
        { label: t("moduleCommitments"), hint: t("moduleCommitmentsHint"), icon: "visit", href: "/(app)/commitments" },
      ]
    : []
  // Keep the first screen focused on the three actions that move a field
  // employee through the day. Customer, manager, and record tools stay one
  // intentional tap away instead of competing with the daily flow.
  const primaryModules = modules.slice(0, 3)
  const secondaryModules = [...modules.slice(3), ...moreModules]
  const moduleAccessibilityHint = (module: Module) => module.badge === undefined ? module.hint : `${module.hint} ${t("tasksOpenLabel")}: ${module.badge}`

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>{t("tabWork").toUpperCase()}</Text>
          <Text style={styles.title}>{t("workTitle")}</Text>
          <Text style={styles.subtitle}>{t(IS_LEADDRIVE_FIELD ? "fieldWorkSubtitle" : "workSubtitle")}</Text>
        </View>

        <View style={styles.identityCard}>
          <View style={styles.identityMark}>
            <Text style={styles.identityInitial}>{field.profile?.agent.organizationName?.charAt(0).toUpperCase() ?? "L"}</Text>
          </View>
          <View style={styles.identityBody}>
            <Text style={styles.identityLabel}>{t("organization")}</Text>
            <Text style={styles.identityName}>{field.profile?.agent.organizationName ?? t("organizationUnavailable")}</Text>
          </View>
          {IS_LEADDRIVE_FIELD ? (
            <View accessible accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={`${t("workdayTitle")}: ${workdayStatusLabel}`} style={[styles.connection, activeWorkday || completedWorkday ? styles.connectionOn : pausedWorkday ? styles.connectionPaused : styles.connectionIdle]}>
              <TabIcon name={workdayStatusIcon} color={workdayStatusColor} size={14} />
              <Text style={[styles.connectionText, activeWorkday || completedWorkday ? styles.connectionTextOn : pausedWorkday ? styles.connectionTextOff : styles.connectionTextIdle]}>
                {workdayStatusLabel}
              </Text>
            </View>
          ) : (
            <View accessible accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={`${t("tabShelves")}: ${shelfStatusLabel}`} style={[styles.connection, shelfExecutionEnabled ? styles.connectionOn : styles.connectionOff]}>
              <TabIcon name={shelfExecutionEnabled ? "check" : "alert"} color={shelfExecutionEnabled ? colors.successDark : colors.warning} size={14} />
              <Text style={[styles.connectionText, shelfExecutionEnabled ? styles.connectionTextOn : styles.connectionTextOff]}>
                {shelfStatusLabel}
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.sectionTitle}>{t("quickActions")}</Text>
        <View style={[styles.moduleList, layout.isTablet && styles.moduleGridTablet]}>
          {primaryModules.map((module, index) => (
            <Pressable
              key={module.href}
              accessibilityRole="button"
              accessibilityLabel={module.label}
              accessibilityHint={moduleAccessibilityHint(module)}
              onPress={() => router.push(module.href as never)}
              style={({ pressed }) => [styles.moduleRow, index > 0 && !layout.isTablet && styles.moduleBorder, layout.isTablet && styles.moduleRowTablet, pressed && styles.pressed]}
            >
              <View style={styles.glyph}><TabIcon name={module.icon} color={colors.primary} size={21} /></View>
              {module.badge ? <View style={styles.badge}><Text style={styles.badgeText}>{module.badge > 99 ? "99+" : module.badge}</Text></View> : null}
              <View style={styles.moduleBody}>
                <Text style={styles.moduleLabel}>{module.label}</Text>
                <Text style={styles.moduleHint} numberOfLines={1}>{module.hint}</Text>
              </View>
              <TabIcon name="chevronRight" color={colors.faint} size={20} />
            </Pressable>
          ))}
        </View>

        {secondaryModules.length ? (
          <View style={[styles.moreCard, layout.isTablet && styles.moreCardTablet]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("workMoreForWork")}
              accessibilityHint={t(moreOpen ? "workMoreHide" : "workMoreShow")}
              accessibilityState={{ expanded: moreOpen }}
              onPress={() => setMoreOpen((value) => !value)}
              style={({ pressed }) => [styles.moreToggle, pressed && styles.pressed]}
            >
              <View style={styles.glyph}><TabIcon name="work" color={colors.primary} size={21} /></View>
              <View style={styles.moduleBody}>
                <Text style={styles.moduleLabel}>{t("workMoreForWork")}</Text>
              </View>
              <Text style={styles.moreAction}>{t(moreOpen ? "workMoreHide" : "workMoreShow")}</Text>
              <View style={[styles.moreChevron, moreOpen && styles.moreChevronOpen]}><TabIcon name="chevronDown" color={colors.faint} size={19} /></View>
            </Pressable>
            {moreOpen ? (
              <View style={styles.moreItems}>
                {secondaryModules.map((module, index) => (
                  <Pressable
                    key={module.href}
                    accessibilityRole="button"
                    accessibilityLabel={module.label}
                    accessibilityHint={moduleAccessibilityHint(module)}
                    onPress={() => router.push(module.href as never)}
                    style={({ pressed }) => [styles.moreItem, index > 0 && styles.moduleBorder, pressed && styles.pressed]}
                  >
                    <View style={styles.glyph}><TabIcon name={module.icon} color={colors.primary} size={21} /></View>
                    <View style={styles.moduleBody}>
                      <Text style={styles.moduleLabel}>{module.label}</Text>
                      <Text style={styles.moduleHint} numberOfLines={1}>{module.hint}</Text>
                    </View>
                    <TabIcon name="chevronRight" color={colors.faint} size={20} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 28 },
  header: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.3 },
  title: { color: colors.text, fontSize: 26, fontWeight: "900", letterSpacing: -0.6, marginTop: 5 },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 5, maxWidth: 330 },
  identityCard: { marginHorizontal: 20, marginTop: 5, minHeight: 64, backgroundColor: colors.card, borderRadius: radii.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  identityMark: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  identityInitial: { color: colors.primary, fontSize: 17, fontWeight: "900" },
  identityBody: { flex: 1, minWidth: 0 },
  identityLabel: { color: colors.muted, fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  identityName: { color: colors.text, fontSize: 15, fontWeight: "900", marginTop: 3 },
  connection: { maxWidth: 114, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  connectionOn: { backgroundColor: colors.successBg },
  connectionPaused: { backgroundColor: colors.warningBg },
  connectionIdle: { backgroundColor: colors.draftBg },
  connectionText: { flexShrink: 1, fontSize: 9, fontWeight: "800" },
  connectionTextOn: { color: colors.successDark },
  connectionTextOff: { color: colors.warning },
  connectionTextIdle: { color: colors.text },
  sectionTitle: { marginHorizontal: 20, marginTop: 22, marginBottom: 8, color: colors.text, fontSize: 16, fontWeight: "900" },
  moduleList: { marginHorizontal: 20, borderRadius: radii.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  moduleRow: { minHeight: 64, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12, position: "relative" },
  moduleBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  glyph: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", left: 40, top: 8, minWidth: 19, height: 19, borderRadius: 10, backgroundColor: colors.danger, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", zIndex: 2 },
  badgeText: { color: colors.headerText, fontSize: 10, fontWeight: "900" },
  moduleBody: { flex: 1, minWidth: 0 },
  moduleLabel: { color: colors.text, fontSize: 14, fontWeight: "900" },
  moduleHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  open: { color: colors.faint, fontSize: 25, fontWeight: "400" },
  pressed: { opacity: 0.7 },
  moduleGridTablet: { flexDirection: "row", flexWrap: "wrap", gap: 12, padding: 12, borderWidth: 0, backgroundColor: "transparent", overflow: "visible" },
  moduleRowTablet: { flexBasis: "48%", flexGrow: 1, minHeight: 76, borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, backgroundColor: colors.card },
  moreCard: { marginHorizontal: 20, marginTop: 12, borderRadius: radii.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  moreCardTablet: { marginTop: 18 },
  moreToggle: { minHeight: 60, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  moreAction: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  moreChevron: { width: 19, height: 19, marginLeft: -5, alignItems: "center", justifyContent: "center" },
  moreChevronOpen: { transform: [{ rotate: "180deg" }] },
  moreItems: { borderTopWidth: 1, borderTopColor: colors.border },
  moreItem: { minHeight: 60, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12 },
})
