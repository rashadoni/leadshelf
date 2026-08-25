import { useCallback, useMemo, useRef, useState } from "react"
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { cacheFieldHrm, enqueueFieldHrmCancel, enqueueFieldHrmRequest, readFieldHrm } from "../../../src/db/local-store"
import type { FieldHrmData, FieldHrmRequest, FieldHrmRequestType } from "../../../src/field/contracts"
import { fieldErrorMessage } from "../../../src/field/error-message"
import { workdayStatusLabel } from "../../../src/field/labels"
import { t, type Locale, useLocale } from "../../../src/i18n"
import {
  formatCalendarDay,
  formatCalendarMonthShort,
  formatCalendarWeekdayShort,
  formatShortDateTime,
} from "../../../src/i18n/date-format"
import { safeFieldBack } from "../../../src/navigation/safe-back"
import { useSync } from "../../../src/sync/sync-context"
import { colors, cardShadow, radii } from "../../../src/theme"
import { TabIcon, type TabIconName } from "../../../src/components/TabIcon"

type HrmMode = "schedule" | "requests"
type HrmRequestDraft = {
  type: FieldHrmRequestType
  startDate: string
  endDate: string
  workdayId: string | null
  startTime: string
  endTime: string
  reason: string
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function addDays(days: number): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

function dateTime(date: string, time: string): string | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const value = new Date(`${date}T${time}:00`)
  return Number.isNaN(value.getTime()) ? null : value.toISOString()
}

export default function HrmScreen() {
  const locale = useLocale()
  const { sync } = useSync()
  const [data, setData] = useState<FieldHrmData | null>(readFieldHrm)
  const [mode, setMode] = useState<HrmMode>("schedule")
  const [formOpen, setFormOpen] = useState(false)
  const [type, setType] = useState<FieldHrmRequestType>("LEAVE")
  const [startDate, setStartDate] = useState(addDays(1))
  const [endDate, setEndDate] = useState(addDays(1))
  const [workdayId, setWorkdayId] = useState<string | null>(null)
  const [startTime, setStartTime] = useState("09:00")
  const [endTime, setEndTime] = useState("18:00")
  const [reason, setReason] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const formBaseline = useRef<HrmRequestDraft | null>(null)
  const copy = locale === "az" ? {
    eyebrow: "İŞ MƏRKƏZİ", title: "Qrafik və müraciətlər", hint: "İş günləri, məzuniyyət, yoxluq və vaxt düzəlişi bir ekranda.",
    schedule: "Qrafik", requests: "Müraciətlər", newRequest: "Yeni müraciət", working: "İş günü", dayOff: "İstirahət",
    hasRequest: "Müraciət var", noDays: "Qrafik hələ yüklənməyib", noRequests: "Hələ müraciət yoxdur",
    noRequestsHint: "Yeni müraciət internet olmadan da telefonda saxlanacaq.", leave: "Məzuniyyət", absence: "Yoxluq", correction: "Vaxt düzəlişi",
    period: "Tarixlər", from: "Başlanğıc", to: "Son", workday: "Düzəldiləcək iş günü", time: "Düzgün vaxt",
    reason: "Səbəb", reasonPlaceholder: "Qısa izah yazın…", submit: "Müraciəti saxla", cancel: "Bağla", cancelRequest: "Müraciəti ləğv et",
    required: "Tarixləri, səbəbi və düzəliş üçün iş gününü düzgün seçin.", queued: "Müraciət telefonda saxlanıldı və göndərmə növbəsinə əlavə edildi.",
    refreshError: "Qrafik yenilənmədi — telefondakı nüsxə göstərilir.", decision: "Qərar", pending: "Baxılır", approved: "Təsdiqlənib", rejected: "Rədd edilib", cancelled: "Ləğv edilib", sync: "Növbədə",
    discardTitle: "Saxlanmamış müraciəti silmək?", discardBody: "Seçilmiş tarixlər, vaxtlar və səbəb yadda saxlanmayacaq.", discardConfirm: "Qaralamanı sil",
  } : {
    eyebrow: "РАБОЧИЙ ЦЕНТР", title: "График и заявки", hint: "Рабочие дни, отпуск, отсутствие и корректировка времени в одном экране.",
    schedule: "График", requests: "Мои заявки", newRequest: "Новая заявка", working: "Рабочий день", dayOff: "Выходной",
    hasRequest: "Есть заявка", noDays: "График пока не загружен", noRequests: "Заявок пока нет",
    noRequestsHint: "Новая заявка сохранится на телефоне даже без интернета.", leave: "Отпуск", absence: "Отсутствие", correction: "Корректировка времени",
    period: "Даты", from: "Начало", to: "Конец", workday: "Какой рабочий день исправить", time: "Правильное время",
    reason: "Причина", reasonPlaceholder: "Коротко объясните причину…", submit: "Сохранить заявку", cancel: "Закрыть", cancelRequest: "Отменить заявку",
    required: "Проверьте даты, причину и рабочий день для корректировки.", queued: "Заявка сохранена на телефоне и добавлена в очередь отправки.",
    refreshError: "График не обновился — показана копия с телефона.", decision: "Решение", pending: "На рассмотрении", approved: "Одобрено", rejected: "Отклонено", cancelled: "Отменено", sync: "В очереди",
    discardTitle: "Отменить несохранённую заявку?", discardBody: "Выбранные даты, время и причина не сохранятся.", discardConfirm: "Удалить черновик",
  }

  const upcomingDates = useMemo(() => Array.from({ length: 21 }, (_, index) => addDays(index)), [])
  const correctionDays = useMemo(() => data?.days.filter((day) => day.workday).slice(-20).reverse() ?? [], [data?.days])
  const currentDraft: HrmRequestDraft = { type, startDate, endDate, workdayId, startTime, endTime, reason }
  const isFormDirty = formOpen && formBaseline.current != null && (
    formBaseline.current.type !== currentDraft.type ||
    formBaseline.current.startDate !== currentDraft.startDate ||
    formBaseline.current.endDate !== currentDraft.endDate ||
    formBaseline.current.workdayId !== currentDraft.workdayId ||
    formBaseline.current.startTime !== currentDraft.startTime ||
    formBaseline.current.endTime !== currentDraft.endTime ||
    formBaseline.current.reason !== currentDraft.reason
  )
  const load = useCallback(async (showWarning = false) => {
    try {
      setData(cacheFieldHrm(await fieldApi.hrm(addDays(-14), addDays(45))))
      setWarning(null)
    } catch {
      setData(readFieldHrm())
      if (showWarning) setWarning(copy.refreshError)
    }
  }, [copy.refreshError])

  useFocusEffect(useCallback(() => { setData(readFieldHrm()); void load(false) }, [load]))

  async function refresh() { setRefreshing(true); await load(true); setRefreshing(false) }

  function openNewRequest() {
    const date = addDays(1)
    const baseline: HrmRequestDraft = {
      type: "LEAVE",
      startDate: date,
      endDate: date,
      workdayId: null,
      startTime: "09:00",
      endTime: "18:00",
      reason: "",
    }
    formBaseline.current = baseline
    setType(baseline.type)
    setStartDate(baseline.startDate)
    setEndDate(baseline.endDate)
    setWorkdayId(baseline.workdayId)
    setStartTime(baseline.startTime)
    setEndTime(baseline.endTime)
    setReason(baseline.reason)
    setWarning(null)
    setFormOpen(true)
  }

  function discardForm(onDiscard: () => void) {
    if (busy) return
    if (!isFormDirty) {
      formBaseline.current = null
      onDiscard()
      return
    }
    Alert.alert(copy.discardTitle, copy.discardBody, [
      { text: t("cancel"), style: "cancel" },
      { text: copy.discardConfirm, style: "destructive", onPress: () => {
        formBaseline.current = null
        onDiscard()
      } },
    ])
  }

  function closeForm() {
    discardForm(() => setFormOpen(false))
  }

  function goBack() {
    discardForm(() => safeFieldBack("/(app)/workday"))
  }

  function selectType(next: FieldHrmRequestType) {
    setType(next)
    if (next === "TIME_CORRECTION") {
      const first = correctionDays[0]
      if (first?.workday) {
        setStartDate(first.date)
        setEndDate(first.date)
        setWorkdayId(first.workday.id)
      }
    } else setWorkdayId(null)
  }

  async function submit() {
    const normalizedReason = reason.trim()
    const requestedStartAt = type === "TIME_CORRECTION" ? dateTime(startDate, startTime) : null
    const requestedEndAt = type === "TIME_CORRECTION" ? dateTime(startDate, endTime) : null
    if (!normalizedReason || normalizedReason.length < 3 || endDate < startDate || (type === "TIME_CORRECTION" && (!workdayId || (!requestedStartAt && !requestedEndAt)))) {
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
      formBaseline.current = null
      setMode("requests")
      setReason("")
      setWarning(null)
      Alert.alert(copy.title, copy.queued)
      void sync().then(() => load(false)).catch(() => {})
    } catch (cause) {
      setWarning(fieldErrorMessage(cause, "hrmActionFailed"))
    } finally {
      setBusy(false)
    }
  }

  function cancelRequest(request: FieldHrmRequest) {
    enqueueFieldHrmCancel(request.id)
    setData(readFieldHrm())
    void sync().then(() => load(false)).catch(() => {})
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} accessibilityState={{ disabled: busy }} disabled={busy} onPress={goBack} style={[styles.back, busy && styles.disabled]}>
            <TabIcon name="chevronLeft" color={colors.text} size={23} />
          </Pressable>
          <View style={styles.headerBody}><Text style={styles.eyebrow}>{copy.eyebrow}</Text><Text style={styles.title}>{copy.title}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={copy.newRequest} accessibilityState={{ disabled: busy || formOpen }} disabled={busy || formOpen} onPress={openNewRequest} style={[styles.newButton, (busy || formOpen) && styles.disabled]}>
            <TabIcon name="add" color={colors.headerText} size={18} />
            <Text style={styles.newText}>{copy.newRequest}</Text>
          </Pressable>
        </View>
        <Text style={styles.intro}>{copy.hint}</Text>

        <View style={styles.segment}>
          <Segment label={copy.schedule} selected={mode === "schedule"} onPress={() => setMode("schedule")} />
          <Segment label={copy.requests} selected={mode === "requests"} onPress={() => setMode("requests")} count={data?.requests.filter((request) => request.status === "PENDING").length ?? 0} />
        </View>

        {formOpen ? (
          <View style={styles.formCard}>
            <View style={styles.formHeader}>
              <View><Text style={styles.formEyebrow}>{copy.newRequest.toUpperCase()}</Text><Text style={styles.formTitle}>{typeLabel(type, copy)}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={copy.cancel} accessibilityState={{ disabled: busy }} disabled={busy} onPress={closeForm} style={[styles.close, busy && styles.disabled]}>
                <TabIcon name="close" color={colors.muted} size={21} />
              </Pressable>
            </View>
            <View style={styles.types}>
              <TypeButton label={copy.leave} icon="week" selected={type === "LEAVE"} onPress={() => selectType("LEAVE")} />
              <TypeButton label={copy.absence} icon="alert" selected={type === "ABSENCE"} onPress={() => selectType("ABSENCE")} />
              <TypeButton label={copy.correction} icon="refresh" selected={type === "TIME_CORRECTION"} onPress={() => selectType("TIME_CORRECTION")} />
            </View>

            {type === "TIME_CORRECTION" ? (
              <>
                <Text style={styles.label}>{copy.workday}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateStrip}>
                  {correctionDays.map((day) => <DateChoice key={day.date} date={day.date} selected={workdayId === day.workday?.id} locale={locale} onPress={() => { setWorkdayId(day.workday?.id ?? null); setStartDate(day.date); setEndDate(day.date) }} />)}
                </ScrollView>
                <Text style={styles.label}>{copy.time}</Text>
                <View style={styles.timeRow}><TimeInput label={copy.from} value={startTime} onChange={setStartTime} /><View accessible={false} style={styles.timeArrow}><TabIcon name="chevronRight" color={colors.faint} size={18} /></View><TimeInput label={copy.to} value={endTime} onChange={setEndTime} /></View>
              </>
            ) : (
              <>
                <Text style={styles.label}>{copy.period}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateStrip}>
                  {upcomingDates.map((date) => <DateChoice key={date} date={date} selected={startDate === date} locale={locale} onPress={() => { setStartDate(date); if (endDate < date) setEndDate(date) }} />)}
                </ScrollView>
                <View accessible accessibilityLabel={`${copy.from}: ${formatCalendarDay(startDate, locale).date}. ${copy.to}: ${formatCalendarDay(endDate, locale).date}`} style={styles.rangeLine}><Text style={styles.rangeText}>{copy.from}: {formatCalendarDay(startDate, locale).date}</Text><View accessible={false} style={styles.rangeArrow}><TabIcon name="chevronRight" color={colors.primary} size={16} /></View><Text style={styles.rangeText}>{copy.to}: {formatCalendarDay(endDate, locale).date}</Text></View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.endDates}>
                  {upcomingDates.filter((date) => date >= startDate).slice(0, 14).map((date) => <Pressable key={date} accessibilityRole="button" accessibilityLabel={`${copy.to}: ${formatCalendarDay(date, locale).weekday}, ${formatCalendarDay(date, locale).date}`} accessibilityState={{ selected: endDate === date }} onPress={() => setEndDate(date)} style={[styles.endDate, endDate === date && styles.endDateSelected]}><Text style={[styles.endDateText, endDate === date && styles.endDateTextSelected]}>{formatCalendarDay(date, locale).day}</Text></Pressable>)}
                </ScrollView>
              </>
            )}

            <Text style={styles.label}>{copy.reason}</Text>
            <TextInput accessibilityLabel={copy.reason} accessibilityHint={copy.reasonPlaceholder} value={reason} onChangeText={setReason} multiline maxLength={1000} textAlignVertical="top" placeholder={copy.reasonPlaceholder} placeholderTextColor={colors.faint} style={styles.reasonInput} />
            <View style={styles.formActions}>
              <Pressable accessibilityRole="button" accessibilityLabel={copy.cancel} accessibilityState={{ disabled: busy }} disabled={busy} onPress={closeForm} style={[styles.formCancel, busy && styles.disabled]}><Text style={styles.formCancelText}>{copy.cancel}</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={copy.submit} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => void submit()} style={[styles.formSubmit, busy && styles.disabled]}>
                {busy ? <TabIcon name="refresh" color={colors.headerText} size={17} /> : null}<Text style={styles.formSubmitText}>{copy.submit}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {warning ? <View accessibilityRole="alert" style={styles.warning}><View accessible={false}><TabIcon name="alert" color={colors.warning} size={17} /></View><Text style={styles.warningText}>{warning}</Text></View> : null}

        {mode === "schedule" ? (
          !data || data.days.length === 0 ? <Empty title={copy.noDays} hint={copy.hint} /> : <>
            <View style={styles.legend}><Legend color={colors.success} label={copy.working} /><Legend color={colors.holiday} label={copy.dayOff} /><Legend color={colors.warning} label={copy.hasRequest} /></View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.calendarStrip}>
              {data.days.filter((day) => day.date >= addDays(-2)).slice(0, 35).map((day) => {
                const request = day.requests.find((item) => item.status !== "CANCELLED")
                const tone = request ? "request" : day.calendar.isWorkingDay ? "working" : "off"
                const status = request ? typeLabel(request.type, copy) : day.calendar.name || (day.calendar.isWorkingDay ? copy.working : copy.dayOff)
                return (
                  <View key={day.date} accessible accessibilityRole="summary" accessibilityLabel={`${formatCalendarDay(day.date, locale).weekday}, ${formatCalendarDay(day.date, locale).date}. ${status}`} style={[styles.dayCard, tone === "request" ? styles.dayRequest : tone === "working" ? styles.dayWorking : styles.dayOff]}>
                    <Text style={styles.dayWeek}>{formatCalendarWeekdayShort(day.date, locale)}</Text>
                    <Text style={styles.dayNumber}>{formatCalendarDay(day.date, locale).day}</Text>
                    <Text style={styles.dayMonth}>{formatCalendarMonthShort(day.date, locale)}</Text>
                    <View style={[styles.dayDot, { backgroundColor: tone === "request" ? colors.warning : tone === "working" ? colors.success : colors.holiday }]} />
                  </View>
                )
              })}
            </ScrollView>
            <View style={styles.scheduleList}>
              {data.days.filter((day) => day.date >= addDays(0)).slice(0, 14).map((day) => {
                const request = day.requests.find((item) => item.status !== "CANCELLED")
                const status = request ? typeLabel(request.type, copy) : day.calendar.name || (day.calendar.isWorkingDay ? copy.working : copy.dayOff)
                const workday = day.workday ? `, ${workdayStatusLabel(day.workday.status)}` : ""
                return (
                  <View key={day.date} accessible accessibilityRole="summary" accessibilityLabel={`${formatCalendarDay(day.date, locale).weekday}, ${formatCalendarDay(day.date, locale).date}. ${status}${workday}`} style={styles.scheduleRow}>
                    <View accessible={false} style={[styles.scheduleMark, { backgroundColor: request ? colors.warningBg : day.calendar.isWorkingDay ? colors.successBg : colors.holidayBg }]}>
                      <TabIcon name={request ? "alert" : day.calendar.isWorkingDay ? "check" : "pause"} color={request ? colors.warning : day.calendar.isWorkingDay ? colors.successDark : colors.holiday} size={18} />
                    </View>
                    <View style={styles.scheduleBody}>
                      <Text style={styles.scheduleDate}>{formatCalendarDay(day.date, locale).weekday}, {formatCalendarDay(day.date, locale).date}</Text>
                      <Text style={styles.scheduleMeta}>{status}</Text>
                    </View>
                    {day.workday ? <View style={styles.workdayPill}><Text style={styles.workdayPillText}>{workdayStatusLabel(day.workday.status)}</Text></View> : null}
                  </View>
                )
              })}
            </View>
          </>
        ) : (
          !data || data.requests.length === 0 ? <Empty title={copy.noRequests} hint={copy.noRequestsHint} /> : data.requests.map((request) => <RequestCard key={request.id} request={request} locale={locale} copy={copy} onCancel={() => cancelRequest(request)} />)
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function typeLabel(type: FieldHrmRequestType, copy: { leave: string; absence: string; correction: string }) { return type === "LEAVE" ? copy.leave : type === "ABSENCE" ? copy.absence : copy.correction }
function typeIcon(type: FieldHrmRequestType): TabIconName { return type === "LEAVE" ? "week" : type === "ABSENCE" ? "alert" : "refresh" }
function Segment({ label, selected, onPress, count = 0 }: { label: string; selected: boolean; onPress: () => void; count?: number }) {
  return <Pressable accessibilityRole="tab" accessibilityLabel={count > 0 ? `${label}, ${count}` : label} accessibilityState={{ selected, disabled: false }} onPress={onPress} style={[styles.segmentButton, selected && styles.segmentSelected]}><Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{label}</Text>{count > 0 ? <View accessible={false} style={styles.segmentCount}><Text style={styles.segmentCountText}>{count}</Text></View> : null}</Pressable>
}
function TypeButton({ label, icon, selected, onPress }: { label: string; icon: TabIconName; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled: false }} onPress={onPress} style={[styles.typeButton, selected && styles.typeSelected]}><TabIcon name={icon} color={selected ? colors.headerText : colors.primary} size={20} /><Text style={[styles.typeText, selected && styles.typeTextSelected]} numberOfLines={2}>{label}</Text></Pressable>
}
function DateChoice({ date, selected, locale, onPress }: { date: string; selected: boolean; locale: Locale; onPress: () => void }) {
  const calendar = formatCalendarDay(date, locale)
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${calendar.weekday}, ${calendar.date}`} accessibilityState={{ selected, disabled: false }} onPress={onPress} style={[styles.dateChoice, selected && styles.dateChoiceSelected]}>
      <Text style={[styles.dateWeek, selected && styles.dateTextSelected]}>{formatCalendarWeekdayShort(date, locale)}</Text>
      <Text style={[styles.dateNumber, selected && styles.dateTextSelected]}>{calendar.day}</Text>
      <Text style={[styles.dateMonth, selected && styles.dateTextSelected]}>{formatCalendarMonthShort(date, locale)}</Text>
    </Pressable>
  )
}
function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <View style={styles.timeInputWrap}><Text style={styles.timeLabel}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} keyboardType="numbers-and-punctuation" maxLength={5} style={styles.timeInput} /></View> }
function Legend({ color, label }: { color: string; label: string }) { return <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text></View> }
function Empty({ title, hint }: { title: string; hint: string }) { return <View accessibilityRole="summary" accessibilityLabel={`${title}. ${hint}`} style={styles.empty}><View accessible={false} style={styles.emptyMark}><TabIcon name="week" color={colors.primary} size={25} /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyHint}>{hint}</Text></View> }

function RequestCard({ request, locale, copy, onCancel }: { request: FieldHrmRequest; locale: Locale; copy: Record<string, string>; onCancel: () => void }) {
  const palette = request.status === "APPROVED" ? { bg: colors.successBg, color: colors.successDark, label: copy.approved } : request.status === "REJECTED" ? { bg: colors.dangerBg, color: colors.missed, label: copy.rejected } : request.status === "CANCELLED" ? { bg: colors.draftBg, color: colors.draft, label: copy.cancelled } : { bg: colors.warningBg, color: colors.warning, label: copy.pending }
  return <View style={styles.requestCard}><View style={styles.requestTop}><View accessible={false} style={[styles.requestIcon, { backgroundColor: palette.bg }]}><TabIcon name={typeIcon(request.type)} color={palette.color} size={21} /></View><View style={styles.requestBody}><Text style={styles.requestTitle}>{typeLabel(request.type, copy as never)}</Text><Text style={styles.requestDates}>{formatCalendarDay(request.startDate, locale).date} — {formatCalendarDay(request.endDate, locale).date}</Text></View><View accessibilityLabel={palette.label} style={[styles.status, { backgroundColor: palette.bg }]}><Text style={[styles.statusText, { color: palette.color }]}>{palette.label}</Text></View></View><Text style={styles.requestReason}>{request.reason}</Text>{request.decisionNote ? <View style={styles.decision}><Text style={styles.decisionLabel}>{copy.decision}</Text><Text style={styles.decisionText}>{request.decisionNote}</Text></View> : null}<View style={styles.requestFooter}>{request.syncState ? <View accessibilityLabel={copy.sync} style={styles.syncState}><TabIcon name="refresh" color={colors.info} size={15} /><Text style={styles.syncStateText}>{copy.sync}</Text></View> : <Text style={styles.submitted}>{formatShortDateTime(request.submittedAt, locale)}</Text>}{request.status === "PENDING" ? <Pressable accessibilityRole="button" accessibilityLabel={copy.cancelRequest} accessibilityState={{ disabled: false }} onPress={onCancel} style={styles.cancelRequest}><Text style={styles.cancelRequestText}>{copy.cancelRequest}</Text></Pressable> : null}</View></View>
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { paddingBottom: 36 }, header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 }, back: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }, headerBody: { flex: 1, minWidth: 0 }, eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.9 }, title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 }, newButton: { minHeight: 47, borderRadius: 15, paddingHorizontal: 10, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", gap: 2 }, newText: { color: colors.headerText, fontSize: 8, fontWeight: "900" }, intro: { color: colors.muted, fontSize: 12, lineHeight: 18, marginHorizontal: 16, marginTop: 12 },
  segment: { marginHorizontal: 14, marginTop: 16, borderRadius: 16, padding: 4, backgroundColor: "#E9E9EE", flexDirection: "row", gap: 4 }, segmentButton: { flex: 1, minHeight: 44, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, segmentSelected: { backgroundColor: colors.card, ...cardShadow }, segmentText: { color: colors.muted, fontSize: 11, fontWeight: "900" }, segmentTextSelected: { color: colors.text }, segmentCount: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.warning, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }, segmentCountText: { color: colors.headerText, fontSize: 8, fontWeight: "900" },
  formCard: { marginHorizontal: 14, marginTop: 13, borderRadius: 22, padding: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.infoBorder, ...cardShadow }, formHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, formEyebrow: { color: colors.primary, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 }, formTitle: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 3 }, close: { width: 44, height: 44, borderRadius: 13, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }, types: { flexDirection: "row", gap: 7, marginTop: 13 }, typeButton: { flex: 1, minHeight: 75, borderRadius: 16, padding: 7, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }, typeSelected: { backgroundColor: colors.primary, borderColor: colors.primary }, typeText: { color: colors.muted, fontSize: 8, lineHeight: 11, fontWeight: "900", textAlign: "center", marginTop: 5 }, typeTextSelected: { color: colors.headerText }, label: { color: colors.text, fontSize: 11, fontWeight: "900", marginTop: 16, marginBottom: 8 }, dateStrip: { gap: 7 }, dateChoice: { width: 58, height: 72, borderRadius: 16, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }, dateChoiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary }, dateWeek: { color: colors.muted, fontSize: 8, fontWeight: "900", textTransform: "uppercase" }, dateNumber: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 2 }, dateMonth: { color: colors.muted, fontSize: 8, fontWeight: "700", marginTop: 1 }, dateTextSelected: { color: colors.headerText }, rangeLine: { minHeight: 40, marginTop: 9, borderRadius: 12, backgroundColor: colors.primarySoft, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, rangeText: { color: colors.primary, fontSize: 8, fontWeight: "900" }, rangeArrow: { width: 16, alignItems: "center", justifyContent: "center" }, endDates: { gap: 6, marginTop: 8 }, endDate: { minHeight: 44, borderRadius: 11, paddingHorizontal: 10, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }, endDateSelected: { backgroundColor: colors.text }, endDateText: { color: colors.muted, fontSize: 8, fontWeight: "900" }, endDateTextSelected: { color: colors.headerText }, timeRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 }, timeInputWrap: { flex: 1 }, timeLabel: { color: colors.muted, fontSize: 8, fontWeight: "900", marginBottom: 5 }, timeInput: { minHeight: 46, borderRadius: 13, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 13, fontWeight: "900", textAlign: "center" }, timeArrow: { width: 18, marginBottom: 13, alignItems: "center", justifyContent: "center" }, reasonInput: { minHeight: 85, borderRadius: 14, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, padding: 11, color: colors.text, fontSize: 11, lineHeight: 16 }, formActions: { flexDirection: "row", gap: 8, marginTop: 13 }, formCancel: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }, formCancelText: { color: colors.muted, fontSize: 10, fontWeight: "900" }, formSubmit: { flex: 2, minHeight: 46, borderRadius: 14, backgroundColor: colors.primary, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" }, formSubmitText: { color: colors.headerText, fontSize: 10, fontWeight: "900" }, disabled: { opacity: 0.62 },
  warning: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.inner, padding: 10, backgroundColor: colors.warningBg, flexDirection: "row", alignItems: "center", gap: 8 }, warningText: { color: colors.warning, flex: 1, fontSize: 9, lineHeight: 14, fontWeight: "800" }, legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 16, marginTop: 16 }, legendItem: { flexDirection: "row", alignItems: "center", gap: 5 }, legendDot: { width: 7, height: 7, borderRadius: 4 }, legendText: { color: colors.muted, fontSize: 8, fontWeight: "800" }, calendarStrip: { gap: 8, paddingHorizontal: 14, paddingTop: 11 }, dayCard: { width: 65, height: 92, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1 }, dayWorking: { backgroundColor: colors.card, borderColor: colors.successBorder }, dayOff: { backgroundColor: colors.holidayBg, borderColor: colors.holidayBorder }, dayRequest: { backgroundColor: colors.warningBg, borderColor: "#F4D37A" }, dayWeek: { color: colors.muted, fontSize: 8, fontWeight: "900" }, dayNumber: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 3 }, dayMonth: { color: colors.muted, fontSize: 8, marginTop: 1 }, dayDot: { width: 7, height: 7, borderRadius: 4, marginTop: 6 }, scheduleList: { marginTop: 14 }, scheduleRow: { minHeight: 68, marginHorizontal: 14, marginTop: 8, borderRadius: 17, padding: 10, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 10, ...cardShadow }, scheduleMark: { width: 43, height: 43, borderRadius: 14, alignItems: "center", justifyContent: "center" }, scheduleBody: { flex: 1 }, scheduleDate: { color: colors.text, fontSize: 11, fontWeight: "900", textTransform: "capitalize" }, scheduleMeta: { color: colors.muted, fontSize: 9, fontWeight: "700", marginTop: 4 }, workdayPill: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: colors.successBg }, workdayPillText: { color: colors.successDark, fontSize: 7, fontWeight: "900" },
  requestCard: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, ...cardShadow }, requestTop: { flexDirection: "row", alignItems: "center", gap: 10 }, requestIcon: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center" }, requestBody: { flex: 1 }, requestTitle: { color: colors.text, fontSize: 13, fontWeight: "900" }, requestDates: { color: colors.muted, fontSize: 9, marginTop: 4 }, status: { maxWidth: 92, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 6 }, statusText: { fontSize: 7, fontWeight: "900", textAlign: "center" }, requestReason: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 11 }, decision: { marginTop: 10, borderRadius: 12, padding: 10, backgroundColor: colors.bg }, decisionLabel: { color: colors.faint, fontSize: 7, fontWeight: "900", textTransform: "uppercase" }, decisionText: { color: colors.text, fontSize: 9, lineHeight: 14, marginTop: 4 }, requestFooter: { minHeight: 44, marginTop: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }, syncState: { flexDirection: "row", alignItems: "center", gap: 5 }, syncStateText: { color: colors.info, fontSize: 8, fontWeight: "900" }, submitted: { color: colors.faint, fontSize: 7 }, cancelRequest: { minHeight: 44, borderRadius: 11, paddingHorizontal: 10, backgroundColor: colors.dangerBg, alignItems: "center", justifyContent: "center" }, cancelRequestText: { color: colors.missed, fontSize: 8, fontWeight: "900" },
  empty: { margin: 14, minHeight: 280, borderRadius: radii.card, padding: 24, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", ...cardShadow }, emptyMark: { width: 66, height: 66, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "900", textAlign: "center", marginTop: 15 }, emptyHint: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 6 },
})
