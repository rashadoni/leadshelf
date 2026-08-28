import { useCallback, useMemo, useState } from "react"
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router, useFocusEffect } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { cacheFieldHrm, enqueueFieldHrmCancel, enqueueFieldHrmRequest, readFieldHrm } from "../../../src/db/local-store"
import type { FieldHrmData, FieldHrmRequest, FieldHrmRequestType } from "../../../src/field/contracts"
import { t, useLocale } from "../../../src/i18n"
import { useField } from "../../../src/field/field-context"
import { dateKeyInTimezone, formatRouteTime, isChronologicalRouteTimeRange, routePlannedTime, shiftDateKey } from "../../../src/field/route-time"
import { useSync } from "../../../src/sync/sync-context"
import { colors, cardShadow, radii } from "../../../src/theme"

type HrmMode = "schedule" | "requests"

export default function HrmScreen() {
  const locale = useLocale()
  const field = useField()
  const { syncWorkforce } = useSync()
  const workforceEnabled = field.workforceEnabled
  const [data, setData] = useState<FieldHrmData | null>(readFieldHrm)
  const [mode, setMode] = useState<HrmMode>("schedule")
  const [formOpen, setFormOpen] = useState(false)
  const [type, setType] = useState<FieldHrmRequestType>("LEAVE")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [workdayId, setWorkdayId] = useState<string | null>(null)
  const [startTime, setStartTime] = useState("09:00")
  const [endTime, setEndTime] = useState("18:00")
  const [reason, setReason] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [clock, setClock] = useState(() => new Date())
  const copy = locale === "az" ? {
    eyebrow: "İŞ MƏRKƏZİ", title: "Qrafik və müraciətlər", hint: "İş günləri, məzuniyyət, yoxluq və vaxt düzəlişi bir ekranda.",
    schedule: "Qrafik", requests: "Müraciətlər", newRequest: "Yeni müraciət", working: "İş günü", dayOff: "İstirahət",
    hasRequest: "Müraciət var", noDays: "Qrafik hələ yüklənməyib", noRequests: "Hələ müraciət yoxdur",
    noRequestsHint: "Yeni müraciət internet olmadan da telefonda saxlanacaq.", leave: "Məzuniyyət", absence: "Yoxluq", correction: "Vaxt düzəlişi",
    period: "Tarixlər", from: "Başlanğıc", to: "Son", workday: "Düzəldiləcək iş günü", time: "Düzgün vaxt",
    unchanged: "Dəyişməz",
    reason: "Səbəb", reasonPlaceholder: "Qısa izah yazın…", submit: "Müraciəti saxla", cancel: "Bağla", cancelRequest: "Müraciəti ləğv et",
    required: "Tarixləri, səbəbi və düzəliş üçün iş gününü düzgün seçin.", queued: "Müraciət telefonda saxlanıldı və göndərmə növbəsinə əlavə edildi.",
    refreshError: "Qrafik yenilənmədi — telefondakı nüsxə göstərilir.", decision: "Qərar", pending: "Baxılır", approved: "Təsdiqlənib", rejected: "Rədd edilib", cancelled: "Ləğv edilib", sync: "Növbədə",
  } : {
    eyebrow: "РАБОЧИЙ ЦЕНТР", title: "График и заявки", hint: "Рабочие дни, отпуск, отсутствие и корректировка времени в одном экране.",
    schedule: "График", requests: "Мои заявки", newRequest: "Новая заявка", working: "Рабочий день", dayOff: "Выходной",
    hasRequest: "Есть заявка", noDays: "График пока не загружен", noRequests: "Заявок пока нет",
    noRequestsHint: "Новая заявка сохранится на телефоне даже без интернета.", leave: "Отпуск", absence: "Отсутствие", correction: "Корректировка времени",
    period: "Даты", from: "Начало", to: "Конец", workday: "Какой рабочий день исправить", time: "Правильное время",
    unchanged: "Без изменений",
    reason: "Причина", reasonPlaceholder: "Коротко объясните причину…", submit: "Сохранить заявку", cancel: "Закрыть", cancelRequest: "Отменить заявку",
    required: "Проверьте даты, причину и рабочий день для корректировки.", queued: "Заявка сохранена на телефоне и добавлена в очередь отправки.",
    refreshError: "График не обновился — показана копия с телефона.", decision: "Решение", pending: "На рассмотрении", approved: "Одобрено", rejected: "Отклонено", cancelled: "Отменено", sync: "В очереди",
  }

  const timezone = data?.timezone ?? field.bootstrap?.timezone ?? "UTC"
  const todayKey = useMemo(() => dateKeyInTimezone(clock, timezone), [clock, timezone])
  const upcomingDates = useMemo(
    () => Array.from({ length: 21 }, (_, index) => shiftDateKey(todayKey, index)),
    [todayKey],
  )
  const correctionDays = useMemo(() => data?.days.filter((day) => day.workday).slice(-20).reverse() ?? [], [data?.days])
  const load = useCallback(async (showWarning = false) => {
    if (!workforceEnabled) {
      setData(null)
      return
    }
    try {
      const rangeTimezone = readFieldHrm()?.timezone ?? field.bootstrap?.timezone ?? "UTC"
      const rangeToday = dateKeyInTimezone(new Date(), rangeTimezone)
      setData(cacheFieldHrm(await fieldApi.hrm(
        shiftDateKey(rangeToday, -14),
        shiftDateKey(rangeToday, 45),
      )))
      setWarning(null)
    } catch {
      setData(readFieldHrm())
      if (showWarning) setWarning(copy.refreshError)
    }
  }, [copy.refreshError, field.bootstrap?.timezone, workforceEnabled])

  useFocusEffect(useCallback(() => {
    if (!workforceEnabled) return
    setClock(new Date())
    const clockInterval = setInterval(() => setClock(new Date()), 60_000)
    setData(readFieldHrm())
    void load(false)
    return () => clearInterval(clockInterval)
  }, [load, workforceEnabled]))

  async function refresh() { setRefreshing(true); await load(true); setRefreshing(false) }

  function openRequestForm() {
    const tomorrow = shiftDateKey(todayKey, 1)
    setType("LEAVE")
    setStartDate(tomorrow)
    setEndDate(tomorrow)
    setWorkdayId(null)
    setWarning(null)
    setFormOpen(true)
  }

  function selectType(next: FieldHrmRequestType) {
    setType(next)
    if (next === "TIME_CORRECTION") {
      const first = correctionDays[0]
      if (first?.workday) {
        setStartDate(first.date)
        setEndDate(first.date)
        setWorkdayId(first.workday.id)
        setStartTime("")
        setEndTime("")
      }
    } else setWorkdayId(null)
  }

  async function submit() {
    if (!workforceEnabled) return
    const normalizedReason = reason.trim()
    const requestedStartAt = type === "TIME_CORRECTION" ? routePlannedTime(startDate, startTime, timezone) : null
    const requestedEndAt = type === "TIME_CORRECTION" ? routePlannedTime(startDate, endTime, timezone) : null
    const correctionDay = correctionDays.find((day) => day.workday?.id === workdayId)
    const invalidCorrectionInput = Boolean(
      (startTime.trim() && !requestedStartAt) || (endTime.trim() && !requestedEndAt),
    )
    const effectiveStartAt = requestedStartAt ?? correctionDay?.workday?.startedAt ?? null
    const effectiveEndAt = requestedEndAt ?? correctionDay?.workday?.completedAt ?? null
    const invalidCorrectionRange = Boolean(
      effectiveEndAt && !isChronologicalRouteTimeRange(effectiveStartAt, effectiveEndAt),
    )
    const hasCorrection = Boolean(requestedStartAt || requestedEndAt)
    if (!normalizedReason || normalizedReason.length < 3 || endDate < startDate || (type === "TIME_CORRECTION" && (!workdayId || !hasCorrection || invalidCorrectionInput || invalidCorrectionRange))) {
      setWarning(copy.required)
      return
    }
    setBusy(true)
    try {
      enqueueFieldHrmRequest({
        type,
        startDate,
        endDate: type === "TIME_CORRECTION" ? startDate : endDate,
        correctionWorkdayId: type === "TIME_CORRECTION" ? workdayId : null,
        requestedStartAt,
        requestedEndAt,
        reason: normalizedReason,
      })
      setData(readFieldHrm())
      setFormOpen(false)
      setMode("requests")
      setReason("")
      setWarning(null)
      Alert.alert(copy.title, copy.queued)
      void syncWorkforce().then(() => load(false)).catch(() => {})
    } catch (cause) {
      setWarning(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  function cancelRequest(request: FieldHrmRequest) {
    if (!workforceEnabled) return
    enqueueFieldHrmCancel(request.id)
    setData(readFieldHrm())
    void syncWorkforce().then(() => load(false)).catch(() => {})
  }

  const selectedCorrectionDay = correctionDays.find((day) => day.workday?.id === workdayId)
  const currentStartTime = formatRouteTime(selectedCorrectionDay?.workday?.startedAt ?? null, timezone)
  const currentEndTime = formatRouteTime(selectedCorrectionDay?.workday?.completedAt ?? null, timezone)

  if (!workforceEnabled) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.back}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
        </View>
        <View style={styles.unavailable} accessibilityRole="alert">
          <Text style={styles.unavailableTitle}>{t("workforceUnavailableTitle")}</Text>
          <Text style={styles.unavailableBody}>{t("workforceUnavailableBody")}</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
          <View style={styles.headerBody}><Text style={styles.eyebrow}>{copy.eyebrow}</Text><Text style={styles.title}>{copy.title}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={copy.newRequest} onPress={openRequestForm} style={styles.newButton}><Text style={styles.newPlus}>＋</Text><Text style={styles.newText}>{copy.newRequest}</Text></Pressable>
        </View>
        <Text style={styles.intro}>{copy.hint}</Text>

        <View style={styles.segment}>
          <Segment label={copy.schedule} selected={mode === "schedule"} onPress={() => setMode("schedule")} />
          <Segment label={copy.requests} selected={mode === "requests"} onPress={() => setMode("requests")} count={data?.requests.filter((request) => request.status === "PENDING").length ?? 0} />
        </View>

        {formOpen ? (
          <View style={styles.formCard}>
            <View style={styles.formHeader}><View><Text style={styles.formEyebrow}>{copy.newRequest.toUpperCase()}</Text><Text style={styles.formTitle}>{typeLabel(type, copy)}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={copy.cancel} onPress={() => setFormOpen(false)} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable></View>
            <View style={styles.types}>
              <TypeButton label={copy.leave} glyph="☀" selected={type === "LEAVE"} onPress={() => selectType("LEAVE")} />
              <TypeButton label={copy.absence} glyph="◷" selected={type === "ABSENCE"} onPress={() => selectType("ABSENCE")} />
              <TypeButton label={copy.correction} glyph="↻" selected={type === "TIME_CORRECTION"} onPress={() => selectType("TIME_CORRECTION")} />
            </View>

            {type === "TIME_CORRECTION" ? (
              <>
                <Text style={styles.label}>{copy.workday}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateStrip}>
                  {correctionDays.map((day) => <DateChoice key={day.date} date={day.date} selected={workdayId === day.workday?.id} locale={locale} onPress={() => { setWorkdayId(day.workday?.id ?? null); setStartDate(day.date); setEndDate(day.date); setStartTime(""); setEndTime("") }} />)}
                </ScrollView>
                <Text style={styles.label}>{copy.time}</Text>
                <View style={styles.timeRow}><TimeInput label={copy.from} value={startTime} placeholder={currentStartTime || copy.unchanged} onChange={setStartTime} /><Text style={styles.timeArrow}>→</Text><TimeInput label={copy.to} value={endTime} placeholder={currentEndTime || copy.unchanged} onChange={setEndTime} /></View>
              </>
            ) : (
              <>
                <Text style={styles.label}>{copy.period}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateStrip}>
                  {upcomingDates.map((date) => <DateChoice key={date} date={date} selected={startDate === date} locale={locale} onPress={() => { setStartDate(date); if (endDate < date) setEndDate(date) }} />)}
                </ScrollView>
                <View style={styles.rangeLine}><Text style={styles.rangeText}>{copy.from}: {startDate}</Text><Text style={styles.rangeArrow}>→</Text><Text style={styles.rangeText}>{copy.to}: {endDate}</Text></View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.endDates}>
                  {upcomingDates.filter((date) => date >= startDate).slice(0, 14).map((date) => <Pressable key={date} accessibilityRole="button" accessibilityLabel={`${copy.to}: ${date}`} accessibilityState={{ selected: endDate === date }} onPress={() => setEndDate(date)} style={[styles.endDate, endDate === date && styles.endDateSelected]}><Text style={[styles.endDateText, endDate === date && styles.endDateTextSelected]}>{date.slice(5)}</Text></Pressable>)}
                </ScrollView>
              </>
            )}

            <Text style={styles.label}>{copy.reason}</Text>
            <TextInput accessibilityLabel={copy.reason} value={reason} onChangeText={setReason} multiline maxLength={1000} textAlignVertical="top" placeholder={copy.reasonPlaceholder} placeholderTextColor={colors.faint} style={styles.reasonInput} />
            <View style={styles.formActions}><Pressable accessibilityRole="button" accessibilityLabel={copy.cancel} onPress={() => setFormOpen(false)} style={styles.formCancel}><Text style={styles.formCancelText}>{copy.cancel}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={copy.submit} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void submit()} style={styles.formSubmit}><Text style={styles.formSubmitText}>{busy ? "…" : copy.submit}</Text></Pressable></View>
          </View>
        ) : null}

        {warning ? <View accessibilityRole="alert" style={styles.warning}><Text style={styles.warningText}>{warning}</Text></View> : null}

        {mode === "schedule" ? (
          !data || data.days.length === 0 ? <Empty title={copy.noDays} hint={copy.hint} /> : <>
            <View style={styles.legend}><Legend color={colors.success} label={copy.working} /><Legend color={colors.holiday} label={copy.dayOff} /><Legend color={colors.warning} label={copy.hasRequest} /></View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.calendarStrip}>
              {data.days.filter((day) => day.date >= shiftDateKey(todayKey, -2)).slice(0, 35).map((day) => {
                const request = day.requests.find((item) => item.status !== "CANCELLED")
                const tone = request ? "request" : day.calendar.isWorkingDay ? "working" : "off"
                return <View key={day.date} style={[styles.dayCard, tone === "request" ? styles.dayRequest : tone === "working" ? styles.dayWorking : styles.dayOff]}><Text style={styles.dayWeek}>{new Date(`${day.date}T12:00:00`).toLocaleDateString(locale === "az" ? "az-AZ" : "ru-RU", { weekday: "short" }).toUpperCase()}</Text><Text style={styles.dayNumber}>{day.date.slice(-2)}</Text><Text style={styles.dayMonth}>{new Date(`${day.date}T12:00:00`).toLocaleDateString(locale === "az" ? "az-AZ" : "ru-RU", { month: "short" })}</Text><View style={[styles.dayDot, { backgroundColor: tone === "request" ? colors.warning : tone === "working" ? colors.success : colors.holiday }]} /></View>
              })}
            </ScrollView>
            <View style={styles.scheduleList}>
              {data.days.filter((day) => day.date >= todayKey).slice(0, 14).map((day) => <View key={day.date} style={styles.scheduleRow}><View style={[styles.scheduleMark, { backgroundColor: day.requests.length > 0 ? colors.warningBg : day.calendar.isWorkingDay ? colors.successBg : colors.holidayBg }]}><Text style={[styles.scheduleMarkText, { color: day.requests.length > 0 ? colors.warning : day.calendar.isWorkingDay ? colors.successDark : colors.holiday }]}>{day.requests.length > 0 ? "!" : day.calendar.isWorkingDay ? "✓" : "—"}</Text></View><View style={styles.scheduleBody}><Text style={styles.scheduleDate}>{new Date(`${day.date}T12:00:00`).toLocaleDateString(locale === "az" ? "az-AZ" : "ru-RU", { weekday: "long", day: "numeric", month: "long" })}</Text><Text style={styles.scheduleMeta}>{day.requests.length > 0 ? typeLabel(day.requests[0]!.type, copy) : day.calendar.name || (day.calendar.isWorkingDay ? copy.working : copy.dayOff)}</Text></View>{day.workday ? <View style={styles.workdayPill}><Text style={styles.workdayPillText}>{day.workday.status}</Text></View> : null}</View>)}
            </View>
          </>
        ) : (
          !data || data.requests.length === 0 ? <Empty title={copy.noRequests} hint={copy.noRequestsHint} /> : data.requests.map((request) => <RequestCard key={request.id} request={request} locale={locale} timezone={timezone} copy={copy} onCancel={() => cancelRequest(request)} />)
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function typeLabel(type: FieldHrmRequestType, copy: { leave: string; absence: string; correction: string }) { return type === "LEAVE" ? copy.leave : type === "ABSENCE" ? copy.absence : copy.correction }
function Segment({ label, selected, onPress, count = 0 }: { label: string; selected: boolean; onPress: () => void; count?: number }) { return <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.segmentButton, selected && styles.segmentSelected]}><Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{label}</Text>{count > 0 ? <View style={styles.segmentCount}><Text style={styles.segmentCountText}>{count}</Text></View> : null}</Pressable> }
function TypeButton({ label, glyph, selected, onPress }: { label: string; glyph: string; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.typeButton, selected && styles.typeSelected]}><Text style={[styles.typeGlyph, selected && styles.typeTextSelected]}>{glyph}</Text><Text style={[styles.typeText, selected && styles.typeTextSelected]} numberOfLines={2}>{label}</Text></Pressable> }
function DateChoice({ date, selected, locale, onPress }: { date: string; selected: boolean; locale: string; onPress: () => void }) { const value = new Date(`${date}T12:00:00`); return <Pressable accessibilityRole="button" accessibilityLabel={value.toLocaleDateString(locale === "az" ? "az-AZ" : "ru-RU", { weekday: "long", day: "numeric", month: "long" })} accessibilityState={{ selected }} onPress={onPress} style={[styles.dateChoice, selected && styles.dateChoiceSelected]}><Text style={[styles.dateWeek, selected && styles.dateTextSelected]}>{value.toLocaleDateString(locale === "az" ? "az-AZ" : "ru-RU", { weekday: "short" })}</Text><Text style={[styles.dateNumber, selected && styles.dateTextSelected]}>{date.slice(-2)}</Text><Text style={[styles.dateMonth, selected && styles.dateTextSelected]}>{value.toLocaleDateString(locale === "az" ? "az-AZ" : "ru-RU", { month: "short" })}</Text></Pressable> }
function TimeInput({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) { return <View style={styles.timeInputWrap}><Text style={styles.timeLabel}>{label}</Text><TextInput accessibilityLabel={label} value={value} placeholder={placeholder} placeholderTextColor={colors.faint} onChangeText={onChange} keyboardType="numbers-and-punctuation" maxLength={5} style={styles.timeInput} /></View> }
function Legend({ color, label }: { color: string; label: string }) { return <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text></View> }
function Empty({ title, hint }: { title: string; hint: string }) { return <View style={styles.empty}><View style={styles.emptyMark}><Text style={styles.emptyMarkText}>◷</Text></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyHint}>{hint}</Text></View> }

function localeTag(locale: string): string {
  return locale === "az" ? "az-AZ" : "ru-RU"
}

function formatRequestDate(value: string, locale: string): string {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(localeTag(locale))
}

function formatRequestSubmittedAt(value: string, locale: string, timezone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }
  try {
    return new Intl.DateTimeFormat(localeTag(locale), options).format(new Date(value))
  } catch {
    return new Intl.DateTimeFormat(localeTag(locale), { ...options, timeZone: "UTC" }).format(new Date(value))
  }
}

function RequestCard({ request, locale, timezone, copy, onCancel }: { request: FieldHrmRequest; locale: string; timezone: string; copy: Record<string, string>; onCancel: () => void }) {
  const palette = request.status === "APPROVED" ? { bg: colors.successBg, color: colors.successDark, label: copy.approved } : request.status === "REJECTED" ? { bg: colors.dangerBg, color: colors.missed, label: copy.rejected } : request.status === "CANCELLED" ? { bg: colors.draftBg, color: colors.draft, label: copy.cancelled } : { bg: colors.warningBg, color: colors.warning, label: copy.pending }
  const submittedAt = formatRequestSubmittedAt(request.submittedAt, locale, timezone)
  return (
    <View style={styles.requestCard}>
      <View style={styles.requestTop}>
        <View style={[styles.requestIcon, { backgroundColor: palette.bg }]}><Text style={[styles.requestIconText, { color: palette.color }]}>{request.type === "LEAVE" ? "☀" : request.type === "ABSENCE" ? "◷" : "↻"}</Text></View>
        <View style={styles.requestBody}>
          <Text style={styles.requestTitle}>{typeLabel(request.type, copy as never)}</Text>
          <Text style={styles.requestDates}>{formatRequestDate(request.startDate, locale)} — {formatRequestDate(request.endDate, locale)}</Text>
        </View>
        <View style={[styles.status, { backgroundColor: palette.bg }]}><Text style={[styles.statusText, { color: palette.color }]}>{palette.label}</Text></View>
      </View>
      <Text style={styles.requestReason}>{request.reason}</Text>
      {request.decisionNote ? <View style={styles.decision}><Text style={styles.decisionLabel}>{copy.decision}</Text><Text style={styles.decisionText}>{request.decisionNote}</Text></View> : null}
      <View style={styles.requestFooter}>
        {request.syncState ? <Text style={styles.syncState}>↻ {copy.sync}</Text> : <Text style={styles.submitted}>{submittedAt}</Text>}
        {request.status === "PENDING" ? <Pressable accessibilityRole="button" accessibilityLabel={copy.cancelRequest} onPress={onCancel} style={styles.cancelRequest}><Text style={styles.cancelRequestText}>{copy.cancelRequest}</Text></Pressable> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { paddingBottom: 36 }, header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 }, back: { width: 48, height: 48, borderRadius: 15, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }, backText: { color: colors.text, fontSize: 31, lineHeight: 32 }, headerBody: { flex: 1, minWidth: 0 }, eyebrow: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 0.9 }, title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 }, newButton: { minHeight: 48, borderRadius: 15, paddingHorizontal: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, newPlus: { color: colors.headerText, fontSize: 17, lineHeight: 16 }, newText: { color: colors.headerText, fontSize: 10, fontWeight: "900", marginTop: 2 }, intro: { color: colors.muted, fontSize: 12, lineHeight: 18, marginHorizontal: 16, marginTop: 12 },
  unavailable: { margin: 16, borderRadius: radii.card, padding: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }, unavailableTitle: { color: colors.text, fontSize: 18, fontWeight: "900" }, unavailableBody: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 7 },
  segment: { marginHorizontal: 14, marginTop: 16, borderRadius: 16, padding: 4, backgroundColor: "#E9E9EE", flexDirection: "row", gap: 4 }, segmentButton: { flex: 1, minHeight: 48, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, segmentSelected: { backgroundColor: colors.card, ...cardShadow }, segmentText: { color: colors.muted, fontSize: 12, fontWeight: "900" }, segmentTextSelected: { color: colors.text }, segmentCount: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.warning, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }, segmentCountText: { color: colors.headerText, fontSize: 10, fontWeight: "900" },
  formCard: { marginHorizontal: 14, marginTop: 13, borderRadius: 22, padding: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.infoBorder, ...cardShadow }, formHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, formEyebrow: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 }, formTitle: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 3 }, close: { width: 48, height: 48, borderRadius: 15, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }, closeText: { color: colors.muted, fontSize: 24, lineHeight: 25 }, types: { flexDirection: "row", gap: 7, marginTop: 13 }, typeButton: { flex: 1, minHeight: 80, borderRadius: 16, padding: 7, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }, typeSelected: { backgroundColor: colors.primary, borderColor: colors.primary }, typeGlyph: { color: colors.primary, fontSize: 18, fontWeight: "900" }, typeText: { color: colors.muted, fontSize: 10, lineHeight: 13, fontWeight: "900", textAlign: "center", marginTop: 5 }, typeTextSelected: { color: colors.headerText }, label: { color: colors.text, fontSize: 12, fontWeight: "900", marginTop: 16, marginBottom: 8 }, dateStrip: { gap: 7 }, dateChoice: { width: 62, height: 76, borderRadius: 16, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }, dateChoiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary }, dateWeek: { color: colors.muted, fontSize: 10, fontWeight: "900", textTransform: "uppercase" }, dateNumber: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 2 }, dateMonth: { color: colors.muted, fontSize: 10, fontWeight: "700", marginTop: 1 }, dateTextSelected: { color: colors.headerText }, rangeLine: { minHeight: 44, marginTop: 9, borderRadius: 12, backgroundColor: colors.primarySoft, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, rangeText: { color: colors.primary, fontSize: 10, fontWeight: "900" }, rangeArrow: { color: colors.primary, fontSize: 15 }, endDates: { gap: 6, marginTop: 8 }, endDate: { minHeight: 48, borderRadius: 11, paddingHorizontal: 12, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }, endDateSelected: { backgroundColor: colors.text }, endDateText: { color: colors.muted, fontSize: 11, fontWeight: "900" }, endDateTextSelected: { color: colors.headerText }, timeRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 }, timeInputWrap: { flex: 1 }, timeLabel: { color: colors.muted, fontSize: 11, fontWeight: "900", marginBottom: 5 }, timeInput: { minHeight: 48, borderRadius: 13, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 14, fontWeight: "900", textAlign: "center" }, timeArrow: { color: colors.faint, fontSize: 18, marginBottom: 12 }, reasonInput: { minHeight: 96, borderRadius: 14, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, padding: 11, color: colors.text, fontSize: 13, lineHeight: 19 }, formActions: { flexDirection: "row", gap: 8, marginTop: 13 }, formCancel: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }, formCancelText: { color: colors.muted, fontSize: 12, fontWeight: "900" }, formSubmit: { flex: 2, minHeight: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, formSubmitText: { color: colors.headerText, fontSize: 12, fontWeight: "900" },
  warning: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.inner, padding: 12, backgroundColor: colors.warningBg }, warningText: { color: colors.warning, fontSize: 11, lineHeight: 16, fontWeight: "800" }, legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 16, marginTop: 16 }, legendItem: { flexDirection: "row", alignItems: "center", gap: 5 }, legendDot: { width: 7, height: 7, borderRadius: 4 }, legendText: { color: colors.muted, fontSize: 10, fontWeight: "800" }, calendarStrip: { gap: 8, paddingHorizontal: 14, paddingTop: 11 }, dayCard: { width: 68, height: 96, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1 }, dayWorking: { backgroundColor: colors.card, borderColor: colors.successBorder }, dayOff: { backgroundColor: colors.holidayBg, borderColor: colors.holidayBorder }, dayRequest: { backgroundColor: colors.warningBg, borderColor: "#F4D37A" }, dayWeek: { color: colors.muted, fontSize: 10, fontWeight: "900" }, dayNumber: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 3 }, dayMonth: { color: colors.muted, fontSize: 10, marginTop: 1 }, dayDot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 }, scheduleList: { marginTop: 14 }, scheduleRow: { minHeight: 72, marginHorizontal: 14, marginTop: 8, borderRadius: 17, padding: 10, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 10, ...cardShadow }, scheduleMark: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" }, scheduleMarkText: { fontSize: 15, fontWeight: "900" }, scheduleBody: { flex: 1 }, scheduleDate: { color: colors.text, fontSize: 12, fontWeight: "900", textTransform: "capitalize" }, scheduleMeta: { color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 4 }, workdayPill: { borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: colors.successBg }, workdayPillText: { color: colors.successDark, fontSize: 9, fontWeight: "900" },
  requestCard: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, ...cardShadow }, requestTop: { flexDirection: "row", alignItems: "center", gap: 10 }, requestIcon: { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" }, requestIconText: { fontSize: 17, fontWeight: "900" }, requestBody: { flex: 1 }, requestTitle: { color: colors.text, fontSize: 14, fontWeight: "900" }, requestDates: { color: colors.muted, fontSize: 11, marginTop: 4 }, status: { maxWidth: 106, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 7 }, statusText: { fontSize: 10, fontWeight: "900", textAlign: "center" }, requestReason: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 11 }, decision: { marginTop: 10, borderRadius: 12, padding: 10, backgroundColor: colors.bg }, decisionLabel: { color: colors.faint, fontSize: 10, fontWeight: "900", textTransform: "uppercase" }, decisionText: { color: colors.text, fontSize: 11, lineHeight: 16, marginTop: 4 }, requestFooter: { minHeight: 48, marginTop: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, syncState: { color: colors.info, fontSize: 10, fontWeight: "900" }, submitted: { color: colors.faint, fontSize: 10 }, cancelRequest: { minHeight: 48, borderRadius: 11, paddingHorizontal: 12, backgroundColor: colors.dangerBg, alignItems: "center", justifyContent: "center" }, cancelRequestText: { color: colors.missed, fontSize: 11, fontWeight: "900" },
  empty: { margin: 14, minHeight: 280, borderRadius: radii.card, padding: 24, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", ...cardShadow }, emptyMark: { width: 66, height: 66, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, emptyMarkText: { color: colors.primary, fontSize: 23, fontWeight: "900" }, emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "900", textAlign: "center", marginTop: 15 }, emptyHint: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 6 },
})
