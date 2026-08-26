import { type ReactNode, useEffect, useState } from "react"
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { readFieldCache, writeFieldCache } from "../../../src/db/local-store"
import type { FieldOrganizationDetailData } from "../../../src/field/contracts"
import { fieldErrorMessage } from "../../../src/field/error-message"
import { t, useLocale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"
import { assignmentRoleLabel, contactTypeLabel, lifecycleStatusLabel, objectTypeLabel } from "../../../src/field/labels"
import { FieldScreenChrome } from "../../../src/components/FieldScreenChrome"
import { TabIcon, type TabIconName } from "../../../src/components/TabIcon"
import { safeFieldBack } from "../../../src/navigation/safe-back"

function phoneUrl(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, "") ?? ""
  return digits.length >= 7 && digits.length <= 15 ? `tel:${digits}` : null
}

async function openExternalUrl(url: string, unavailableMessage: string) {
  try {
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url)
      return
    }
  } catch {
    // A device can reject an otherwise valid phone link when no dialler is available.
  }
  Alert.alert(unavailableMessage)
}

export default function OrganizationDetailScreen() {
  useLocale()
  const { id } = useLocalSearchParams<{ id: string }>()
  const key = `field.organization.${id}`
  const cached = readFieldCache<FieldOrganizationDetailData>(key)
  const [data, setData] = useState<FieldOrganizationDetailData | null>(cached?.value ?? null)
  const [error, setError] = useState<string | null>(null)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ information: true, contacts: true })

  useEffect(() => {
    if (!id) return
    void fieldApi.organization(id).then((next) => {
      setData(next)
      writeFieldCache(key, next)
      setError(null)
    }).catch((reason) => setError(fieldErrorMessage(reason, "fieldDataError")))
  }, [id, key])

  const organization = data?.organization
  const organizationPhoneUrl = phoneUrl(organization?.phone)
  const details: Array<[string, string | null]> = organization ? [
    [t("codeLabel"), organization.code],
    [t("addressLabel"), [organization.city, organization.district, organization.address].filter(Boolean).join(" · ") || null],
    [t("phoneLabel"), organization.phone],
    [t("contactPersonLabel"), organization.contactPerson],
  ] : []
  const toggleSection = (section: string) => setOpenSections((current) => ({ ...current, [section]: !current[section] }))
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <FieldScreenChrome />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => safeFieldBack("/(app)/organizations")} style={styles.back}>
            <TabIcon name="chevronLeft" color={colors.text} size={23} />
          </Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("organizationsTitle").toUpperCase()}</Text>
            <Text style={styles.title} numberOfLines={2}>{organization?.name ?? "—"}</Text>
          </View>
        </View>

        {error ? <View style={styles.notice}><Text style={styles.noticeText}>{data ? t("fieldDataStale") : t("fieldDataError")}</Text></View> : null}
        {organization ? (
          <>
            <View style={[styles.card, styles.summaryCard]}>
              <View style={styles.mark}><Text style={styles.markText}>{organization.name.charAt(0).toUpperCase()}</Text></View>
              <View style={styles.summaryBody}>
                <Text style={styles.summaryName}>{organization.name}</Text>
                <Text style={styles.summaryMeta}>{objectTypeLabel(organization.objectType)} · {lifecycleStatusLabel(organization.status)}</Text>
              </View>
              <View style={styles.category}><Text style={styles.categoryText}>{organization.category}</Text></View>
            </View>

            <DetailDisclosure
              title={t("organizationDetailInformation")}
              icon="organizations"
              open={Boolean(openSections.information)}
              onPress={() => toggleSection("information")}
            >
              {details.map(([label, value]) => value ? (
                <View key={label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{label}</Text>
                  <Text style={styles.detailValue}>{value}</Text>
                </View>
              ) : null)}
              {organizationPhoneUrl ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t("phoneLabel")}: ${organization?.phone}`}
                  onPress={() => void openExternalUrl(organizationPhoneUrl, t("externalCallUnavailable"))}
                  style={styles.callButton}
                >
                  <Text style={styles.callText}>☎ {organization.phone}</Text>
                </Pressable>
              ) : null}
              {!details.length && !organizationPhoneUrl ? <Text style={styles.emptyText}>—</Text> : null}
            </DetailDisclosure>

            <DetailDisclosure
              title={t("contactsLabel")}
              icon="contacts"
              count={organization.contactWorkplaces?.length ?? 0}
              open={Boolean(openSections.contacts)}
              onPress={() => toggleSection("contacts")}
            >
              {organization.contactWorkplaces?.length ? organization.contactWorkplaces.map((workplace) => (
                <Pressable
                  key={workplace.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${t("contactsTitle")}: ${workplace.contact.displayName}${workplace.isPrimary ? ` · ${t("primaryWorkplace")}` : ""}`}
                  onPress={() => router.push(`/(app)/contacts/${workplace.contact.id}` as never)}
                  style={({ pressed }) => [styles.personCard, pressed && styles.pressed]}
                >
                  <View style={styles.personAvatar}><Text style={styles.personInitial}>{workplace.contact.displayName.charAt(0).toUpperCase()}</Text></View>
                  <View style={styles.personBody}>
                    <Text style={styles.personName}>{workplace.contact.displayName}</Text>
                    <Text style={styles.personMeta}>{workplace.contact.specialtyName ?? contactTypeLabel(workplace.contact.type)}</Text>
                  </View>
                  {workplace.isPrimary ? <View style={styles.primaryPill}><Text style={styles.primaryPillText}>{t("primaryWorkplace")}</Text></View> : null}
                  <View accessible={false} style={styles.personChevron}><TabIcon name="chevronRight" color={colors.faint} size={20} /></View>
                </Pressable>
              )) : <Text style={styles.emptyText}>{t("contactsEmpty")}</Text>}
            </DetailDisclosure>

            <DetailDisclosure
              title={t("assignmentsLabel")}
              icon="profile"
              count={organization.agentAssignments?.length ?? 0}
              open={Boolean(openSections.assignments)}
              onPress={() => toggleSection("assignments")}
            >
              {organization.agentAssignments?.length ? organization.agentAssignments.map((assignment, index) => (
                <View key={`${assignment.agent.id}-${index}`} style={styles.assignmentRow}>
                  <Text style={styles.assignmentName}>{assignment.agent.name}</Text>
                  <Text style={styles.assignmentRole}>{assignmentRoleLabel(assignment.role)}</Text>
                </View>
              )) : <Text style={styles.emptyText}>—</Text>}
            </DetailDisclosure>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function DetailDisclosure({
  title,
  icon,
  count,
  open,
  onPress,
  children,
}: {
  title: string
  icon: TabIconName
  count?: number
  open: boolean
  onPress: () => void
  children: ReactNode
}) {
  return (
    <View style={styles.disclosure}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={onPress}
        style={({ pressed }) => [styles.disclosureToggle, pressed && styles.pressed]}
      >
        <View accessible={false} style={styles.disclosureIcon}><TabIcon name={icon} color={colors.primary} size={18} /></View>
        <Text style={styles.disclosureTitle} numberOfLines={1}>{title}</Text>
        {count !== undefined ? <View accessible={false} style={styles.disclosureCount}><Text style={styles.disclosureCountText}>{count}</Text></View> : null}
        <View accessible={false} style={styles.disclosureChevron}><TabIcon name={open ? "chevronUp" : "chevronDown"} color={colors.primary} size={20} /></View>
      </Pressable>
      {open ? <View style={styles.disclosureContent}>{children}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { minHeight: "100%", paddingBottom: 30 },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  headerBody: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  notice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.warningBg },
  noticeText: { color: colors.warning, fontSize: 11, fontWeight: "800" },
  card: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, ...cardShadow },
  summaryCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  mark: { width: 50, height: 50, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  markText: { color: colors.primary, fontSize: 20, fontWeight: "900" }, summaryBody: { flex: 1 },
  summaryName: { color: colors.text, fontSize: 17, fontWeight: "900" }, summaryMeta: { color: colors.muted, fontSize: 12, marginTop: 3 },
  category: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  categoryText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  disclosure: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.card, backgroundColor: colors.card, overflow: "hidden", ...cardShadow },
  disclosureToggle: { minHeight: 58, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  disclosureIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  disclosureTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, fontWeight: "900" },
  disclosureCount: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  disclosureCountText: { color: colors.primary, fontSize: 11, fontWeight: "900" }, disclosureChevron: { flexShrink: 0 },
  disclosureContent: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 12, paddingBottom: 12 },
  detailRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailLabel: { color: colors.faint, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  detailValue: { color: colors.text, fontSize: 13, fontWeight: "700", lineHeight: 18, marginTop: 3 },
  callButton: { marginTop: 12, minHeight: 46, borderRadius: radii.inner, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  callText: { color: colors.headerText, fontSize: 13, fontWeight: "900" },
  personCard: { minHeight: 62, marginTop: 9, borderRadius: radii.inner, padding: 12, backgroundColor: colors.bg, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.border },
  personAvatar: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  personInitial: { color: colors.primary, fontSize: 15, fontWeight: "900" }, personBody: { flex: 1, minWidth: 0 }, personChevron: { width: 24, alignItems: "flex-end" },
  personName: { color: colors.text, fontSize: 13, fontWeight: "900" }, personMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  primaryPill: { maxWidth: 82, paddingHorizontal: 7, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.successBg },
  primaryPillText: { color: colors.successDark, fontSize: 11, fontWeight: "900", textAlign: "center" },
  assignmentRow: { minHeight: 39, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.border },
  assignmentName: { color: colors.text, fontSize: 12, fontWeight: "800" }, assignmentRole: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  emptyText: { color: colors.muted, fontSize: 12, textAlign: "center", paddingVertical: 9 }, pressed: { opacity: 0.7 },
})
