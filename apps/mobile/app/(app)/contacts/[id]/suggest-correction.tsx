import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import * as Crypto from "expo-crypto"
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"
import { fieldApi } from "../../../../src/api/mobile-client"
import type {
  FieldContactChangeRequest,
  FieldContactDetailData,
} from "../../../../src/field/contracts"
import {
  buildFieldContactUpdatePayload,
  fieldContactCorrectionChanges,
  fieldContactCorrectionDraft,
  fieldContactCorrectionIssue,
  type FieldContactCorrectionDraft,
  type FieldContactCorrectionField,
} from "../../../../src/field/contact-correction"
import { approvalStatusLabel, contactCorrectionFieldLabel } from "../../../../src/field/labels"
import { t, useLocale } from "../../../../src/i18n"
import { formatShortDateTime } from "../../../../src/i18n/date-format"
import { safeFieldBack } from "../../../../src/navigation/safe-back"
import { HttpError } from "../../../../src/sync/ports-error"
import { cardShadow, colors, radii } from "../../../../src/theme"
import { TabIcon } from "../../../../src/components/TabIcon"

type Submission = { body: string; idempotencyKey: string }

function issueCopy(issue: ReturnType<typeof fieldContactCorrectionIssue>): string | null {
  if (issue === "FIRST_NAME_REQUIRED") return t("contactCorrectionFirstNameRequired")
  if (issue === "LAST_NAME_REQUIRED") return t("contactCorrectionLastNameRequired")
  if (issue === "EMAIL_INVALID") return t("contactCorrectionEmailInvalid")
  if (issue === "NO_CHANGES") return t("contactCorrectionNoChanges")
  return null
}

function displayValue(value: string | null): string {
  return value ?? "—"
}

export default function SuggestContactCorrectionScreen() {
  const locale = useLocale()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [data, setData] = useState<FieldContactDetailData | null>(null)
  const [history, setHistory] = useState<FieldContactChangeRequest[]>([])
  const [draft, setDraft] = useState<FieldContactCorrectionDraft | null>(null)
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<FieldContactChangeRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submission = useRef<Submission | null>(null)
  const dirtyDraft = useRef(false)

  const load = useCallback(async (refresh = false) => {
    if (!id) return
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const contact = await fieldApi.contact(id)
      setData(contact)
      // A refresh updates the reference version without silently replacing
      // edits that the agent has already entered in this correction request.
      if (!dirtyDraft.current) setDraft(fieldContactCorrectionDraft(contact.contact))
      try {
        const requests = await fieldApi.contactChangeRequests(id)
        setHistory(requests.requests)
      } catch {
        // A history outage must not prevent a safe, server-validated request.
        setHistory([])
      }
    } catch {
      setError(t("fieldDataError"))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const changes = useMemo(
    () => data && draft ? fieldContactCorrectionChanges(data.contact, draft) : [],
    [data, draft],
  )
  const hasDraft = changes.length > 0 || reason.trim().length > 0 || reviewing

  useEffect(() => {
    dirtyDraft.current = hasDraft
  }, [hasDraft])

  const update = (field: FieldContactCorrectionField, value: string) => {
    dirtyDraft.current = true
    setDraft((current) => current ? { ...current, [field]: value } : current)
    setReviewing(false)
    setError(null)
  }

  const beginReview = () => {
    if (!data || !draft) return
    if (!data.capabilities.canRequestChanges) {
      setError(t("contactCorrectionDenied"))
      return
    }
    if (!data.contact.updatedAt) {
      setError(t("contactCorrectionUnavailable"))
      return
    }
    const issue = issueCopy(fieldContactCorrectionIssue(data.contact, draft))
    if (issue) {
      setError(issue)
      return
    }
    if (reason.trim().length < 3) {
      setError(t("contactCorrectionReasonRequired"))
      return
    }
    setError(null)
    setReviewing(true)
  }

  const send = async () => {
    if (!data || !draft || !id || !data.contact.updatedAt) {
      setError(t("contactCorrectionUnavailable"))
      return
    }
    const payload = buildFieldContactUpdatePayload(data.contact, draft)
    const body = JSON.stringify({
      contactId: id,
      expectedContactUpdatedAt: data.contact.updatedAt,
      kind: "CONTACT_UPDATE",
      payload,
      reason: reason.trim(),
    })
    if (!submission.current || submission.current.body !== body) {
      submission.current = {
        body,
        idempotencyKey: `contact-correction-${Crypto.randomUUID()}`,
      }
    }

    setSubmitting(true)
    setError(null)
    try {
      const request = await fieldApi.createContactChangeRequest(id, {
        idempotencyKey: submission.current.idempotencyKey,
        expectedContactUpdatedAt: data.contact.updatedAt,
        kind: "CONTACT_UPDATE",
        payload,
        reason: reason.trim(),
      })
      setSubmitted(request)
      setHistory((current) => [request, ...current.filter((item) => item.id !== request.id)])
    } catch (cause) {
      if (cause instanceof HttpError && cause.status === 409) {
        setError(t("contactCorrectionUnavailable"))
      } else if (cause instanceof HttpError && cause.status === 403) {
        setError(t("contactCorrectionDenied"))
      } else {
        setError(t("contactCorrectionFailed"))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const goBack = () => {
    if (submitting) return
    if (!hasDraft) {
      safeFieldBack(`/(app)/contacts/${id}`)
      return
    }
    Alert.alert(t("contactCorrectionDiscardTitle"), t("contactCorrectionDiscardBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("contactCorrectionDiscardConfirm"), style: "destructive", onPress: () => safeFieldBack(`/(app)/contacts/${id}`) },
    ])
  }

  if (loading && !data) {
    return <SafeAreaView style={styles.root} edges={["top"]}><View style={styles.loading}><Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => safeFieldBack(`/(app)/contacts/${id}`)} style={styles.loadingBack}><TabIcon name="chevronLeft" color={colors.text} size={22} /></Pressable><ActivityIndicator color={colors.primary} /><Text style={styles.loadingText}>{t("fieldLoadingMore")}</Text></View></SafeAreaView>
  }

  if (submitted) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={[styles.success, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}>
          <View accessible={false} style={styles.successMark}><TabIcon name="check" color={colors.success} size={32} /></View>
          <Text accessibilityRole="header" style={styles.successTitle}>{t("contactCorrectionSubmitted")}</Text>
          <Text style={styles.successHint}>{t("contactCorrectionPending")}</Text>
          <View style={styles.statusPill}><Text style={styles.statusText}>{approvalStatusLabel(submitted.status)}</Text></View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("contactCorrectionBackToContact")}
            onPress={() => router.replace(`/(app)/contacts/${id}` as never)}
            style={styles.successButton}
          >
            <Text style={styles.primaryButtonText}>{t("contactCorrectionBackToContact")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  const contact = data?.contact
  const canRequestChanges = Boolean(data?.capabilities.canRequestChanges)
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
        >
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("back")} accessibilityState={{ disabled: submitting }} disabled={submitting} hitSlop={6} onPress={goBack} style={[styles.back, submitting && styles.disabled]}>
              <TabIcon name="chevronLeft" color={colors.text} size={22} />
            </Pressable>
            <View style={styles.headerBody}>
              <Text style={styles.eyebrow}>{t("contactsTitle").toUpperCase()}</Text>
              <Text accessibilityRole="header" style={styles.title}>{t("contactCorrectionTitle")}</Text>
              {contact ? <Text style={styles.subtitle} numberOfLines={1}>{contact.displayName}</Text> : null}
            </View>
          </View>

          <View style={styles.introCard}>
            <View accessible={false} style={styles.introIcon}><TabIcon name="info" color={colors.info} size={19} /></View>
            <Text style={styles.introText}>{t("contactCorrectionHint")}</Text>
          </View>

          {data && !canRequestChanges ? <View style={styles.warning}><Text style={styles.warningText}>{t("contactCorrectionDenied")}</Text></View> : null}
          {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}

          {contact && draft ? (
            reviewing ? (
              <>
                <View style={styles.reviewCard}>
                  <Text style={styles.reviewTitle}>{t("contactCorrectionReviewChanges")}</Text>
                  <Text style={styles.reviewHint}>{t("contactCorrectionReviewHint")}</Text>
                  {changes.map((change) => (
                    <View key={change.field} style={styles.changeRow}>
                      <Text style={styles.changeLabel}>{contactCorrectionFieldLabel(change.field)}</Text>
                      <Text style={styles.changeBefore}>{t("contactCorrectionFrom")}: {displayValue(change.before)}</Text>
                      <Text style={styles.changeAfter}>{t("contactCorrectionTo")}: {displayValue(change.after)}</Text>
                    </View>
                  ))}
                  <View style={styles.reasonPreview}>
                    <Text style={styles.changeLabel}>{t("contactCorrectionReason")}</Text>
                    <Text style={styles.reasonPreviewText}>{reason.trim()}</Text>
                  </View>
                </View>
                <View style={styles.buttonRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("contactCorrectionEdit")}
                    accessibilityState={{ disabled: submitting }}
                    disabled={submitting}
                    onPress={() => setReviewing(false)}
                    style={[styles.secondaryButton, submitting && styles.disabled]}
                  >
                    <Text style={styles.secondaryButtonText}>{t("contactCorrectionEdit")}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={submitting ? t("saving") : t("contactCorrectionSend")}
                    accessibilityState={{ busy: submitting, disabled: submitting }}
                    disabled={submitting}
                    onPress={() => void send()}
                    style={[styles.inlinePrimaryButton, submitting && styles.disabled]}
                  >
                    <Text style={styles.primaryButtonText}>{submitting ? t("saving") : t("contactCorrectionSend")}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <View style={styles.formCard}>
                  <Input label={t("contactCorrectionField_firstName")} required value={draft.firstName} onChangeText={(value) => update("firstName", value)} maxLength={120} />
                  <Input label={t("contactCorrectionField_lastName")} required value={draft.lastName} onChangeText={(value) => update("lastName", value)} maxLength={120} />
                  <Input label={t("contactCorrectionField_middleName")} value={draft.middleName} onChangeText={(value) => update("middleName", value)} maxLength={120} />
                  <Input label={t("contactCorrectionField_specialtyName")} value={draft.specialtyName} onChangeText={(value) => update("specialtyName", value)} maxLength={120} />
                  <Input label={t("contactCorrectionField_qualificationCategory")} value={draft.qualificationCategory} onChangeText={(value) => update("qualificationCategory", value)} maxLength={120} />
                  <Input label={t("contactCorrectionField_profile")} value={draft.profile} onChangeText={(value) => update("profile", value)} maxLength={120} />
                  <Input label={t("contactCorrectionField_phone")} value={draft.phone} onChangeText={(value) => update("phone", value)} keyboardType="phone-pad" maxLength={120} />
                  <Input label={t("contactCorrectionField_messengerPhone")} value={draft.messengerPhone} onChangeText={(value) => update("messengerPhone", value)} keyboardType="phone-pad" maxLength={120} />
                  <Input label={t("contactCorrectionField_email")} value={draft.email} onChangeText={(value) => update("email", value)} keyboardType="email-address" autoCapitalize="none" maxLength={200} />
                  <Input label={t("contactCorrectionField_notes")} value={draft.notes} onChangeText={(value) => update("notes", value)} multiline maxLength={5000} />
                </View>
                <View style={styles.formCard}>
                  <Input label={t("contactCorrectionReason")} required value={reason} onChangeText={(value) => { dirtyDraft.current = true; setReason(value); setReviewing(false); setError(null) }} multiline maxLength={1000} placeholder={t("contactCorrectionReasonHint")} />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("contactCorrectionReview")}
                  accessibilityState={{ disabled: !canRequestChanges }}
                  disabled={!canRequestChanges}
                  onPress={beginReview}
                  style={[styles.primaryButton, !canRequestChanges && styles.disabled]}
                >
                  <Text style={styles.primaryButtonText}>{t("contactCorrectionReview")}</Text>
                </Pressable>
              </>
            )
          ) : null}

          <View style={styles.historyHeading}><Text style={styles.historyTitle}>{t("contactCorrectionHistory")}</Text><Text style={styles.historyCount}>{history.length}</Text></View>
          {history.length ? history.map((request) => (
            <View key={request.id} style={styles.historyCard}>
              <View style={styles.historyTop}><Text style={styles.historyStatus}>{approvalStatusLabel(request.status)}</Text><Text style={styles.historyDate}>{formatShortDateTime(request.submittedAt, locale)}</Text></View>
              <Text style={styles.historyReason}>{request.reason}</Text>
              {request.decisionComment ? <Text style={styles.historyComment}>{request.decisionComment}</Text> : null}
            </View>
          )) : <View style={styles.emptyHistory}><Text style={styles.emptyHistoryText}>{t("contactCorrectionHistoryEmpty")}</Text></View>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Input({
  label,
  required,
  multiline,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  maxLength,
}: {
  label: string
  required?: boolean
  multiline?: boolean
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  keyboardType?: "default" | "email-address" | "phone-pad"
  autoCapitalize?: "none"
  maxLength?: number
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}{required ? " *" : ""}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        multiline={multiline}
        maxLength={maxLength}
        textAlignVertical={multiline ? "top" : "center"}
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { paddingBottom: 34 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingBack: { position: "absolute", top: 12, left: 14, width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  loadingText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  headerBody: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  introCard: { marginHorizontal: 14, marginTop: 14, borderRadius: radii.card, padding: 13, backgroundColor: colors.infoBg, flexDirection: "row", gap: 10, alignItems: "center" },
  introIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  introIconText: { color: colors.info, fontWeight: "900", fontSize: 16 },
  introText: { flex: 1, color: colors.info, fontSize: 11, fontWeight: "700", lineHeight: 16 },
  warning: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 11, backgroundColor: colors.warningBg },
  warningText: { color: colors.warning, fontSize: 11, fontWeight: "800" },
  error: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 11, backgroundColor: colors.dangerBg },
  errorText: { color: colors.missed, fontSize: 11, fontWeight: "800" },
  formCard: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, gap: 12, ...cardShadow },
  inputGroup: { flex: 1 },
  inputLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  input: { minHeight: 46, borderRadius: radii.inner, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, color: colors.text, fontSize: 13 },
  textarea: { minHeight: 86, paddingTop: 12, lineHeight: 18 },
  reviewCard: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, ...cardShadow },
  reviewTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  reviewHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  changeRow: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  changeLabel: { color: colors.text, fontSize: 12, fontWeight: "900" },
  changeBefore: { color: colors.muted, fontSize: 10, marginTop: 5 },
  changeAfter: { color: colors.primary, fontSize: 10, fontWeight: "900", marginTop: 3 },
  reasonPreview: { paddingTop: 12 },
  reasonPreviewText: { color: colors.text, fontSize: 12, lineHeight: 18, marginTop: 4 },
  buttonRow: { marginHorizontal: 14, marginTop: 14, flexDirection: "row", gap: 10 },
  primaryButton: { flex: 1, minHeight: 52, marginHorizontal: 14, marginTop: 16, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  successButton: { width: "100%", minHeight: 52, marginTop: 22, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  inlinePrimaryButton: { flex: 1, minHeight: 52, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  primaryButtonText: { color: colors.headerText, fontSize: 13, fontWeight: "900", textAlign: "center" },
  secondaryButton: { flex: 1, minHeight: 52, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  secondaryButtonText: { color: colors.text, fontSize: 13, fontWeight: "900" },
  disabled: { opacity: 0.55 },
  historyHeading: { marginHorizontal: 16, marginTop: 24, marginBottom: 5, flexDirection: "row", alignItems: "center", gap: 7 },
  historyTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  historyCount: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.primarySoft, color: colors.primary, fontSize: 10, lineHeight: 22, textAlign: "center", fontWeight: "900" },
  historyCard: { marginHorizontal: 14, marginTop: 8, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  historyTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  historyStatus: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  historyDate: { color: colors.faint, fontSize: 9, fontWeight: "700" },
  historyReason: { color: colors.text, fontSize: 12, lineHeight: 17, marginTop: 8 },
  historyComment: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 7 },
  emptyHistory: { marginHorizontal: 14, marginTop: 8, borderRadius: radii.card, padding: 14, backgroundColor: colors.card },
  emptyHistoryText: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  success: { flex: 1, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  successMark: { width: 70, height: 70, borderRadius: 24, backgroundColor: colors.successBg, alignItems: "center", justifyContent: "center" },
  successTitle: { color: colors.text, fontSize: 22, fontWeight: "900", textAlign: "center", marginTop: 18 },
  successHint: { color: colors.muted, fontSize: 13, textAlign: "center", lineHeight: 19, marginTop: 7 },
  statusPill: { marginTop: 13, borderRadius: radii.pill, backgroundColor: colors.primarySoft, paddingHorizontal: 12, paddingVertical: 7 },
  statusText: { color: colors.primary, fontSize: 10, fontWeight: "900" },
})
