import { useMemo, useState } from "react"
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { readFieldCache, writeFieldCache } from "../../../src/db/local-store"
import type { CreateFieldCustomerRequest, FieldCustomerRequest, FieldCustomerRequestsData } from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import { FieldDayNavigator } from "../../../src/field/FieldDayNavigator"
import { fieldErrorMessage } from "../../../src/field/error-message"
import { t, useLocale } from "../../../src/i18n"
import { formatCalendarDay } from "../../../src/i18n/date-format"
import { getCurrentDeviceLocation, type DeviceLocation } from "../../../src/location/device-location"
import { safeFieldBack } from "../../../src/navigation/safe-back"
import { colors, cardShadow, radii } from "../../../src/theme"
import { TabIcon } from "../../../src/components/TabIcon"
import { FieldScreenChrome } from "../../../src/components/FieldScreenChrome"
import { useResponsiveLayout } from "../../../src/layout/responsive"

const CACHE_KEY = "field.customer-requests"
const OBJECT_TYPES: CreateFieldCustomerRequest["objectType"][] = ["PHARMACY", "CLINIC", "DOCTOR", "STORE", "OTHER"]
const POTENTIALS: CreateFieldCustomerRequest["potential"][] = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"]
const CATEGORIES = ["A", "B", "C", "D"] as const

function duplicateReasonLabel(reason: string): string {
  if (reason === "SIMILAR_NAME") return t("duplicateReasonSimilarName")
  return t("duplicateReasonUnknown")
}

export default function NewCustomerRequestScreen() {
  const locale = useLocale()
  const field = useField()
  const layout = useResponsiveLayout()
  const insets = useSafeAreaInsets()
  const routeDays = useMemo(() => field.week?.days.map((day) => ({
    date: day.date,
    isToday: day.isToday,
    isWorkingDay: day.isWorkingDay,
    routes: day.routes.map((route) => ({ id: route.id, name: route.name, date: day.date })),
  })) ?? [], [field.week])
  const routes = useMemo(() => routeDays.flatMap((day) => day.routes), [routeDays])
  const [objectType, setObjectType] = useState<CreateFieldCustomerRequest["objectType"]>("CLINIC")
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [city, setCity] = useState("")
  const [district, setDistrict] = useState("")
  const [phone, setPhone] = useState("")
  const [contactPerson, setContactPerson] = useState("")
  const [category, setCategory] = useState<typeof CATEGORIES[number]>("A")
  const [potential, setPotential] = useState<CreateFieldCustomerRequest["potential"]>("UNKNOWN")
  const [reason, setReason] = useState("")
  const [agentComment, setAgentComment] = useState("")
  const [routeId, setRouteId] = useState<string | null>(null)
  const [routeDate, setRouteDate] = useState<string | null>(null)
  const [routePickerOpen, setRoutePickerOpen] = useState(false)
  const [location, setLocation] = useState<DeviceLocation | null>(null)
  const [locating, setLocating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<FieldCustomerRequest | null>(null)
  const selectedRoute = routes.find((route) => route.id === routeId) ?? null
  const effectiveRouteId = selectedRoute?.id ?? null
  const firstRouteDate = routeDays.find((day) => day.routes.length > 0)?.date ?? null
  const selectedRouteDate = selectedRoute?.date ?? routeDate ?? routeDays.find((day) => day.isToday && day.routes.length > 0)?.date ?? firstRouteDate
  const selectedRouteDateLabel = selectedRouteDate
    ? `${formatCalendarDay(selectedRouteDate, locale).weekday}, ${formatCalendarDay(selectedRouteDate, locale).date}`
    : t("optionalRoute")
  const selectedDateRoutes = selectedRouteDate ? routes.filter((route) => route.date === selectedRouteDate) : []
  const hasDraft = Boolean(
    name.trim() || address.trim() || city.trim() || district.trim() || phone.trim() || contactPerson.trim() ||
    reason.trim() || agentComment.trim() || effectiveRouteId || location || objectType !== "CLINIC" || category !== "A" || potential !== "UNKNOWN",
  )

  async function attachLocation() {
    setLocating(true)
    setError(null)
    try {
      const next = await getCurrentDeviceLocation()
      if (!next) setError(t("locationPermissionDenied"))
      else setLocation(next)
    } catch {
      setError(t("locationUnavailable"))
    } finally {
      setLocating(false)
    }
  }

  async function submit() {
    if (name.trim().length < 2 || reason.trim().length < 3) {
      setError(t("requestRequired"))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const next = await fieldApi.createCustomerRequest({
        routeId: effectiveRouteId,
        objectType,
        name: name.trim(),
        address: address.trim() || null,
        city: city.trim() || null,
        district: district.trim() || null,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        contactPerson: contactPerson.trim() || null,
        phone: phone.trim() || null,
        category,
        potential,
        reason: reason.trim(),
        agentComment: agentComment.trim() || null,
      })
      setCreated(next)
      const cached = readFieldCache<FieldCustomerRequestsData>(CACHE_KEY)
      const current = cached?.value.requests ?? []
      writeFieldCache(CACHE_KEY, { requests: [next, ...current.filter((item) => item.id !== next.id)] })
    } catch (cause) {
      setError(fieldErrorMessage(cause, "customerRequestFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  function goBack() {
    if (submitting || locating) return
    if (!hasDraft) {
      safeFieldBack("/(app)/customer-requests")
      return
    }
    Alert.alert(t("customerRequestDiscardTitle"), t("customerRequestDiscardBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("customerRequestDiscardConfirm"), style: "destructive", onPress: () => safeFieldBack("/(app)/customer-requests") },
    ])
  }

  if (created) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <FieldScreenChrome />
        <ScrollView contentContainerStyle={[styles.successScroll, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}>
          <View style={[styles.successContent, layout.isTablet && styles.successContentTablet]}>
          <View style={styles.successMark}><TabIcon name="check" color={colors.success} size={31} /></View>
          <Text style={styles.successTitle}>{t("requestSubmitted")}</Text>
          <Text style={styles.successName}>{created.name}</Text>
          <View style={styles.statusPill}><Text style={styles.statusText}>{t("requestStatus_SUBMITTED")}</Text></View>
          {created.duplicateCandidates.length > 0 ? (
            <View style={styles.duplicates}>
              <View style={styles.duplicateTitleRow}><TabIcon name="alert" color={colors.warning} size={18} /><Text style={styles.duplicateTitle}>{t("duplicateWarning")}</Text></View>
              <Text style={styles.duplicateHint}>{t("duplicateHint")}</Text>
              {created.duplicateCandidates.map((candidate) => (
                <View key={candidate.id} style={styles.candidate}>
                  <View style={styles.candidateBody}>
                    <Text style={styles.candidateName}>{candidate.name}</Text>
                    {candidate.address ? <Text style={styles.candidateAddress}>{candidate.address}</Text> : null}
                    <Text style={styles.candidateReason}>{candidate.reasons.map(duplicateReasonLabel).join(" · ") || t("duplicateReasonUnknown")}</Text>
                  </View>
                  <View style={styles.score}><Text style={styles.scoreText}>{candidate.score}%</Text></View>
                </View>
              ))}
            </View>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel={t("myCustomerRequests")} onPress={() => router.replace("/(app)/customer-requests" as never)} style={styles.doneButton}><Text style={styles.doneButtonText}>{t("myCustomerRequests")}</Text></Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <FieldScreenChrome />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 20) + 96 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.content, layout.isTablet && styles.contentTablet]}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("back")} accessibilityState={{ disabled: submitting || locating }} disabled={submitting || locating} onPress={goBack} style={[styles.back, (submitting || locating) && styles.pressed]}><TabIcon name="chevronLeft" color={colors.text} size={21} /></Pressable>
            <View style={styles.headerBody}><Text style={styles.eyebrow}>{t("tabWork").toUpperCase()}</Text><Text style={styles.title}>{t("newCustomerRequest")}</Text></View>
          </View>
          <Text style={styles.intro}>{t("newCustomerHint")}</Text>

          <FieldLabel label={t("objectType")} />
          <View style={styles.wrapChips}>
            {OBJECT_TYPES.map((value) => <ChoiceChip key={value} label={objectTypeLabel(value)} selected={objectType === value} onPress={() => setObjectType(value)} />)}
          </View>

          <View style={styles.formCard}>
            <Input label={t("customerName")} value={name} onChangeText={setName} required />
            <Input label={t("addressLabel")} value={address} onChangeText={setAddress} multiline />
            <View style={styles.twoColumns}><View style={styles.column}><Input label={t("cityLabel")} value={city} onChangeText={setCity} /></View><View style={styles.column}><Input label={t("districtLabel")} value={district} onChangeText={setDistrict} /></View></View>
            <Input label={t("phoneLabel")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <Input label={t("contactPersonLabel")} value={contactPerson} onChangeText={setContactPerson} />
          </View>

          <FieldLabel label={t("categoryLabel")} />
          <View style={styles.chips}>{CATEGORIES.map((value) => <ChoiceChip key={value} label={value} selected={category === value} onPress={() => setCategory(value)} />)}</View>
          <FieldLabel label={t("potentialLabel")} />
          <View style={styles.wrapChips}>{POTENTIALS.map((value) => <ChoiceChip key={value} label={potentialLabel(value)} selected={potential === value} onPress={() => setPotential(value)} />)}</View>

          {routes.length > 0 ? (
            <View style={styles.routePicker}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t("optionalRoute")}: ${selectedRoute ? selectedRoute.name ?? t("routes") : t("noRouteSelected")}`}
                accessibilityState={{ expanded: routePickerOpen }}
                onPress={() => setRoutePickerOpen((open) => !open)}
                style={({ pressed }) => [styles.routeSummary, pressed && styles.pressed]}
              >
                <View accessible={false} style={styles.routeSummaryIcon}><TabIcon name="route" color={colors.primary} size={20} /></View>
                <View style={styles.routeSummaryBody}>
                  <Text style={styles.routeSummaryLabel}>{t("optionalRoute")}</Text>
                  <Text numberOfLines={1} style={styles.routeSummaryValue}>{selectedRoute ? `${selectedRouteDateLabel} · ${selectedRoute.name ?? t("routes")}` : t("noRouteSelected")}</Text>
                </View>
                <View accessible={false} style={styles.routeSummaryChevron}><TabIcon name={routePickerOpen ? "chevronUp" : "chevronDown"} color={colors.primary} size={20} /></View>
              </Pressable>
              {routePickerOpen ? <View style={styles.routePickerContent}>
                <Text style={styles.routePickerHint}>{t("customerRequestRouteHint")}</Text>
                <FieldDayNavigator
                  days={routeDays.map((day) => ({
                    date: day.date,
                    isToday: day.isToday,
                    isWorkingDay: day.isWorkingDay,
                    disabled: day.routes.length === 0,
                    dotColor: day.routes.length > 0 ? colors.primary : undefined,
                    accessibilityLabel: `${formatCalendarDay(day.date, locale).weekday}, ${formatCalendarDay(day.date, locale).date}`,
                  }))}
                  selectedDate={selectedRouteDate}
                  onSelectDate={(date) => { setRouteDate(date); setRouteId(null) }}
                  currentLabel={selectedRouteDateLabel}
                  currentAccessibilityLabel={selectedRouteDateLabel}
                  calendarPicker
                  todayDate={field.week?.today}
                  compactDay
                  embedded
                  dayHint={t("customerRequestChooseRoute")}
                  isCalendarDateDisabled={(date) => !routeDays.some((day) => day.date === date && day.routes.length > 0)}
                />
                <Text style={styles.routeChoicesLabel}>{t("customerRequestChooseRoute")}</Text>
                <View style={styles.routeChoiceChips}>
                  <ChoiceChip label={t("noRouteSelected")} selected={effectiveRouteId === null} onPress={() => { setRouteId(null); setRoutePickerOpen(false) }} />
                  {selectedDateRoutes.map((route) => <ChoiceChip key={route.id} label={route.name ?? t("routes")} selected={effectiveRouteId === route.id} onPress={() => { setRouteId(route.id); setRouteDate(route.date); setRoutePickerOpen(false) }} />)}
                </View>
              </View> : null}
            </View>
          ) : null}

          <Pressable accessibilityRole="button" accessibilityLabel={location ? t("locationAttached") : t("useCurrentLocation")} disabled={locating} onPress={() => void attachLocation()} style={({ pressed }) => [styles.locationButton, pressed && styles.pressed]}>
            <View style={[styles.locationIcon, location && styles.locationIconDone]}><TabIcon name={location ? "check" : "location"} color={location ? colors.successDark : colors.info} size={21} /></View>
            <View style={styles.locationBody}><Text style={styles.locationTitle}>{locating ? t("locationLoading") : location ? t("locationAttached") : t("useCurrentLocation")}</Text>{location ? <Text style={styles.locationMeta}>{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}{location.accuracyM ? ` · ±${Math.round(location.accuracyM)}m` : ""}</Text> : null}</View>
          </Pressable>

          <View style={styles.formCard}>
            <Input label={t("requestReason")} value={reason} onChangeText={setReason} multiline required />
            <Input label={t("agentComment")} value={agentComment} onChangeText={setAgentComment} multiline />
          </View>
          </View>
        </ScrollView>
        <View style={[styles.submitTray, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={[styles.submitTrayContent, layout.isTablet && styles.submitTrayContentTablet]}>
            {error ? <View accessibilityRole="alert" style={styles.trayError}><Text style={styles.errorText}>{error}</Text></View> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={t("submitCustomerRequest")} accessibilityState={{ disabled: submitting, busy: submitting }} disabled={submitting} onPress={() => void submit()} style={({ pressed }) => [styles.submit, (pressed || submitting) && styles.pressed]}><Text style={styles.submitText}>{submitting ? "…" : t("submitCustomerRequest")}</Text></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function objectTypeLabel(value: CreateFieldCustomerRequest["objectType"]): string {
  if (value === "PHARMACY") return t("objectType_PHARMACY")
  if (value === "CLINIC") return t("objectType_CLINIC")
  if (value === "DOCTOR") return t("objectType_DOCTOR")
  if (value === "STORE") return t("objectType_STORE")
  return t("objectType_OTHER")
}

function potentialLabel(value: CreateFieldCustomerRequest["potential"]): string {
  if (value === "HIGH") return t("potential_HIGH")
  if (value === "MEDIUM") return t("potential_MEDIUM")
  if (value === "LOW") return t("potential_LOW")
  return t("potential_UNKNOWN")
}

function FieldLabel({ label }: { label: string }) { return <Text style={styles.fieldLabel}>{label}</Text> }
function ChoiceChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable> }
function Input({ label, required, multiline, ...props }: { label: string; required?: boolean; multiline?: boolean; value: string; onChangeText: (value: string) => void; keyboardType?: "default" | "phone-pad" }) { return <View style={styles.inputGroup}><Text style={styles.inputLabel}>{label}{required ? " *" : ""}</Text><TextInput {...props} accessibilityLabel={label} multiline={multiline} placeholderTextColor={colors.faint} style={[styles.input, multiline && styles.textarea]} textAlignVertical={multiline ? "top" : "center"} /></View> }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { paddingBottom: 34 },
  content: { width: "100%" },
  contentTablet: { maxWidth: 1_060, alignSelf: "center" },
  successScroll: { minHeight: "100%", padding: 20, alignItems: "center", justifyContent: "center" },
  successContent: { width: "100%" },
  successContentTablet: { maxWidth: 640, alignSelf: "center" },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  headerBody: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  intro: { color: colors.muted, fontSize: 13, lineHeight: 19, marginHorizontal: 16, marginTop: 12 },
  fieldLabel: { color: colors.text, fontSize: 14, fontWeight: "900", marginHorizontal: 16, marginTop: 18, marginBottom: 8 },
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: 14 },
  wrapChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14 },
  routeChoiceChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, borderRadius: radii.pill, paddingHorizontal: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  chipTextSelected: { color: colors.headerText },
  formCard: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, gap: 12, ...cardShadow },
  inputGroup: { flex: 1 },
  inputLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 },
  input: { minHeight: 46, borderRadius: radii.inner, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, color: colors.text, fontSize: 13 },
  textarea: { minHeight: 86, paddingTop: 12, lineHeight: 18 },
  twoColumns: { flexDirection: "row", gap: 10 },
  column: { flex: 1 },
  routePicker: { marginHorizontal: 14, marginTop: 18, borderRadius: radii.card, backgroundColor: colors.card, overflow: "hidden", ...cardShadow },
  routeSummary: { minHeight: 58, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  routeSummaryIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  routeSummaryBody: { flex: 1, minWidth: 0 },
  routeSummaryLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.35, textTransform: "uppercase" },
  routeSummaryValue: { color: colors.text, fontSize: 14, fontWeight: "900", marginTop: 2 },
  routeSummaryChevron: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  routePickerContent: { borderTopWidth: 1, borderTopColor: colors.border, padding: 12, gap: 10 },
  routePickerHint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  routeChoicesLabel: { color: colors.text, fontSize: 13, fontWeight: "900", marginTop: 2 },
  locationButton: { marginHorizontal: 14, marginTop: 18, minHeight: 68, borderRadius: radii.card, padding: 12, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: colors.border },
  locationIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" },
  locationIconDone: { backgroundColor: colors.successBg },
  locationBody: { flex: 1 },
  locationTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  locationMeta: { color: colors.successDark, fontSize: 11, fontWeight: "700", marginTop: 4 },
  submitTray: { paddingHorizontal: 14, paddingTop: 10, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, ...cardShadow },
  submitTrayContent: { width: "100%" },
  submitTrayContentTablet: { maxWidth: 1_060, alignSelf: "center" },
  trayError: { marginBottom: 8, borderRadius: radii.inner, padding: 10, backgroundColor: colors.dangerBg },
  errorText: { color: colors.missed, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  submit: { minHeight: 52, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  submitText: { color: colors.headerText, fontSize: 14, fontWeight: "900" },
  pressed: { opacity: 0.7 },
  successMark: { width: 70, height: 70, borderRadius: 24, backgroundColor: colors.successBg, alignItems: "center", justifyContent: "center" },
  successTitle: { color: colors.text, fontSize: 22, fontWeight: "900", textAlign: "center", marginTop: 18 },
  successName: { color: colors.muted, fontSize: 14, textAlign: "center", marginTop: 6 },
  statusPill: { marginTop: 12, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.primarySoft },
  statusText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  duplicates: { width: "100%", marginTop: 22, borderRadius: radii.card, padding: 14, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: colors.warningBorder },
  duplicateTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  duplicateTitle: { color: colors.warning, fontSize: 14, fontWeight: "900" },
  duplicateHint: { color: colors.warning, fontSize: 11, lineHeight: 16, marginTop: 4 },
  candidate: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.warningBorder, flexDirection: "row", alignItems: "center", gap: 10 },
  candidateBody: { flex: 1 },
  candidateName: { color: colors.text, fontSize: 13, fontWeight: "900" },
  candidateAddress: { color: colors.muted, fontSize: 11, marginTop: 3 },
  candidateReason: { color: colors.warning, fontSize: 11, fontWeight: "800", marginTop: 4 },
  score: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  scoreText: { color: colors.warning, fontSize: 11, fontWeight: "900" },
  doneButton: { width: "100%", minHeight: 52, marginTop: 20, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  doneButtonText: { color: colors.headerText, fontSize: 13, fontWeight: "900" },
})
