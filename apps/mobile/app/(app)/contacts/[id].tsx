import { useEffect, useState } from "react"
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { readFieldCache, writeFieldCache } from "../../../src/db/local-store"
import type { FieldContactDetailData } from "../../../src/field/contracts"
import { t, useLocale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"

function messengerUrl(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`
}

export default function ContactDetailScreen() {
  useLocale()
  const { id } = useLocalSearchParams<{ id: string }>()
  const key = `field.contact.${id}`
  const cached = readFieldCache<FieldContactDetailData>(key)
  const [data, setData] = useState<FieldContactDetailData | null>(cached?.value ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    void fieldApi.contact(id).then((next) => {
      setData(next)
      writeFieldCache(key, next)
      setError(null)
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [id, key])

  const contact = data?.contact
  const details: Array<[string, string | null]> = contact ? [
    [t("specialty"), contact.specialtyName],
    [t("qualificationLabel"), contact.qualificationCategory],
    [t("profileLabel"), contact.profile],
    [t("categoryLabel"), contact.category],
    [t("statusLabel"), contact.status],
  ] : []

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("contactsTitle").toUpperCase()}</Text>
            <Text style={styles.title} numberOfLines={2}>{contact?.displayName ?? "—"}</Text>
          </View>
        </View>

        {error ? <View style={styles.notice}><Text style={styles.noticeText}>{data ? t("fieldDataStale") : t("fieldDataError")}</Text></View> : null}
        {contact ? (
          <>
            <View style={[styles.card, styles.summaryCard]}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{contact.displayName.charAt(0).toUpperCase()}</Text></View>
              <View style={styles.summaryBody}>
                <Text style={styles.summaryName}>{contact.displayName}</Text>
                <Text style={styles.summaryMeta}>{contact.type}{contact.specialtyName ? ` · ${contact.specialtyName}` : ""}</Text>
              </View>
              <View style={styles.category}><Text style={styles.categoryText}>{contact.category}</Text></View>
            </View>

            <View style={styles.card}>
              {details.map(([label, value]) => value ? (
                <View key={label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{label}</Text>
                  <Text style={styles.detailValue}>{value}</Text>
                </View>
              ) : null)}
              <View style={styles.actions}>
                {contact.phone ? (
                  <Pressable onPress={() => void Linking.openURL(`tel:${contact.phone}`)} style={[styles.action, styles.callAction]}>
                    <Text style={styles.callText}>☎ {contact.phone}</Text>
                  </Pressable>
                ) : null}
                {contact.email ? (
                  <Pressable onPress={() => void Linking.openURL(`mailto:${contact.email}`)} style={[styles.action, styles.mailAction]}>
                    <Text style={styles.mailText}>✉ {contact.email}</Text>
                  </Pressable>
                ) : null}
                {contact.messengerPhone ? (
                  <Pressable onPress={() => void Linking.openURL(messengerUrl(contact.messengerPhone!))} style={[styles.action, styles.messageAction]}>
                    <Text style={styles.messageText}>◉ {t("messengerLabel")} · {contact.messengerPhone}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <SectionHeader title={t("workplacesLabel")} count={contact.workplaces?.length ?? 0} />
            {contact.workplaces?.length ? contact.workplaces.map((workplace) => (
              <Pressable key={workplace.id} onPress={() => router.push(`/(app)/organizations/${workplace.customer.id}` as never)} style={({ pressed }) => [styles.workplaceCard, pressed && styles.pressed]}>
                <View style={styles.workplaceBody}>
                  <Text style={styles.workplaceName}>{workplace.customer.name}</Text>
                  <Text style={styles.workplaceMeta}>{[workplace.position, workplace.department].filter(Boolean).join(" · ") || workplace.customer.objectType}</Text>
                  {workplace.customer.address || workplace.customer.city ? <Text style={styles.workplaceAddress}>{[workplace.customer.city, workplace.customer.address].filter(Boolean).join(" · ")}</Text> : null}
                </View>
                {workplace.isPrimary ? <View style={styles.primaryPill}><Text style={styles.primaryText}>{t("primaryWorkplace")}</Text></View> : null}
                <Text style={styles.arrow}>›</Text>
              </Pressable>
            )) : <View style={styles.card}><Text style={styles.emptyText}>—</Text></View>}

            <SectionHeader title={t("assignmentsLabel")} count={contact.agentAssignments?.length ?? 0} />
            <View style={styles.card}>
              {contact.agentAssignments?.length ? contact.agentAssignments.map((assignment, index) => (
                <View key={`${assignment.agent.id}-${index}`} style={styles.assignmentRow}>
                  <Text style={styles.assignmentName}>{assignment.agent.name}</Text>
                  <Text style={styles.assignmentRole}>{assignment.role}</Text>
                </View>
              )) : <Text style={styles.emptyText}>—</Text>}
            </View>

            <SectionHeader title={t("potentialLabel")} count={contact.fieldPotentials?.length ?? 0} />
            <View style={styles.card}>
              {contact.fieldPotentials?.length ? contact.fieldPotentials.map((potential) => (
                <View key={potential.id} style={styles.potentialRow}>
                  <View style={styles.potentialBody}>
                    <Text style={styles.potentialName}>{potential.productExternalId ?? potential.brandExternalId ?? t("potentialLabel")}</Text>
                    <Text style={styles.potentialMeta}>{[potential.category, potential.periodStart?.slice(0, 10)].filter(Boolean).join(" · ")}</Text>
                  </View>
                  <View style={styles.potentialValue}><Text style={styles.potentialValueText}>{String(potential.coverageValue)} / {String(potential.potentialValue)}</Text></View>
                </View>
              )) : <Text style={styles.emptyText}>—</Text>}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionCount}>{count}</Text></View>
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { minHeight: "100%", paddingBottom: 30 },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  backText: { color: colors.text, fontSize: 30, lineHeight: 31 }, headerBody: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 }, title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  notice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.warningBg }, noticeText: { color: colors.warning, fontSize: 11, fontWeight: "800" },
  card: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, ...cardShadow },
  summaryCard: { flexDirection: "row", alignItems: "center", gap: 12 }, avatar: { width: 50, height: 50, borderRadius: 16, backgroundColor: colors.holidayBg, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.holiday, fontSize: 20, fontWeight: "900" }, summaryBody: { flex: 1 }, summaryName: { color: colors.text, fontSize: 17, fontWeight: "900" }, summaryMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  category: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, categoryText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  detailRow: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border }, detailLabel: { color: colors.faint, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 }, detailValue: { color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 3 },
  actions: { gap: 8, marginTop: 12 }, action: { minHeight: 43, borderRadius: radii.inner, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 }, callAction: { backgroundColor: colors.successBg }, mailAction: { backgroundColor: colors.infoBg }, messageAction: { backgroundColor: colors.primarySoft },
  callText: { color: colors.successDark, fontSize: 12, fontWeight: "900" }, mailText: { color: colors.info, fontSize: 12, fontWeight: "900" }, messageText: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  sectionHeader: { marginHorizontal: 16, marginTop: 20, marginBottom: 2, flexDirection: "row", alignItems: "center", gap: 7 }, sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900" }, sectionCount: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.primarySoft, color: colors.primary, fontSize: 10, fontWeight: "900", lineHeight: 22, textAlign: "center" },
  workplaceCard: { marginHorizontal: 14, marginTop: 9, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: colors.border }, workplaceBody: { flex: 1, minWidth: 0 }, workplaceName: { color: colors.text, fontSize: 13, fontWeight: "900" }, workplaceMeta: { color: colors.primary, fontSize: 10, fontWeight: "700", marginTop: 3 }, workplaceAddress: { color: colors.muted, fontSize: 10, marginTop: 4 },
  primaryPill: { maxWidth: 78, paddingHorizontal: 7, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.successBg }, primaryText: { color: colors.successDark, fontSize: 8, fontWeight: "900", textAlign: "center" }, arrow: { color: colors.faint, fontSize: 24 },
  assignmentRow: { minHeight: 39, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.border }, assignmentName: { color: colors.text, fontSize: 12, fontWeight: "800" }, assignmentRole: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  potentialRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border }, potentialBody: { flex: 1 }, potentialName: { color: colors.text, fontSize: 12, fontWeight: "900" }, potentialMeta: { color: colors.muted, fontSize: 9, marginTop: 2 }, potentialValue: { borderRadius: radii.pill, backgroundColor: colors.infoBg, paddingHorizontal: 9, paddingVertical: 6 }, potentialValueText: { color: colors.info, fontSize: 10, fontWeight: "900" },
  emptyText: { color: colors.muted, fontSize: 12, textAlign: "center", paddingVertical: 9 }, pressed: { opacity: 0.7 },
})
