import { useEffect, useState } from "react"
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { readFieldCache, writeFieldCache } from "../../../src/db/local-store"
import type { FieldOrganizationDetailData } from "../../../src/field/contracts"
import { t, useLocale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"

export default function OrganizationDetailScreen() {
  useLocale()
  const { id } = useLocalSearchParams<{ id: string }>()
  const key = `field.organization.${id}`
  const cached = readFieldCache<FieldOrganizationDetailData>(key)
  const [data, setData] = useState<FieldOrganizationDetailData | null>(cached?.value ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    void fieldApi.organization(id).then((next) => {
      setData(next)
      writeFieldCache(key, next)
      setError(null)
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [id, key])

  const organization = data?.organization
  const details: Array<[string, string | null]> = organization ? [
    [t("codeLabel"), organization.code],
    [t("addressLabel"), [organization.city, organization.district, organization.address].filter(Boolean).join(" · ") || null],
    [t("phoneLabel"), organization.phone],
    [t("contactPersonLabel"), organization.contactPerson],
  ] : []
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
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
                <Text style={styles.summaryMeta}>{organization.objectType} · {organization.status}</Text>
              </View>
              <View style={styles.category}><Text style={styles.categoryText}>{organization.category}</Text></View>
            </View>

            <View style={styles.card}>
              {details.map(([label, value]) => value ? (
                <View key={label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{label}</Text>
                  <Text style={styles.detailValue}>{value}</Text>
                </View>
              ) : null)}
              {organization.phone ? (
                <Pressable onPress={() => void Linking.openURL(`tel:${organization.phone}`)} style={styles.callButton}>
                  <Text style={styles.callText}>☎ {organization.phone}</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t("contactsLabel")}</Text>
              <Text style={styles.sectionCount}>{organization.contactWorkplaces?.length ?? 0}</Text>
            </View>
            {organization.contactWorkplaces?.length ? organization.contactWorkplaces.map((workplace) => (
              <Pressable key={workplace.id} onPress={() => router.push(`/(app)/contacts/${workplace.contact.id}` as never)} style={({ pressed }) => [styles.personCard, pressed && styles.pressed]}>
                <View style={styles.personAvatar}><Text style={styles.personInitial}>{workplace.contact.displayName.charAt(0).toUpperCase()}</Text></View>
                <View style={styles.personBody}>
                  <Text style={styles.personName}>{workplace.contact.displayName}</Text>
                  <Text style={styles.personMeta}>{workplace.contact.specialtyName ?? workplace.contact.type}</Text>
                </View>
                {workplace.isPrimary ? <View style={styles.primaryPill}><Text style={styles.primaryPillText}>{t("primaryWorkplace")}</Text></View> : null}
              </Pressable>
            )) : <View style={styles.card}><Text style={styles.emptyText}>{t("contactsEmpty")}</Text></View>}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t("assignmentsLabel")}</Text>
              <Text style={styles.sectionCount}>{organization.agentAssignments?.length ?? 0}</Text>
            </View>
            <View style={styles.card}>
              {organization.agentAssignments?.length ? organization.agentAssignments.map((assignment, index) => (
                <View key={`${assignment.agent.id}-${index}`} style={styles.assignmentRow}>
                  <Text style={styles.assignmentName}>{assignment.agent.name}</Text>
                  <Text style={styles.assignmentRole}>{assignment.role}</Text>
                </View>
              )) : <Text style={styles.emptyText}>—</Text>}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { minHeight: "100%", paddingBottom: 30 },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  backText: { color: colors.text, fontSize: 30, lineHeight: 31 }, headerBody: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  notice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.warningBg },
  noticeText: { color: colors.warning, fontSize: 11, fontWeight: "800" },
  card: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, ...cardShadow },
  summaryCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  mark: { width: 50, height: 50, borderRadius: 16, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" },
  markText: { color: colors.info, fontSize: 20, fontWeight: "900" }, summaryBody: { flex: 1 },
  summaryName: { color: colors.text, fontSize: 17, fontWeight: "900" }, summaryMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  category: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  categoryText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  detailRow: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailLabel: { color: colors.faint, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  detailValue: { color: colors.text, fontSize: 13, fontWeight: "700", lineHeight: 18, marginTop: 3 },
  callButton: { marginTop: 12, minHeight: 44, borderRadius: radii.inner, backgroundColor: colors.successBg, alignItems: "center", justifyContent: "center" },
  callText: { color: colors.successDark, fontSize: 13, fontWeight: "900" },
  sectionHeader: { marginHorizontal: 16, marginTop: 20, marginBottom: 2, flexDirection: "row", alignItems: "center", gap: 7 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  sectionCount: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.primarySoft, color: colors.primary, fontSize: 10, fontWeight: "900", lineHeight: 22, textAlign: "center" },
  personCard: { marginHorizontal: 14, marginTop: 9, borderRadius: radii.card, padding: 12, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.border },
  personAvatar: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.holidayBg, alignItems: "center", justifyContent: "center" },
  personInitial: { color: colors.holiday, fontSize: 15, fontWeight: "900" }, personBody: { flex: 1 },
  personName: { color: colors.text, fontSize: 13, fontWeight: "900" }, personMeta: { color: colors.muted, fontSize: 10, marginTop: 2 },
  primaryPill: { maxWidth: 82, paddingHorizontal: 7, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.successBg },
  primaryPillText: { color: colors.successDark, fontSize: 8, fontWeight: "900", textAlign: "center" },
  assignmentRow: { minHeight: 39, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.border },
  assignmentName: { color: colors.text, fontSize: 12, fontWeight: "800" }, assignmentRole: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  emptyText: { color: colors.muted, fontSize: 12, textAlign: "center", paddingVertical: 9 }, pressed: { opacity: 0.7 },
})
