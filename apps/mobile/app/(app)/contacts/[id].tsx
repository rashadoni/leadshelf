import { useCallback, useState } from "react"
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { readFieldCache, writeFieldCache } from "../../../src/db/local-store"
import type { FieldContactChangeRequest, FieldContactDetailData } from "../../../src/field/contracts"
import { fieldErrorMessage } from "../../../src/field/error-message"
import { t, useLocale } from "../../../src/i18n"
import { formatCalendarDay, formatShortDateTime } from "../../../src/i18n/date-format"
import { colors, cardShadow, radii } from "../../../src/theme"
import { approvalStatusLabel, assignmentRoleLabel, contactTypeLabel, lifecycleStatusLabel, objectTypeLabel } from "../../../src/field/labels"
import { TabIcon } from "../../../src/components/TabIcon"
import { safeFieldBack } from "../../../src/navigation/safe-back"

function phoneDigits(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, "") ?? ""
  return digits.length >= 7 && digits.length <= 15 ? digits : null
}

function phoneUrl(phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone)
  return digits ? `tel:${digits}` : null
}

function emailUrl(email: string | null | undefined): string | null {
  const normalized = email?.trim() ?? ""
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? `mailto:${normalized}` : null
}

function messengerUrl(phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone)
  return digits ? `https://wa.me/${digits}` : null
}

async function openExternalUrl(url: string, unavailableMessage: string) {
  try {
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url)
      return
    }
  } catch {
    // A device can reject a valid external URL when the matching app is unavailable.
  }
  Alert.alert(unavailableMessage)
}

export default function ContactDetailScreen() {
  const locale = useLocale()
  const { id } = useLocalSearchParams<{ id: string }>()
  const key = `field.contact.${id}`
  const cached = readFieldCache<FieldContactDetailData>(key)
  const [data, setData] = useState<FieldContactDetailData | null>(cached?.value ?? null)
  const [changeRequests, setChangeRequests] = useState<FieldContactChangeRequest[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!id) return
    void fieldApi.contact(id).then((next) => {
      setData(next)
      writeFieldCache(key, next)
      setError(null)
    }).catch((reason) => setError(fieldErrorMessage(reason, "fieldDataError")))
    void fieldApi.contactChangeRequests(id)
      .then((next) => setChangeRequests(next.requests))
      // History is a convenience view only; keep the reachable contact usable
      // if a legacy deployment has not exposed this optional endpoint yet.
      .catch(() => setChangeRequests([]))
  }, [id, key])

  useFocusEffect(useCallback(() => {
    load()
  }, [load]))

  const contact = data?.contact
  const contactPhoneUrl = phoneUrl(contact?.phone)
  const contactEmailUrl = emailUrl(contact?.email)
  const contactMessengerUrl = messengerUrl(contact?.messengerPhone)
  const details: Array<[string, string | null]> = contact ? [
    [t("specialty"), contact.specialtyName],
    [t("qualificationLabel"), contact.qualificationCategory],
    [t("profileLabel"), contact.profile],
    [t("categoryLabel"), contact.category],
    [t("statusLabel"), lifecycleStatusLabel(contact.status)],
  ] : []

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => safeFieldBack("/(app)/contacts")} style={styles.back}>
            <TabIcon name="chevronLeft" color={colors.text} size={22} />
          </Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("contactsTitle").toUpperCase()}</Text>
            <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>{contact?.displayName ?? "—"}</Text>
          </View>
        </View>

        {error ? <View style={styles.notice}><Text style={styles.noticeText}>{data ? t("fieldDataStale") : t("fieldDataError")}</Text></View> : null}
        {contact ? (
          <>
            <View style={[styles.card, styles.summaryCard]}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{contact.displayName.charAt(0).toUpperCase()}</Text></View>
              <View style={styles.summaryBody}>
                <Text style={styles.summaryName}>{contact.displayName}</Text>
                <Text style={styles.summaryMeta}>{contactTypeLabel(contact.type)}{contact.specialtyName ? ` · ${contact.specialtyName}` : ""}</Text>
              </View>
              <View style={styles.category}><Text style={styles.categoryText} numberOfLines={1}>{contact.category}</Text></View>
            </View>

            <View style={styles.card}>
              {details.map(([label, value]) => value ? (
                <View key={label} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{label}</Text>
                  <Text style={styles.detailValue}>{value}</Text>
                </View>
              ) : null)}
              <View style={styles.actions}>
                {contactPhoneUrl ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t("phoneLabel")}: ${contact.phone}`}
                    onPress={() => void openExternalUrl(contactPhoneUrl, t("externalCallUnavailable"))}
                    style={({ pressed }) => [styles.action, styles.callAction, pressed && styles.pressed]}
                  >
                    <View style={styles.actionBody}>
                      <Text style={[styles.actionLabel, styles.callText]}>{t("phoneLabel")}</Text>
                      <Text style={[styles.actionValue, styles.callText]} numberOfLines={1}>{contact.phone}</Text>
                    </View>
                    <View accessible={false} style={styles.actionChevron}><TabIcon name="chevronRight" color={colors.successDark} size={20} /></View>
                  </Pressable>
                ) : null}
                {contactEmailUrl ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t("email")}: ${contact.email}`}
                    onPress={() => void openExternalUrl(contactEmailUrl, t("externalEmailUnavailable"))}
                    style={({ pressed }) => [styles.action, styles.mailAction, pressed && styles.pressed]}
                  >
                    <View style={styles.actionBody}>
                      <Text style={[styles.actionLabel, styles.mailText]}>{t("email")}</Text>
                      <Text style={[styles.actionValue, styles.mailText]} numberOfLines={1}>{contact.email}</Text>
                    </View>
                    <View accessible={false} style={styles.actionChevron}><TabIcon name="chevronRight" color={colors.info} size={20} /></View>
                  </Pressable>
                ) : null}
                {contactMessengerUrl ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t("messengerLabel")}: ${contact.messengerPhone}`}
                    onPress={() => void openExternalUrl(contactMessengerUrl, t("externalMessengerUnavailable"))}
                    style={({ pressed }) => [styles.action, styles.messageAction, pressed && styles.pressed]}
                  >
                    <View style={styles.actionBody}>
                      <Text style={[styles.actionLabel, styles.messageText]}>{t("messengerLabel")}</Text>
                      <Text style={[styles.actionValue, styles.messageText]} numberOfLines={1}>{contact.messengerPhone}</Text>
                    </View>
                    <View accessible={false} style={styles.actionChevron}><TabIcon name="chevronRight" color={colors.primary} size={20} /></View>
                  </Pressable>
                ) : null}
                {data?.capabilities.canRequestChanges ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("contactCorrectionMakeSuggestion")}
                    onPress={() => router.push(`/(app)/contacts/${contact.id}/suggest-correction` as never)}
                    style={({ pressed }) => [styles.action, styles.correctionAction, pressed && styles.pressed]}
                  >
                    <View accessible={false} style={styles.correctionIcon}><TabIcon name="document" color={colors.headerText} size={20} /></View>
                    <Text style={styles.correctionText} numberOfLines={1}>{t("contactCorrectionMakeSuggestion")}</Text>
                    <View accessible={false} style={styles.actionChevron}><TabIcon name="chevronRight" color={colors.headerText} size={20} /></View>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <SectionHeader title={t("workplacesLabel")} count={contact.workplaces?.length ?? 0} />
            {contact.workplaces?.length ? contact.workplaces.map((workplace) => (
              <Pressable
                key={workplace.id}
                accessibilityRole="button"
                accessibilityLabel={`${t("workplacesLabel")}: ${workplace.customer.name}`}
                onPress={() => router.push(`/(app)/organizations/${workplace.customer.id}` as never)}
                style={({ pressed }) => [styles.workplaceCard, pressed && styles.pressed]}
              >
                <View style={styles.workplaceBody}>
                  <Text style={styles.workplaceName} numberOfLines={2}>{workplace.customer.name}</Text>
                  <Text style={styles.workplaceMeta} numberOfLines={1}>{[workplace.position, workplace.department].filter(Boolean).join(" · ") || objectTypeLabel(workplace.customer.objectType)}</Text>
                  {workplace.customer.address || workplace.customer.city ? <Text style={styles.workplaceAddress} numberOfLines={2}>{[workplace.customer.city, workplace.customer.address].filter(Boolean).join(" · ")}</Text> : null}
                </View>
                {workplace.isPrimary ? <View style={styles.primaryPill}><Text style={styles.primaryText} numberOfLines={2}>{t("primaryWorkplace")}</Text></View> : null}
                <View accessible={false} style={styles.arrow}><TabIcon name="chevronRight" color={colors.faint} size={20} /></View>
              </Pressable>
            )) : <View style={styles.card}><Text style={styles.emptyText}>—</Text></View>}

            <SectionHeader title={t("assignmentsLabel")} count={contact.agentAssignments?.length ?? 0} />
            <View style={styles.card}>
              {contact.agentAssignments?.length ? contact.agentAssignments.map((assignment, index) => (
                <View key={`${assignment.agent.id}-${index}`} style={styles.assignmentRow}>
                  <Text style={styles.assignmentName} numberOfLines={1}>{assignment.agent.name}</Text>
                  <Text style={styles.assignmentRole} numberOfLines={1}>{assignmentRoleLabel(assignment.role)}</Text>
                </View>
              )) : <Text style={styles.emptyText}>—</Text>}
            </View>

            <SectionHeader title={t("potentialLabel")} count={contact.fieldPotentials?.length ?? 0} />
            <View style={styles.card}>
              {contact.fieldPotentials?.length ? contact.fieldPotentials.map((potential) => (
                <View key={potential.id} style={styles.potentialRow}>
                  <View style={styles.potentialBody}>
                    <Text style={styles.potentialName} numberOfLines={1}>{potential.productExternalId ?? potential.brandExternalId ?? t("potentialLabel")}</Text>
                    <Text style={styles.potentialMeta} numberOfLines={1}>{[
                      potential.category,
                      potential.periodStart ? formatCalendarDay(potential.periodStart.slice(0, 10), locale).date || potential.periodStart.slice(0, 10) : null,
                    ].filter(Boolean).join(" · ")}</Text>
                  </View>
                  <View style={styles.potentialValue}><Text style={styles.potentialValueText} numberOfLines={1}>{String(potential.coverageValue)} / {String(potential.potentialValue)}</Text></View>
                </View>
              )) : <Text style={styles.emptyText}>—</Text>}
            </View>

            {data?.capabilities.canRequestChanges ? (
              <>
                <SectionHeader title={t("contactCorrectionHistory")} count={changeRequests.length} />
                <View style={styles.card}>
                  {changeRequests.length ? changeRequests.slice(0, 3).map((request) => (
                    <Pressable
                      key={request.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${t("contactCorrectionHistory")}: ${approvalStatusLabel(request.status)}. ${request.reason}`}
                      onPress={() => router.push(`/(app)/contacts/${contact.id}/suggest-correction` as never)}
                      style={({ pressed }) => [styles.changeRequestRow, pressed && styles.pressed]}
                    >
                      <View style={styles.changeRequestBody}>
                        <Text style={styles.changeRequestStatus}>{approvalStatusLabel(request.status)}</Text>
                        <Text style={styles.changeRequestReason} numberOfLines={2}>{request.reason}</Text>
                      </View>
                      <Text style={styles.changeRequestDate}>{formatShortDateTime(request.submittedAt, locale)}</Text>
                    </Pressable>
                  )) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("contactCorrectionMakeSuggestion")}
                      onPress={() => router.push(`/(app)/contacts/${contact.id}/suggest-correction` as never)}
                      style={({ pressed }) => [styles.changeRequestEmpty, pressed && styles.pressed]}
                    >
                      <Text style={styles.changeRequestEmptyText}>{t("contactCorrectionHistoryEmpty")}</Text>
                      <View accessible={false}><TabIcon name="chevronRight" color={colors.primary} size={20} /></View>
                    </Pressable>
                  )}
                </View>
              </>
            ) : null}
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
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 }, title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  notice: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 10, backgroundColor: colors.warningBg }, noticeText: { color: colors.warning, fontSize: 11, fontWeight: "800" },
  card: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, ...cardShadow },
  summaryCard: { flexDirection: "row", alignItems: "center", gap: 12 }, avatar: { width: 50, height: 50, borderRadius: 16, backgroundColor: colors.holidayBg, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.holiday, fontSize: 20, fontWeight: "900" }, summaryBody: { flex: 1 }, summaryName: { color: colors.text, fontSize: 17, fontWeight: "900" }, summaryMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  category: { minWidth: 34, maxWidth: 76, height: 34, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 }, categoryText: { color: colors.primary, fontSize: 13, fontWeight: "900" },
  detailRow: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border }, detailLabel: { color: colors.faint, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 }, detailValue: { color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 3 },
  actions: { gap: 8, marginTop: 12 }, action: { minHeight: 48, borderRadius: radii.inner, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 }, actionBody: { flex: 1, minWidth: 0 }, actionLabel: { fontSize: 9, fontWeight: "900", letterSpacing: 0.45, textTransform: "uppercase" }, actionValue: { fontSize: 12, fontWeight: "900", marginTop: 2 }, actionChevron: { flexShrink: 0 }, callAction: { backgroundColor: colors.successBg }, mailAction: { backgroundColor: colors.infoBg }, messageAction: { backgroundColor: colors.primarySoft },
  correctionAction: { backgroundColor: colors.primary }, correctionIcon: { flexShrink: 0 }, callText: { color: colors.successDark }, mailText: { color: colors.info }, messageText: { color: colors.primary }, correctionText: { color: colors.headerText, fontSize: 12, fontWeight: "900", flex: 1, minWidth: 0 },
  sectionHeader: { marginHorizontal: 16, marginTop: 20, marginBottom: 2, flexDirection: "row", alignItems: "center", gap: 7 }, sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900" }, sectionCount: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.primarySoft, color: colors.primary, fontSize: 10, fontWeight: "900", lineHeight: 22, textAlign: "center" },
  workplaceCard: { minHeight: 62, marginHorizontal: 14, marginTop: 9, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: colors.border }, workplaceBody: { flex: 1, minWidth: 0 }, workplaceName: { color: colors.text, fontSize: 13, fontWeight: "900" }, workplaceMeta: { color: colors.primary, fontSize: 10, fontWeight: "700", marginTop: 3 }, workplaceAddress: { color: colors.muted, fontSize: 10, marginTop: 4 },
  primaryPill: { flexShrink: 1, maxWidth: 108, paddingHorizontal: 7, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.successBg }, primaryText: { color: colors.successDark, fontSize: 8, fontWeight: "900", textAlign: "center" }, arrow: { flexShrink: 0 },
  assignmentRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border }, assignmentName: { flex: 1, minWidth: 0, color: colors.text, fontSize: 12, fontWeight: "800" }, assignmentRole: { flexShrink: 1, color: colors.primary, fontSize: 10, fontWeight: "900", textAlign: "right" },
  potentialRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border }, potentialBody: { flex: 1, minWidth: 0 }, potentialName: { color: colors.text, fontSize: 12, fontWeight: "900" }, potentialMeta: { color: colors.muted, fontSize: 9, marginTop: 2 }, potentialValue: { flexShrink: 1, borderRadius: radii.pill, backgroundColor: colors.infoBg, paddingHorizontal: 9, paddingVertical: 6 }, potentialValueText: { color: colors.info, fontSize: 10, fontWeight: "900" },
  changeRequestRow: { minHeight: 54, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border }, changeRequestBody: { flex: 1, minWidth: 0 }, changeRequestStatus: { color: colors.primary, fontSize: 10, fontWeight: "900" }, changeRequestReason: { color: colors.text, fontSize: 11, lineHeight: 16, marginTop: 3 }, changeRequestDate: { flexShrink: 0, color: colors.faint, fontSize: 9, fontWeight: "700" }, changeRequestEmpty: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }, changeRequestEmptyText: { flex: 1, minWidth: 0, color: colors.primary, fontSize: 11, fontWeight: "800" },
  emptyText: { color: colors.muted, fontSize: 12, textAlign: "center", paddingVertical: 9 }, pressed: { opacity: 0.7 },
})
