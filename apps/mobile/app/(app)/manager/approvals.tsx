import { type ReactNode, useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { TabIcon } from "../../../src/components/TabIcon"
import type { FieldManagerApprovalDecisionInput, FieldManagerApprovalsData } from "../../../src/field/contracts"
import { fieldContactChangePreview, type FieldContactChangePreview } from "../../../src/field/contact-correction"
import { contactChangeKindLabel, contactCorrectionFieldLabel, hrmRequestTypeLabel, objectTypeLabel, routeChangeTypeLabel } from "../../../src/field/labels"
import { t, useLocale } from "../../../src/i18n"
import { formatCalendarDay, formatShortDateTime } from "../../../src/i18n/date-format"
import { HttpError } from "../../../src/sync/ports-error"
import { cardShadow, colors, radii } from "../../../src/theme"

type ApprovalKind = FieldManagerApprovalDecisionInput["kind"]
type ApprovalDecision = "APPROVED" | "REJECTED" | "NEEDS_INFO" | "RESCHEDULE"

type ReviewItem = {
  id: string
  kind: ApprovalKind
  title: string
  typeLabel: string
  reason: string
  requestedBy: string
  submittedAt: string
  canReschedule: boolean
  contactId?: string
  contactPreview?: FieldContactChangePreview
}

function dateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return year + "-" + month + "-" + day
}

function addDays(days: number): Date {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return date
}

function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(value + "T12:00:00.000Z")
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function decisionLabel(decision: ApprovalDecision): string {
  if (decision === "APPROVED") return t("managerDecision_APPROVED")
  if (decision === "REJECTED") return t("managerDecision_REJECTED")
  if (decision === "NEEDS_INFO") return t("managerDecision_NEEDS_INFO")
  return t("managerDecision_RESCHEDULE")
}

function decisionsFor(item: ReviewItem): ApprovalDecision[] {
  if (item.kind === "HRM") return ["APPROVED", "REJECTED"]
  if (item.kind === "ROUTE_CHANGE") {
    return item.canReschedule
      ? ["APPROVED", "REJECTED", "NEEDS_INFO", "RESCHEDULE"]
      : ["APPROVED", "REJECTED", "NEEDS_INFO"]
  }
  return ["APPROVED", "REJECTED", "NEEDS_INFO"]
}

function decisionNeedsNote(item: ReviewItem, decision: ApprovalDecision | null): boolean {
  return item.kind === "CONTACT_CHANGE" || decision === "REJECTED" || decision === "NEEDS_INFO"
}

function errorCode(error: unknown): string | null {
  if (!(error instanceof HttpError) || !error.detail || typeof error.detail !== "object" || Array.isArray(error.detail)) return null
  const value = error.detail as Record<string, unknown>
  return typeof value.code === "string" ? value.code : null
}

function decisionError(error: unknown): string {
  if (error instanceof HttpError && error.status === 403) return t("managerDecisionDenied")
  if (error instanceof HttpError && error.status === 409) return t("managerDecisionConflict")
  return t("managerDecisionFailed")
}

function buildDecisionInput(
  item: ReviewItem,
  decision: ApprovalDecision,
  note: string,
  rescheduleDate: string,
  acknowledgeRouteConflicts: boolean,
): FieldManagerApprovalDecisionInput {
  const trimmedNote = note.trim()
  if (item.kind === "HRM") {
    if (decision !== "APPROVED" && decision !== "REJECTED") throw new Error("Unsupported HRM decision")
    return {
      kind: "HRM",
      id: item.id,
      decision,
      ...(trimmedNote ? { note: trimmedNote } : {}),
      ...(acknowledgeRouteConflicts ? { acknowledgeRouteConflicts: true } : {}),
    }
  }
  if (item.kind === "ROUTE_CHANGE") {
    return {
      kind: "ROUTE_CHANGE",
      id: item.id,
      decision,
      ...(trimmedNote ? { note: trimmedNote } : {}),
      ...(decision === "RESCHEDULE" ? { rescheduleDate } : {}),
    }
  }
  if (item.kind === "CUSTOMER_CREATE") {
    if (decision === "RESCHEDULE") throw new Error("Unsupported customer decision")
    return {
      kind: "CUSTOMER_CREATE",
      id: item.id,
      decision,
      ...(trimmedNote ? { note: trimmedNote } : {}),
    }
  }
  if (decision === "RESCHEDULE") throw new Error("Unsupported contact decision")
  return {
    kind: "CONTACT_CHANGE",
    id: item.id,
    decision,
    note: trimmedNote,
  }
}

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

function ApprovalRequest({
  item,
  index,
  reviewing,
  selectedDecision,
  note,
  rescheduleDate,
  acknowledgeRouteConflicts,
  saving,
  actionError,
  onOpen,
  onClose,
  onSelectDecision,
  onChangeNote,
  onChangeRescheduleDate,
  onToggleRouteConflict,
  onSubmit,
}: {
  item: ReviewItem
  index: number
  reviewing: boolean
  selectedDecision: ApprovalDecision | null
  note: string
  rescheduleDate: string
  acknowledgeRouteConflicts: boolean
  saving: boolean
  actionError: string | null
  onOpen: () => void
  onClose: () => void
  onSelectDecision: (decision: ApprovalDecision) => void
  onChangeNote: (value: string) => void
  onChangeRescheduleDate: (value: string) => void
  onToggleRouteConflict: () => void
  onSubmit: () => void
}) {
  const locale = useLocale()
  const options = decisionsFor(item)
  const needsNote = decisionNeedsNote(item, selectedDecision)
  const requiresFullContactReview = Boolean(item.contactPreview?.needsFullReview)
  const selectedRescheduleDate = isDateKey(rescheduleDate) ? formatCalendarDay(rescheduleDate, locale) : null
  return (
    <View style={[styles.request, index > 0 && styles.requestBorder]}>
      <View style={styles.requestTop}>
        <View style={styles.requestBody}>
          <Text style={styles.requestTitle}>{item.title}</Text>
          <View style={styles.typePill}><Text style={styles.typePillText}>{item.typeLabel}</Text></View>
        </View>
        <Pressable
          accessibilityLabel={`${item.title}: ${reviewing ? t("managerApprovalCloseReview") : t("managerApprovalReview")}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: reviewing }}
          onPress={reviewing ? onClose : onOpen}
          style={styles.reviewButton}
        >
          <Text style={styles.reviewButtonText}>{reviewing ? t("managerApprovalCloseReview") : t("managerApprovalReview")}</Text>
        </Pressable>
      </View>
      <Text style={styles.requestReason} numberOfLines={reviewing ? undefined : 3}>{item.reason}</Text>
      {item.contactPreview ? (
        <View style={styles.contactProposal}>
          <View style={styles.contactProposalTop}>
            <Text style={styles.contactProposalTitle}>{t("managerContactProposalTitle")}</Text>
            {item.contactId ? (
              <Pressable
                accessibilityLabel={`${t("managerContactProposalOpen")}: ${item.title}`}
                accessibilityRole="button"
                onPress={() => router.push(`/(app)/contacts/${item.contactId}` as never)}
                style={styles.contactProposalOpen}
              >
                <Text style={styles.contactProposalOpenText}>{t("managerContactProposalOpen")}</Text>
              </Pressable>
            ) : null}
          </View>
          {item.contactPreview.fields.map((change) => (
            <View key={change.field} style={styles.contactProposalRow}>
              <Text style={styles.contactProposalLabel}>{contactCorrectionFieldLabel(change.field)}</Text>
              <Text style={styles.contactProposalValue}>{change.value ?? t("managerContactProposalCleared")}</Text>
            </View>
          ))}
          {requiresFullContactReview ? <Text style={styles.contactProposalWarning}>{t("managerContactProposalUnknown")}</Text> : null}
        </View>
      ) : null}
      <RequestMeta by={item.requestedBy} at={item.submittedAt} />

      {reviewing && requiresFullContactReview ? (
        <View style={styles.decisionPanel}>
          <Text style={styles.decisionTitle}>{t("managerContactProposalTitle")}</Text>
          <Text style={styles.contactProposalWarning}>{t("managerContactProposalUnknown")}</Text>
        </View>
      ) : null}

      {reviewing && !requiresFullContactReview ? (
        <View style={styles.decisionPanel}>
          <Text style={styles.decisionTitle}>{t("managerDecisionTitle")}</Text>
          <Text style={styles.decisionHint}>{t("managerDecisionHint")}</Text>
          <View style={styles.decisionChoices}>
            {options.map((decision) => (
              <Pressable
                key={decision}
                accessibilityLabel={decisionLabel(decision)}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedDecision === decision }}
                onPress={() => onSelectDecision(decision)}
                style={[styles.decisionChoice, selectedDecision === decision && styles.decisionChoiceSelected]}
              >
                <View style={styles.decisionChoiceContent}>
                  <Text style={[styles.decisionChoiceText, selectedDecision === decision && styles.decisionChoiceTextSelected]}>{decisionLabel(decision)}</Text>
                  {selectedDecision === decision ? <TabIcon name="check" color={colors.headerText} size={14} /> : null}
                </View>
              </Pressable>
            ))}
          </View>

          {selectedDecision === "RESCHEDULE" ? (
            <View style={styles.datePanel}>
              <Text style={styles.fieldLabel}>{t("managerDecisionDate")}</Text>
              <TextInput
                accessibilityLabel={t("managerDecisionDate")}
                accessibilityHint={t("dateInputHint")}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
                onChangeText={onChangeRescheduleDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.faint}
                style={styles.dateInput}
                value={rescheduleDate}
              />
              {selectedRescheduleDate ? <Text style={styles.dateHint}>{selectedRescheduleDate.weekday}, {selectedRescheduleDate.date}</Text> : null}
              <View style={styles.datePresets}>
                {[1, 7, 14].map((days) => {
                  const candidate = dateKey(addDays(days))
                  const candidateLabel = formatCalendarDay(candidate, locale)
                  return (
                    <Pressable
                      key={days}
                      accessibilityLabel={`${t("managerDecisionDate")}: ${candidateLabel.weekday}, ${candidateLabel.date || candidate}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: rescheduleDate === candidate }}
                      onPress={() => onChangeRescheduleDate(candidate)}
                      style={[styles.datePreset, rescheduleDate === candidate && styles.datePresetSelected]}
                    >
                      <Text style={[styles.datePresetText, rescheduleDate === candidate && styles.datePresetTextSelected]}>{candidateLabel.date || candidate}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          ) : null}

          {selectedDecision ? (
            <View style={styles.notePanel}>
              <Text style={styles.fieldLabel}>{t("managerDecisionNote")}{needsNote ? " *" : ""}</Text>
              <TextInput
                accessibilityLabel={t("managerDecisionNote")}
                accessibilityHint={needsNote ? t("managerDecisionNoteRequired") : t("managerDecisionNotePlaceholder")}
                multiline
                onChangeText={onChangeNote}
                placeholder={t("managerDecisionNotePlaceholder")}
                placeholderTextColor={colors.faint}
                style={styles.noteInput}
                textAlignVertical="top"
                value={note}
              />
            </View>
          ) : null}

          {acknowledgeRouteConflicts ? (
            <Pressable accessibilityLabel={t("managerHrmAcknowledgeConflict")} accessibilityRole="checkbox" accessibilityState={{ checked: true }} onPress={onToggleRouteConflict} style={styles.conflictAcknowledge}>
              <View style={styles.checkbox}><TabIcon name="check" color={colors.warning} size={15} /></View>
              <Text style={styles.conflictAcknowledgeText}>{t("managerHrmAcknowledgeConflict")}</Text>
            </Pressable>
          ) : actionError === t("managerHrmRouteConflict") && item.kind === "HRM" && selectedDecision === "APPROVED" ? (
            <Pressable accessibilityLabel={t("managerHrmAcknowledgeConflict")} accessibilityRole="checkbox" accessibilityState={{ checked: false }} onPress={onToggleRouteConflict} style={styles.conflictAcknowledge}>
              <View style={styles.checkbox} />
              <Text style={styles.conflictAcknowledgeText}>{t("managerHrmAcknowledgeConflict")}</Text>
            </Pressable>
          ) : null}

          {actionError ? <Text accessibilityLiveRegion="polite" style={styles.actionError}>{actionError}</Text> : null}
          <Pressable
            accessibilityLabel={t("managerDecisionConfirm")}
            accessibilityRole="button"
            accessibilityState={{ busy: saving, disabled: !selectedDecision || saving }}
            disabled={!selectedDecision || saving}
            onPress={onSubmit}
            style={[styles.submit, (!selectedDecision || saving) && styles.disabled]}
          >
            <Text style={styles.submitText}>{saving ? t("managerDecisionSaving") : t("managerDecisionConfirm")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

export default function ManagerApprovalsScreen() {
  useLocale()
  const [data, setData] = useState<FieldManagerApprovalsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [reviewing, setReviewing] = useState<ReviewItem | null>(null)
  const [selectedDecision, setSelectedDecision] = useState<ApprovalDecision | null>(null)
  const [note, setNote] = useState("")
  const [rescheduleDate, setRescheduleDate] = useState(() => dateKey(addDays(1)))
  const [acknowledgeRouteConflicts, setAcknowledgeRouteConflicts] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

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

  const beginReview = (item: ReviewItem) => {
    setReviewing(item)
    setSelectedDecision(null)
    setNote("")
    setRescheduleDate(dateKey(addDays(1)))
    setAcknowledgeRouteConflicts(false)
    setActionError(null)
  }

  const closeReview = () => {
    setReviewing(null)
    setSelectedDecision(null)
    setNote("")
    setAcknowledgeRouteConflicts(false)
    setActionError(null)
  }

  const chooseDecision = (decision: ApprovalDecision) => {
    setSelectedDecision(decision)
    setAcknowledgeRouteConflicts(false)
    setActionError(null)
  }

  const saveDecision = async () => {
    if (!reviewing || !selectedDecision) return
    if (decisionNeedsNote(reviewing, selectedDecision) && !note.trim()) {
      setActionError(t("managerDecisionNoteRequired"))
      return
    }
    if (selectedDecision === "RESCHEDULE" && !isDateKey(rescheduleDate)) {
      setActionError(t("managerDecisionDateRequired"))
      return
    }
    setSavingId(reviewing.id)
    setActionError(null)
    try {
      await fieldApi.managerApprovalDecision(buildDecisionInput(
        reviewing,
        selectedDecision,
        note,
        rescheduleDate,
        acknowledgeRouteConflicts,
      ))
      closeReview()
      Alert.alert(t("managerDecisionSaved"))
      await load()
    } catch (reason) {
      if (
        reviewing.kind === "HRM" &&
        selectedDecision === "APPROVED" &&
        errorCode(reason) === "MTM_HRM_ROUTE_CONFLICT"
      ) {
        setActionError(t("managerHrmRouteConflict"))
      } else {
        setActionError(decisionError(reason))
      }
    } finally {
      setSavingId(null)
    }
  }

  const confirmDecision = () => {
    if (!reviewing || !selectedDecision) return
    if (decisionNeedsNote(reviewing, selectedDecision) && !note.trim()) {
      setActionError(t("managerDecisionNoteRequired"))
      return
    }
    if (selectedDecision === "RESCHEDULE" && !isDateKey(rescheduleDate)) {
      setActionError(t("managerDecisionDateRequired"))
      return
    }
    Alert.alert(t("managerDecisionConfirmTitle"), t("managerDecisionConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("managerDecisionConfirm"), onPress: () => void saveDecision() },
    ])
  }

  const denied = error instanceof HttpError && error.status === 403
  const total = data
    ? data.counts.hrm + data.counts.routeChanges + data.counts.customers + data.counts.contactChanges
    : 0
  const reviewProps = (item: ReviewItem, index: number) => ({
    item,
    index,
    reviewing: reviewing?.id === item.id && reviewing.kind === item.kind,
    selectedDecision,
    note,
    rescheduleDate,
    acknowledgeRouteConflicts,
    saving: savingId === item.id,
    actionError,
    onOpen: () => beginReview(item),
    onClose: closeReview,
    onSelectDecision: chooseDecision,
    onChangeNote: setNote,
    onChangeRescheduleDate: setRescheduleDate,
    onToggleRouteConflict: () => setAcknowledgeRouteConflicts((value) => !value),
    onSubmit: confirmDecision,
  })

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.primary} />}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.back}><TabIcon name="chevronLeft" color={colors.text} size={23} /></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("managerHomeTitle").toUpperCase()}</Text>
            <Text style={styles.title}>{t("managerApprovalsTitle")}</Text>
            <Text style={styles.subtitle}>{t("managerApprovalsHint")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} accessibilityState={{ busy: loading, disabled: loading }} disabled={loading} onPress={() => void load()} style={styles.refresh}><TabIcon name="refresh" color={colors.primary} size={22} /></Pressable>
        </View>

        {loading && !data ? <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>{t("managerLoading")}</Text></View> : null}
        {error && !data ? (
          <View style={[styles.state, denied && styles.stateWarning]}>
            <View style={styles.stateIcon}><TabIcon name="inbox" color={denied ? colors.warning : colors.primary} size={25} /></View>
            <Text style={styles.stateTitle}>{denied ? t("managerAccessDeniedTitle") : t("managerUnavailable")}</Text>
            <Text style={styles.stateText}>{denied ? t("managerAccessDeniedBody") : t("managerRetry")}</Text>
            <Pressable accessibilityLabel={t("managerRetry")} accessibilityRole="button" onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>{t("managerRetry")}</Text></Pressable>
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
                  {data.hrm.map((item, index) => <ApprovalRequest key={item.id} {...reviewProps({ id: item.id, kind: "HRM", title: item.agent.name, typeLabel: hrmRequestTypeLabel(item.type), reason: item.reason, requestedBy: item.agent.name, submittedAt: item.submittedAt, canReschedule: false }, index)} />)}
                </Section>
                <Section title={t("managerApprovalRoute")} count={data.counts.routeChanges} icon="route">
                  {data.routeChanges.map((item, index) => <ApprovalRequest key={item.id} {...reviewProps({ id: item.id, kind: "ROUTE_CHANGE", title: item.requestedByAgent.name, typeLabel: routeChangeTypeLabel(item.changeType), reason: item.reason, requestedBy: item.requestedByAgent.name, submittedAt: item.submittedAt, canReschedule: item.changeType === "REMOVE_STOP" }, index)} />)}
                </Section>
                <Section title={t("managerApprovalCustomer")} count={data.counts.customers} icon="organizations">
                  {data.customers.map((item, index) => <ApprovalRequest key={item.id} {...reviewProps({ id: item.id, kind: "CUSTOMER_CREATE", title: item.name, typeLabel: objectTypeLabel(item.objectType), reason: item.reason, requestedBy: item.requestedByAgent.name, submittedAt: item.submittedAt, canReschedule: false }, index)} />)}
                </Section>
                <Section title={t("managerApprovalContact")} count={data.counts.contactChanges} icon="contacts">
                  {data.contactChanges.map((item, index) => {
                    const contactPreview = fieldContactChangePreview(item.kind, item.payload)
                    return <ApprovalRequest key={item.id} {...reviewProps({
                      id: item.id,
                      kind: "CONTACT_CHANGE",
                      title: item.contact.displayName,
                      typeLabel: contactChangeKindLabel(item.kind),
                      reason: item.reason,
                      requestedBy: item.requestedByAgent.name,
                      submittedAt: item.submittedAt,
                      canReschedule: false,
                      contactId: item.contactId,
                      contactPreview,
                    }, index)} />
                  })}
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
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.9 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  refresh: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
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
  requestTop: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  requestBody: { flex: 1, minWidth: 0 },
  requestTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  typePill: { alignSelf: "flex-start", marginTop: 5, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.primarySoft },
  typePillText: { color: colors.primary, fontSize: 8, fontWeight: "900" },
  reviewButton: { minHeight: 44, maxWidth: 130, borderRadius: 12, paddingHorizontal: 10, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  reviewButtonText: { color: colors.primary, fontSize: 9, lineHeight: 12, textAlign: "center", fontWeight: "900" },
  requestReason: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 8 },
  contactProposal: { marginTop: 9, borderRadius: 12, padding: 10, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder, gap: 7 },
  contactProposalTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  contactProposalTitle: { flex: 1, color: colors.info, fontSize: 10, fontWeight: "900" },
  contactProposalOpen: { minHeight: 44, borderRadius: 10, paddingHorizontal: 10, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  contactProposalOpenText: { color: colors.info, fontSize: 8, fontWeight: "900" },
  contactProposalRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  contactProposalLabel: { flex: 1, color: colors.muted, fontSize: 9, fontWeight: "800" },
  contactProposalValue: { flex: 1.2, color: colors.text, fontSize: 10, lineHeight: 14, fontWeight: "900", textAlign: "right" },
  contactProposalWarning: { color: colors.warning, fontSize: 9, lineHeight: 14, fontWeight: "800" },
  requestMeta: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 2 },
  requestBy: { color: colors.primary, fontSize: 8, fontWeight: "800" },
  requestAt: { color: colors.faint, fontSize: 8, fontWeight: "700" },
  decisionPanel: { marginTop: 12, borderRadius: radii.inner, padding: 11, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, gap: 9 },
  decisionTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  decisionHint: { color: colors.muted, fontSize: 9, lineHeight: 13 },
  decisionChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  decisionChoice: { minHeight: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 11, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  decisionChoiceSelected: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primary },
  decisionChoiceContent: { flexDirection: "row", alignItems: "center", gap: 5 },
  decisionChoiceText: { color: colors.muted, fontSize: 9, fontWeight: "900" },
  decisionChoiceTextSelected: { color: colors.headerText },
  notePanel: { gap: 5 },
  fieldLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.45 },
  noteInput: { minHeight: 76, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 9, color: colors.text, fontSize: 11, lineHeight: 16 },
  datePanel: { gap: 6 },
  dateInput: { minHeight: 44, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, color: colors.text, fontSize: 12, fontWeight: "900" },
  dateHint: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  datePresets: { flexDirection: "row", gap: 6 },
  datePreset: { flex: 1, minHeight: 44, borderRadius: 10, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  datePresetSelected: { backgroundColor: colors.primarySoft },
  datePresetText: { color: colors.muted, fontSize: 8, fontWeight: "800" },
  datePresetTextSelected: { color: colors.primary },
  conflictAcknowledge: { minHeight: 44, borderRadius: 12, padding: 9, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.warningBg },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: colors.warning, alignItems: "center", justifyContent: "center", backgroundColor: colors.card },
  conflictAcknowledgeText: { flex: 1, color: colors.warning, fontSize: 9, lineHeight: 13, fontWeight: "800" },
  actionError: { color: colors.missed, fontSize: 10, lineHeight: 14, fontWeight: "800" },
  submit: { minHeight: 46, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  submitText: { color: colors.headerText, fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.42 },
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
