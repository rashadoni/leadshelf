import { useMemo, useState } from "react"
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { readFieldCache, writeFieldCache } from "../../../src/db/local-store"
import type { CreateFieldCustomerRequest, FieldCustomerRequest, FieldCustomerRequestsData } from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import { t, useLocale } from "../../../src/i18n"
import { getCurrentDeviceLocation, type DeviceLocation } from "../../../src/location/device-location"
import { colors, cardShadow, radii } from "../../../src/theme"

const CACHE_KEY = "field.customer-requests"
const OBJECT_TYPES: CreateFieldCustomerRequest["objectType"][] = ["PHARMACY", "CLINIC", "DOCTOR", "STORE", "OTHER"]
const POTENTIALS: CreateFieldCustomerRequest["potential"][] = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"]
const CATEGORIES = ["A", "B", "C", "D"] as const

export default function NewCustomerRequestScreen() {
  useLocale()
  const field = useField()
  const routes = useMemo(() => field.week?.days.flatMap((day) => day.routes.map((route) => ({ id: route.id, name: route.name, date: day.date }))) ?? [], [field.week])
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
  const [location, setLocation] = useState<DeviceLocation | null>(null)
  const [locating, setLocating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<FieldCustomerRequest | null>(null)

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
        routeId,
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
      setError(cause instanceof Error ? cause.message : t("fieldDataError"))
    } finally {
      setSubmitting(false)
    }
  }

  if (created) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.successScroll}>
          <View style={styles.successMark}><Text style={styles.successMarkText}>✓</Text></View>
          <Text style={styles.successTitle}>{t("requestSubmitted")}</Text>
          <Text style={styles.successName}>{created.name}</Text>
          <View style={styles.statusPill}><Text style={styles.statusText}>{t("requestStatus_SUBMITTED")}</Text></View>
          {created.duplicateCandidates.length > 0 ? (
            <View style={styles.duplicates}>
              <Text style={styles.duplicateTitle}>⚠ {t("duplicateWarning")}</Text>
              <Text style={styles.duplicateHint}>{t("duplicateHint")}</Text>
              {created.duplicateCandidates.map((candidate) => (
                <View key={candidate.id} style={styles.candidate}>
                  <View style={styles.candidateBody}>
                    <Text style={styles.candidateName}>{candidate.name}</Text>
                    {candidate.address ? <Text style={styles.candidateAddress}>{candidate.address}</Text> : null}
                    <Text style={styles.candidateReason}>{candidate.reasons.join(" · ")}</Text>
                  </View>
                  <View style={styles.score}><Text style={styles.scoreText}>{candidate.score}%</Text></View>
                </View>
              ))}
            </View>
          ) : null}
          <Pressable onPress={() => router.replace("/(app)/customer-requests" as never)} style={styles.doneButton}><Text style={styles.doneButtonText}>{t("myCustomerRequests")}</Text></Pressable>
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
            <View style={styles.headerBody}><Text style={styles.eyebrow}>{t("tabWork").toUpperCase()}</Text><Text style={styles.title}>{t("newCustomerRequest")}</Text></View>
          </View>
          <Text style={styles.intro}>{t("newCustomerHint")}</Text>

          <FieldLabel label={t("objectType")} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {OBJECT_TYPES.map((value) => <ChoiceChip key={value} label={objectTypeLabel(value)} selected={objectType === value} onPress={() => setObjectType(value)} />)}
          </ScrollView>

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
            <>
              <FieldLabel label={t("optionalRoute")} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                <ChoiceChip label={t("noRouteSelected")} selected={routeId === null} onPress={() => setRouteId(null)} />
                {routes.map((route) => <ChoiceChip key={route.id} label={`${route.date.slice(5)} · ${route.name ?? t("routes")}`} selected={routeId === route.id} onPress={() => setRouteId(route.id)} />)}
              </ScrollView>
            </>
          ) : null}

          <Pressable disabled={locating} onPress={() => void attachLocation()} style={({ pressed }) => [styles.locationButton, pressed && styles.pressed]}>
            <View style={[styles.locationIcon, location && styles.locationIconDone]}><Text style={[styles.locationIconText, location && styles.locationIconTextDone]}>{location ? "✓" : "⌖"}</Text></View>
            <View style={styles.locationBody}><Text style={styles.locationTitle}>{locating ? t("locationLoading") : location ? t("locationAttached") : t("useCurrentLocation")}</Text>{location ? <Text style={styles.locationMeta}>{location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}{location.accuracyM ? ` · ±${Math.round(location.accuracyM)}m` : ""}</Text> : null}</View>
          </Pressable>

          <View style={styles.formCard}>
            <Input label={t("requestReason")} value={reason} onChangeText={setReason} multiline required />
            <Input label={t("agentComment")} value={agentComment} onChangeText={setAgentComment} multiline />
          </View>
          {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
          <Pressable disabled={submitting} onPress={() => void submit()} style={({ pressed }) => [styles.submit, (pressed || submitting) && styles.pressed]}><Text style={styles.submitText}>{submitting ? "…" : t("submitCustomerRequest")}</Text></Pressable>
        </ScrollView>
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
function ChoiceChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable> }
function Input({ label, required, multiline, ...props }: { label: string; required?: boolean; multiline?: boolean; value: string; onChangeText: (value: string) => void; keyboardType?: "default" | "phone-pad" }) { return <View style={styles.inputGroup}><Text style={styles.inputLabel}>{label}{required ? " *" : ""}</Text><TextInput {...props} multiline={multiline} placeholderTextColor={colors.faint} style={[styles.input, multiline && styles.textarea]} textAlignVertical={multiline ? "top" : "center"} /></View> }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, flex: { flex: 1 }, scroll: { paddingBottom: 34 }, successScroll: { minHeight: "100%", padding: 20, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 }, back: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }, backText: { color: colors.text, fontSize: 30, lineHeight: 31 }, headerBody: { flex: 1 }, eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 }, title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 }, intro: { color: colors.muted, fontSize: 12, lineHeight: 18, marginHorizontal: 16, marginTop: 12 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "900", marginHorizontal: 16, marginTop: 18, marginBottom: 8 }, chips: { flexDirection: "row", gap: 8, paddingHorizontal: 14 }, wrapChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14 }, chip: { minHeight: 38, borderRadius: radii.pill, paddingHorizontal: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }, chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary }, chipText: { color: colors.muted, fontSize: 11, fontWeight: "800" }, chipTextSelected: { color: colors.headerText },
  formCard: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, gap: 12, ...cardShadow }, inputGroup: { flex: 1 }, inputLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }, input: { minHeight: 46, borderRadius: radii.inner, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, color: colors.text, fontSize: 13 }, textarea: { minHeight: 86, paddingTop: 12, lineHeight: 18 }, twoColumns: { flexDirection: "row", gap: 10 }, column: { flex: 1 },
  locationButton: { marginHorizontal: 14, marginTop: 18, minHeight: 68, borderRadius: radii.card, padding: 12, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: colors.border }, locationIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" }, locationIconDone: { backgroundColor: colors.successBg }, locationIconText: { color: colors.info, fontSize: 21, fontWeight: "900" }, locationIconTextDone: { color: colors.successDark }, locationBody: { flex: 1 }, locationTitle: { color: colors.text, fontSize: 12, fontWeight: "900" }, locationMeta: { color: colors.successDark, fontSize: 10, fontWeight: "700", marginTop: 4 },
  error: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.inner, padding: 11, backgroundColor: colors.dangerBg }, errorText: { color: colors.missed, fontSize: 11, fontWeight: "800" }, submit: { marginHorizontal: 14, marginTop: 16, minHeight: 52, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, submitText: { color: colors.headerText, fontSize: 14, fontWeight: "900" }, pressed: { opacity: 0.7 },
  successMark: { width: 70, height: 70, borderRadius: 24, backgroundColor: colors.successBg, alignItems: "center", justifyContent: "center" }, successMarkText: { color: colors.success, fontSize: 32, fontWeight: "900" }, successTitle: { color: colors.text, fontSize: 22, fontWeight: "900", textAlign: "center", marginTop: 18 }, successName: { color: colors.muted, fontSize: 14, textAlign: "center", marginTop: 6 }, statusPill: { marginTop: 12, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.primarySoft }, statusText: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  duplicates: { width: "100%", marginTop: 22, borderRadius: radii.card, padding: 14, backgroundColor: colors.warningBg, borderWidth: 1, borderColor: "#F4D37A" }, duplicateTitle: { color: colors.warning, fontSize: 14, fontWeight: "900" }, duplicateHint: { color: colors.warning, fontSize: 10, lineHeight: 15, marginTop: 4 }, candidate: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F4D37A", flexDirection: "row", alignItems: "center", gap: 10 }, candidateBody: { flex: 1 }, candidateName: { color: colors.text, fontSize: 12, fontWeight: "900" }, candidateAddress: { color: colors.muted, fontSize: 9, marginTop: 3 }, candidateReason: { color: colors.warning, fontSize: 8, fontWeight: "800", marginTop: 4 }, score: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" }, scoreText: { color: colors.warning, fontSize: 11, fontWeight: "900" }, doneButton: { width: "100%", minHeight: 52, marginTop: 20, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, doneButtonText: { color: colors.headerText, fontSize: 13, fontWeight: "900" },
})
