import { useEffect, useMemo, useState } from "react"
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import type { FieldRoutePoint } from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import { RouteTargetPicker, routeTargetKey, type RouteTarget } from "../../../src/field/route-target-picker"
import { addMinutesToRouteTime, formatRouteTime, isValidRouteTime, routePlannedTime } from "../../../src/field/route-time"
import { routeStatusMeta, type RouteStatusTone } from "../../../src/field/week-status"
import { t, useLocale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"

const tones: Record<RouteStatusTone, { bg: string; border: string; text: string }> = {
  draft: { bg: colors.draftBg, border: colors.draftBorder, text: colors.draft },
  planned: { bg: colors.infoBg, border: colors.infoBorder, text: colors.info },
  inProgress: { bg: colors.warningBg, border: "#F6D788", text: colors.warning },
  completed: { bg: colors.successBg, border: colors.successBorder, text: colors.successDark },
  cancelled: { bg: colors.draftBg, border: colors.draftBorder, text: colors.draft },
  missed: { bg: colors.missedBg, border: colors.missedBorder, text: colors.missed },
}

function reorder(points: FieldRoutePoint[], from: number, to: number): FieldRoutePoint[] {
  if (to < 0 || to >= points.length) return points
  const next = [...points]
  const [moved] = next.splice(from, 1)
  if (!moved) return points
  next.splice(to, 0, moved)
  return next.map((point, index) => ({ ...point, orderIndex: index + 1 }))
}

export default function FieldRouteDetailScreen() {
  useLocale()
  const { routeId } = useLocalSearchParams<{ routeId: string }>()
  const field = useField()
  const routeData = useMemo(
    () => field.week?.days.flatMap((day) => day.routes).find((route) => route.id === routeId) ?? null,
    [field.week, routeId],
  )
  const [name, setName] = useState("")
  const [notes, setNotes] = useState("")
  const [points, setPoints] = useState<FieldRoutePoint[]>([])
  const [timeInputs, setTimeInputs] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [requestPoint, setRequestPoint] = useState<FieldRoutePoint | null>(null)
  const [reason, setReason] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [addRequestTarget, setAddRequestTarget] = useState<RouteTarget | null>(null)
  const [addReason, setAddReason] = useState("")

  useEffect(() => {
    if (!routeData) return
    setName(routeData.name ?? "")
    setNotes(routeData.notes ?? "")
    setPoints(routeData.points)
    setTimeInputs(Object.fromEntries(routeData.points.map((point) => [
      point.id,
      formatRouteTime(point.plannedTime, field.week?.timezone ?? "UTC"),
    ])))
  }, [field.week?.timezone, routeData])

  if (!routeData) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>{t("fieldDataError")}</Text>
          <Pressable onPress={() => router.back()} style={styles.primaryButton}><Text style={styles.primaryText}>{t("back")}</Text></Pressable>
        </View>
      </SafeAreaView>
    )
  }

  const meta = routeStatusMeta(routeData.effectiveStatus)
  const tone = tones[meta.tone]
  const canRequestStopRemoval = ["PLANNED", "IN_PROGRESS"].includes(routeData.persistedStatus)
  const canRequestStopAddition = canRequestStopRemoval
  const excludedTargets = new Set(points.map((point) => routeTargetKey(point.customerId, point.contactId)))

  async function save() {
    const dateKey = routeData!.date.slice(0, 10)
    const timezone = field.week?.timezone ?? "UTC"
    const mappedPoints = points.map((point) => {
      const time = (timeInputs[point.id] ?? "").trim()
      return {
        customerId: point.customerId,
        contactId: point.contactId,
        plannedTime: time ? routePlannedTime(dateKey, time, timezone) : null,
        time,
      }
    })
    if (mappedPoints.some((point) => !isValidRouteTime(point.time) || (point.time && !point.plannedTime))) {
      Alert.alert(t("invalidRouteTime"))
      return
    }
    setSaving(true)
    try {
      await fieldApi.updateRoute(routeData!.id, {
        name: name.trim() || null,
        notes: notes.trim() || null,
        points: mappedPoints.map((point) => ({
          customerId: point.customerId,
          contactId: point.contactId,
          plannedTime: point.plannedTime,
        })),
      })
      if (field.week) await field.loadWeek(field.week.weekStart)
      Alert.alert(t("changesSaved"))
    } catch (error) {
      Alert.alert(t("fieldDataError"), error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  function removeDraftPoint(index: number) {
    Alert.alert(t("removeStop"), points[index]?.customer.name, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("removeStop"),
        style: "destructive",
        onPress: () => setPoints((current) => current.filter((_, itemIndex) => itemIndex !== index).map((point, nextIndex) => ({ ...point, orderIndex: nextIndex + 1 }))),
      },
    ])
  }

  function autoSchedule() {
    setTimeInputs(Object.fromEntries(points.map((point, index) => [
      point.id,
      addMinutesToRouteTime("09:00", index * 30),
    ])))
  }

  async function submitRemovalRequest() {
    if (!requestPoint || reason.trim().length < 3) return
    setSaving(true)
    try {
      await fieldApi.requestRouteChange(routeData!.id, {
        changeType: "REMOVE_STOP",
        routePointId: requestPoint.id,
        reason: reason.trim(),
      })
      setRequestPoint(null)
      setReason("")
      Alert.alert(t("requestSent"))
      await field.refresh()
    } catch (error) {
      Alert.alert(t("fieldDataError"), error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  function selectTarget(target: RouteTarget) {
    if (routeData!.canEdit) {
      const pointId = `draft-${target.key}-${Date.now()}`
      setPoints((current) => [...current, {
        id: pointId,
        customerId: target.customer.id,
        contactId: target.contact?.id ?? null,
        orderIndex: current.length + 1,
        status: "PENDING",
        effectiveStatus: "PENDING",
        plannedTime: null,
        visitedAt: null,
        notes: null,
        customer: target.customer,
        contact: target.contact,
      }])
      setTimeInputs((current) => ({ ...current, [pointId]: "" }))
      setPickerOpen(false)
      return
    }
    setAddRequestTarget(target)
    setPickerOpen(false)
  }

  async function submitAdditionRequest() {
    if (!addRequestTarget || addReason.trim().length < 3) return
    setSaving(true)
    try {
      await fieldApi.requestRouteChange(routeData!.id, {
        changeType: "ADD_STOP",
        reason: addReason.trim(),
        payload: {
          customerId: addRequestTarget.customer.id,
          contactId: addRequestTarget.contact?.id ?? null,
        },
      })
      setAddRequestTarget(null)
      setAddReason("")
      Alert.alert(t("requestSent"))
      await field.refresh()
    } catch (error) {
      Alert.alert(t("fieldDataError"), error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  function publish() {
    Alert.alert(t("publishConfirmTitle"), t("publishConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("publishRoute"),
        onPress: () => void (async () => {
          setSaving(true)
          try {
            await fieldApi.publishRoute(routeData!.id)
            if (field.week) await field.loadWeek(field.week.weekStart)
          } catch (error) {
            Alert.alert(t("fieldDataError"), error instanceof Error ? error.message : String(error))
          } finally {
            setSaving(false)
          }
        })(),
      },
    ])
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backButton}><Text style={styles.backText}>‹</Text></Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("routeDetails").toUpperCase()}</Text>
            <Text style={styles.title}>{routeData.name ?? t("tabRoute")}</Text>
          </View>
          <View style={[styles.status, { backgroundColor: tone.bg, borderColor: tone.border }]}>
            <Text style={[styles.statusText, { color: tone.text }]}>{t(meta.labelKey)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          {routeData.canEdit ? (
            <>
              <Text style={styles.hint}>{t("routeDraftHint")}</Text>
              <Text style={styles.label}>{t("routeName")}</Text>
              <TextInput style={styles.input} value={name} onChangeText={setName} />
              <Text style={styles.label}>{t("routeNotes")}</Text>
              <TextInput style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} multiline textAlignVertical="top" />
            </>
          ) : (
            <Text style={styles.readOnly}>{t("routeReadOnly")}</Text>
          )}
        </View>

        <View style={styles.pointsHeader}>
          <Text style={styles.sectionTitle}>{t("routePointsLabel")}</Text>
          <Text style={styles.pointsCount}>{points.length}</Text>
        </View>
        {routeData.canEdit && points.length > 0 ? (
          <Pressable onPress={autoSchedule} style={styles.autoSchedule}><Text style={styles.autoScheduleText}>{t("autoSchedule")}</Text></Pressable>
        ) : null}
        {routeData.canEdit || canRequestStopAddition ? (
          <Pressable onPress={() => { setPickerOpen((current) => !current); setRequestPoint(null); setAddRequestTarget(null) }} style={styles.addButton}>
            <Text style={styles.addButtonIcon}>＋</Text>
            <View style={styles.addButtonBody}>
              <Text style={styles.addButtonTitle}>{t("addStop")}</Text>
              <Text style={styles.addButtonHint}>{routeData.canEdit ? t("chooseStop") : t("addStopRequestHint")}</Text>
            </View>
          </Pressable>
        ) : null}
        {pickerOpen ? <RouteTargetPicker excluded={excludedTargets} onSelect={selectTarget} onCancel={() => setPickerOpen(false)} /> : null}
        {points.length === 0 ? <View style={styles.card}><Text style={styles.noPoints}>{t("noRoutePoints")}</Text></View> : null}
        {points.map((point, index) => (
          <View key={point.id} style={styles.pointCard}>
            <View style={styles.pointTop}>
              <View style={styles.indexBadge}><Text style={styles.indexText}>{index + 1}</Text></View>
              <View style={styles.pointBody}>
                <Text style={styles.pointName}>{point.contact?.displayName ?? point.customer.name}</Text>
                {point.contact ? <Text style={styles.pointSubject}>{point.contact.specialtyName ?? point.contact.type} · {point.customer.name}</Text> : null}
                <Text style={styles.pointMeta}>{point.customer.address ?? point.customer.city ?? point.customer.objectType}</Text>
                {routeData.canEdit ? (
                  <View style={styles.timeRow}>
                    <Text style={styles.timeLabel}>{t("plannedTime")}</Text>
                    <TextInput
                      value={timeInputs[point.id] ?? ""}
                      onChangeText={(value) => setTimeInputs((current) => ({ ...current, [point.id]: value }))}
                      placeholder="09:30"
                      placeholderTextColor={colors.faint}
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      style={[styles.timeInput, !isValidRouteTime(timeInputs[point.id] ?? "") && styles.timeInputInvalid]}
                    />
                  </View>
                ) : point.plannedTime ? <Text style={styles.pointTime}>{formatRouteTime(point.plannedTime, field.week?.timezone ?? "UTC")}</Text> : null}
              </View>
            </View>
            {routeData.canEdit ? (
              <View style={styles.pointActions}>
                <Pressable disabled={index === 0} onPress={() => setPoints((current) => reorder(current, index, index - 1))} style={[styles.smallButton, index === 0 && styles.disabled]}>
                  <Text style={styles.smallButtonText}>↑ {t("moveUp")}</Text>
                </Pressable>
                <Pressable disabled={index === points.length - 1} onPress={() => setPoints((current) => reorder(current, index, index + 1))} style={[styles.smallButton, index === points.length - 1 && styles.disabled]}>
                  <Text style={styles.smallButtonText}>↓ {t("moveDown")}</Text>
                </Pressable>
                <Pressable onPress={() => removeDraftPoint(index)} style={[styles.smallButton, styles.removeButton]}>
                  <Text style={styles.removeText}>{t("removeStop")}</Text>
                </Pressable>
              </View>
            ) : canRequestStopRemoval && point.effectiveStatus === "PENDING" ? (
              <Pressable onPress={() => setRequestPoint(point)} style={styles.requestButton}>
                <Text style={styles.requestText}>{t("requestRouteChange")}</Text>
              </Pressable>
            ) : null}
          </View>
        ))}

        {requestPoint ? (
          <View style={[styles.card, styles.requestCard]}>
            <Text style={styles.sectionTitle}>{t("removeStop")}: {requestPoint.customer.name}</Text>
            <Text style={styles.label}>{t("removalReason")}</Text>
            <TextInput style={[styles.input, styles.notes]} value={reason} onChangeText={setReason} multiline textAlignVertical="top" />
            {reason.length > 0 && reason.trim().length < 3 ? <Text style={styles.validation}>{t("minimumReason")}</Text> : null}
            <View style={styles.requestActions}>
              <Pressable onPress={() => { setRequestPoint(null); setReason("") }} style={styles.secondaryButton}><Text style={styles.secondaryText}>{t("cancel")}</Text></Pressable>
              <Pressable disabled={saving || reason.trim().length < 3} onPress={() => void submitRemovalRequest()} style={[styles.primaryButton, (saving || reason.trim().length < 3) && styles.disabled]}><Text style={styles.primaryText}>{t("submitRequest")}</Text></Pressable>
            </View>
          </View>
        ) : null}

        {addRequestTarget ? (
          <View style={[styles.card, styles.requestCard]}>
            <Text style={styles.sectionTitle}>{t("addStop")}: {addRequestTarget.contact?.displayName ?? addRequestTarget.customer.name}</Text>
            {addRequestTarget.contact ? <Text style={styles.requestTargetMeta}>{addRequestTarget.customer.name}</Text> : null}
            <Text style={styles.hint}>{t("addStopRequestHint")}</Text>
            <Text style={styles.label}>{t("addStopReason")}</Text>
            <TextInput style={[styles.input, styles.notes]} value={addReason} onChangeText={setAddReason} multiline textAlignVertical="top" />
            {addReason.length > 0 && addReason.trim().length < 3 ? <Text style={styles.validation}>{t("minimumReason")}</Text> : null}
            <View style={styles.requestActions}>
              <Pressable onPress={() => { setAddRequestTarget(null); setAddReason("") }} style={styles.secondaryButton}><Text style={styles.secondaryText}>{t("cancel")}</Text></Pressable>
              <Pressable disabled={saving || addReason.trim().length < 3} onPress={() => void submitAdditionRequest()} style={[styles.primaryButton, (saving || addReason.trim().length < 3) && styles.disabled]}><Text style={styles.primaryText}>{t("submitRequest")}</Text></Pressable>
            </View>
          </View>
        ) : null}

        {routeData.canEdit ? (
          <View style={styles.footerActions}>
            <Pressable disabled={saving} onPress={() => void save()} style={[styles.saveButton, saving && styles.disabled]}><Text style={styles.saveText}>{saving ? t("saving") : t("saveChanges")}</Text></Pressable>
            {routeData.canPublish ? <Pressable disabled={saving} onPress={publish} style={[styles.publishButton, saving && styles.disabled]}><Text style={styles.publishText}>{t("publishRoute")}</Text></Pressable> : null}
          </View>
        ) : null}
        <Pressable
          onPress={() => router.push({ pathname: "/(app)/routes/new", params: { copyFrom: routeData.id } } as never)}
          style={styles.copyButton}
        >
          <Text style={styles.copyTitle}>{t("copyRoute")}</Text>
          <Text style={styles.copyHint}>{t("copyRouteHint")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 34 },
  header: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  backButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  backText: { color: colors.text, fontSize: 30, lineHeight: 31 },
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: 2 },
  status: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 6 },
  statusText: { fontSize: 9, fontWeight: "900" },
  card: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.card, padding: 15, backgroundColor: colors.card, ...cardShadow },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 13 },
  readOnly: { color: colors.info, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  label: { color: colors.text, fontSize: 12, fontWeight: "800", marginTop: 9, marginBottom: 6 },
  input: { minHeight: 48, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, backgroundColor: "#FAFAFB", paddingHorizontal: 12, color: colors.text, fontSize: 14 },
  notes: { minHeight: 86, paddingTop: 12 },
  pointsHeader: { marginHorizontal: 16, marginTop: 20, marginBottom: 4, flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  pointsCount: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: colors.primarySoft, color: colors.primary, textAlign: "center", lineHeight: 24, fontSize: 11, fontWeight: "900" },
  noPoints: { color: colors.muted, textAlign: "center", paddingVertical: 18 },
  pointCard: { marginHorizontal: 14, marginTop: 9, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  pointTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  indexBadge: { width: 31, height: 31, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  indexText: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  pointBody: { flex: 1 },
  pointName: { color: colors.text, fontSize: 14, fontWeight: "900" },
  pointSubject: { color: colors.primary, fontSize: 10, fontWeight: "800", marginTop: 3 },
  pointMeta: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  pointTime: { color: colors.primary, fontSize: 11, fontWeight: "800", marginTop: 4 },
  timeRow: { marginTop: 9, flexDirection: "row", alignItems: "center", gap: 8 },
  timeLabel: { color: colors.muted, fontSize: 9, fontWeight: "800" },
  timeInput: { width: 72, height: 38, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, color: colors.text, fontSize: 12, fontWeight: "900", textAlign: "center" },
  timeInputInvalid: { borderColor: colors.missed, backgroundColor: colors.missedBg },
  pointActions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 11, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  smallButton: { minHeight: 38, borderRadius: 10, paddingHorizontal: 10, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  smallButtonText: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  removeButton: { backgroundColor: colors.missedBg },
  removeText: { color: colors.missed, fontSize: 10, fontWeight: "900" },
  requestButton: { marginTop: 10, minHeight: 41, borderRadius: 10, backgroundColor: colors.warningBg, alignItems: "center", justifyContent: "center" },
  requestText: { color: colors.warning, fontSize: 11, fontWeight: "900" },
  requestCard: { borderWidth: 1, borderColor: colors.warning },
  requestTargetMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  validation: { color: colors.missed, fontSize: 10, marginTop: 5 },
  requestActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  secondaryButton: { minHeight: 43, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: colors.text, fontSize: 12, fontWeight: "800" },
  primaryButton: { minHeight: 43, borderRadius: radii.inner, backgroundColor: colors.primary, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  primaryText: { color: colors.headerText, fontSize: 12, fontWeight: "900" },
  footerActions: { marginHorizontal: 14, marginTop: 18, gap: 9 },
  addButton: { marginHorizontal: 14, marginTop: 7, minHeight: 62, borderRadius: radii.card, borderWidth: 1, borderStyle: "dashed", borderColor: colors.primary, backgroundColor: colors.primarySoft, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  addButtonIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primary, color: colors.headerText, fontSize: 22, lineHeight: 38, textAlign: "center" },
  addButtonBody: { flex: 1 }, addButtonTitle: { color: colors.primary, fontSize: 13, fontWeight: "900" }, addButtonHint: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 3 },
  autoSchedule: { alignSelf: "flex-start", marginHorizontal: 14, marginTop: 5, minHeight: 38, borderRadius: 11, paddingHorizontal: 12, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" },
  autoScheduleText: { color: colors.info, fontSize: 10, fontWeight: "900" },
  saveButton: { minHeight: 52, borderRadius: radii.inner, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  saveText: { color: colors.headerText, fontSize: 14, fontWeight: "900" },
  publishButton: { minHeight: 50, borderRadius: radii.inner, backgroundColor: colors.successBg, borderWidth: 1, borderColor: colors.successBorder, alignItems: "center", justifyContent: "center" },
  publishText: { color: colors.successDark, fontSize: 14, fontWeight: "900" },
  copyButton: { marginHorizontal: 14, marginTop: 10, minHeight: 62, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  copyTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  copyHint: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  disabled: { opacity: 0.38 },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  missingTitle: { color: colors.text, fontSize: 16, fontWeight: "900", textAlign: "center", marginBottom: 14 },
})
