import { useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { useField } from "../../../src/field/field-context"
import { RouteTargetPicker, type RouteTarget } from "../../../src/field/route-target-picker"
import { t, useLocale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"

function reorder<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  if (!moved) return items
  next.splice(to, 0, moved)
  return next
}

export default function NewRouteScreen() {
  useLocale()
  const field = useField()
  const availableDays = field.week?.days ?? []
  const initialDate = availableDays.find((day) => day.isToday && day.routePlanningAllowed)?.date ?? availableDays.find((day) => day.routePlanningAllowed)?.date ?? null
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate)
  const [name, setName] = useState("")
  const [notes, setNotes] = useState("")
  const [targets, setTargets] = useState<RouteTarget[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const excluded = useMemo(() => new Set(targets.map((target) => target.key)), [targets])

  useEffect(() => {
    if (!selectedDate) {
      setSelectedDate(availableDays.find((day) => day.isToday && day.routePlanningAllowed)?.date ?? availableDays.find((day) => day.routePlanningAllowed)?.date ?? null)
    }
  }, [availableDays, selectedDate])

  async function create() {
    const agentId = field.profile?.agent.id
    if (!agentId || !selectedDate || targets.length === 0) {
      setError(t("routeCreateRequired"))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const route = await fieldApi.createRoute({
        agentId,
        date: `${selectedDate}T00:00:00.000Z`,
        name: name.trim() || null,
        notes: notes.trim() || null,
        points: targets.map((target) => ({
          customerId: target.customer.id,
          contactId: target.contact?.id ?? null,
          plannedTime: null,
        })),
      })
      if (field.week) await field.loadWeek(field.week.weekStart)
      router.replace(`/(app)/routes/${route.id}` as never)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("fieldDataError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
          <View style={styles.headerBody}><Text style={styles.eyebrow}>{t("routeHubTitle").toUpperCase()}</Text><Text style={styles.title}>{t("createRoute")}</Text></View>
        </View>

        <Text style={styles.sectionTitle}>{t("routeDate")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
          {availableDays.map((day) => {
            const selected = selectedDate === day.date
            const disabled = !day.routePlanningAllowed
            return (
              <Pressable key={day.date} disabled={disabled} onPress={() => setSelectedDate(day.date)} style={[styles.day, selected && styles.daySelected, disabled && styles.dayDisabled]}>
                <Text style={[styles.dayNumber, selected && styles.dayNumberSelected]}>{day.date.slice(8)}</Text>
                <Text style={[styles.dayMonth, selected && styles.dayMonthSelected]}>{day.date.slice(5, 7)}</Text>
                {!day.isWorkingDay ? <Text style={[styles.dayOff, selected && styles.dayMonthSelected]}>●</Text> : null}
              </Pressable>
            )
          })}
        </ScrollView>

        <View style={styles.card}>
          <Text style={styles.label}>{t("routeName")}</Text>
          <TextInput value={name} onChangeText={setName} style={styles.input} placeholder={t("createRoute")} placeholderTextColor={colors.faint} />
          <Text style={styles.label}>{t("routeNotes")}</Text>
          <TextInput value={notes} onChangeText={setNotes} style={[styles.input, styles.notes]} multiline textAlignVertical="top" placeholderTextColor={colors.faint} />
        </View>

        <View style={styles.pointsHeader}><Text style={styles.sectionTitleInline}>{t("routePointsLabel")}</Text><Text style={styles.count}>{targets.length}</Text></View>
        {targets.map((target, index) => (
          <View key={target.key} style={styles.targetCard}>
            <View style={styles.index}><Text style={styles.indexText}>{index + 1}</Text></View>
            <View style={styles.targetBody}>
              <Text style={styles.targetName}>{target.contact?.displayName ?? target.customer.name}</Text>
              <Text style={styles.targetMeta}>{target.contact ? `${target.contact.specialtyName ?? target.contact.type} · ${target.customer.name}` : target.customer.address ?? target.customer.city ?? target.customer.objectType}</Text>
            </View>
            <View style={styles.targetActions}>
              <Pressable disabled={index === 0} onPress={() => setTargets((current) => reorder(current, index, index - 1))} style={[styles.iconButton, index === 0 && styles.disabled]}><Text style={styles.iconText}>↑</Text></Pressable>
              <Pressable disabled={index === targets.length - 1} onPress={() => setTargets((current) => reorder(current, index, index + 1))} style={[styles.iconButton, index === targets.length - 1 && styles.disabled]}><Text style={styles.iconText}>↓</Text></Pressable>
              <Pressable onPress={() => setTargets((current) => current.filter((item) => item.key !== target.key))} style={[styles.iconButton, styles.remove]}><Text style={styles.removeText}>×</Text></Pressable>
            </View>
          </View>
        ))}

        {!pickerOpen ? (
          <Pressable onPress={() => setPickerOpen(true)} style={styles.addTarget}><Text style={styles.addTargetIcon}>＋</Text><View style={styles.addTargetBody}><Text style={styles.addTargetTitle}>{t("addStop")}</Text><Text style={styles.addTargetHint}>{t("chooseStop")}</Text></View></Pressable>
        ) : <RouteTargetPicker excluded={excluded} onSelect={(target) => { setTargets((current) => [...current, target]); setPickerOpen(false) }} onCancel={() => setPickerOpen(false)} />}

        {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
        <Pressable disabled={saving} onPress={() => void create()} style={[styles.submit, saving && styles.disabled]}><Text style={styles.submitText}>{saving ? "…" : t("createRoute")}</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { minHeight: "100%", paddingBottom: 34 }, header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 }, back: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }, backText: { color: colors.text, fontSize: 30, lineHeight: 31 }, headerBody: { flex: 1 }, eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 }, title: { color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 2 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "900", marginHorizontal: 16, marginTop: 20, marginBottom: 9 }, days: { paddingHorizontal: 14, gap: 8 }, day: { width: 57, height: 65, borderRadius: 16, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }, daySelected: { backgroundColor: colors.primary, borderColor: colors.primary }, dayDisabled: { opacity: 0.32 }, dayNumber: { color: colors.text, fontSize: 17, fontWeight: "900" }, dayNumberSelected: { color: colors.headerText }, dayMonth: { color: colors.muted, fontSize: 9, fontWeight: "800" }, dayMonthSelected: { color: colors.headerSubtext }, dayOff: { color: colors.holiday, fontSize: 8, marginTop: 2 },
  card: { marginHorizontal: 14, marginTop: 15, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, ...cardShadow }, label: { color: colors.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 5, marginBottom: 6 }, input: { minHeight: 46, borderRadius: radii.inner, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, color: colors.text, fontSize: 13 }, notes: { minHeight: 80, paddingTop: 11 },
  pointsHeader: { marginHorizontal: 16, marginTop: 20, marginBottom: 3, flexDirection: "row", alignItems: "center", gap: 7 }, sectionTitleInline: { color: colors.text, fontSize: 15, fontWeight: "900" }, count: { minWidth: 23, height: 23, borderRadius: 12, backgroundColor: colors.primarySoft, color: colors.primary, fontSize: 10, fontWeight: "900", lineHeight: 23, textAlign: "center" }, targetCard: { marginHorizontal: 14, marginTop: 9, minHeight: 70, borderRadius: radii.card, padding: 11, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: colors.border }, index: { width: 31, height: 31, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, indexText: { color: colors.primary, fontSize: 11, fontWeight: "900" }, targetBody: { flex: 1, minWidth: 0 }, targetName: { color: colors.text, fontSize: 12, fontWeight: "900" }, targetMeta: { color: colors.muted, fontSize: 9, lineHeight: 13, marginTop: 3 }, targetActions: { flexDirection: "row", gap: 4 }, iconButton: { width: 31, height: 31, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, iconText: { color: colors.primary, fontSize: 13, fontWeight: "900" }, remove: { backgroundColor: colors.missedBg }, removeText: { color: colors.missed, fontSize: 18, lineHeight: 19 },
  addTarget: { marginHorizontal: 14, marginTop: 9, minHeight: 64, borderRadius: radii.card, borderWidth: 1, borderStyle: "dashed", borderColor: colors.primary, backgroundColor: colors.primarySoft, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 }, addTargetIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primary, color: colors.headerText, fontSize: 22, lineHeight: 38, textAlign: "center" }, addTargetBody: { flex: 1 }, addTargetTitle: { color: colors.primary, fontSize: 13, fontWeight: "900" }, addTargetHint: { color: colors.muted, fontSize: 9, marginTop: 3 },
  error: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.inner, padding: 11, backgroundColor: colors.dangerBg }, errorText: { color: colors.missed, fontSize: 11, fontWeight: "800" }, submit: { marginHorizontal: 14, marginTop: 16, minHeight: 52, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, submitText: { color: colors.headerText, fontSize: 14, fontWeight: "900" }, disabled: { opacity: 0.38 },
})
