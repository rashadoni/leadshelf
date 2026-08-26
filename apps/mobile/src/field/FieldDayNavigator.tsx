import { useEffect, useState } from "react"
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type ColorValue } from "react-native"
import { TabIcon } from "../components/TabIcon"
import { t, useLocale } from "../i18n"
import { formatCalendarDay, formatCalendarMonthShort, formatCalendarWeekdayShort } from "../i18n/date-format"
import { useResponsiveLayout } from "../layout/responsive"
import { cardShadow, colors, radii } from "../theme"

export type FieldDayNavigatorItem = {
  date: string
  isToday?: boolean
  isWorkingDay?: boolean
  disabled?: boolean
  dotColor?: ColorValue
  accessibilityLabel?: string
}

type FieldDayNavigatorProps = {
  days: readonly FieldDayNavigatorItem[]
  selectedDate: string | null
  onSelectDate: (date: string) => void
  onPrevious?: () => void
  onNext?: () => void
  previousLabel?: string
  nextLabel?: string
  onCurrent?: () => void
  currentLabel?: string
  currentAccessibilityLabel?: string
  currentActionLabel?: string
  currentActionAccessibilityLabel?: string
  busy?: boolean
  rangeOptions?: readonly number[]
  selectedRange?: number
  onSelectRange?: (range: number) => void
  getRangeLabel?: (range: number) => string
  dayHint?: string
  visibleHint?: string
  calendarPicker?: boolean
  todayDate?: string
  /** A focused date chooser such as Route Builder: do not render a second week rail. */
  compactDay?: boolean
  /** Render inside another form without the outer screen gutters. */
  embedded?: boolean
  /** A caller-owned calendar policy, for example no task deadline in the past. */
  isCalendarDateDisabled?: (date: string) => boolean
}

function dateFromKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3])
    ? date
    : null
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function monthStart(value: string | null | undefined): string | null {
  const date = value ? dateFromKey(value) : null
  return date ? dateKey(new Date(date.getFullYear(), date.getMonth(), 1, 12)) : null
}

function shiftMonth(value: string, amount: number): string {
  const date = dateFromKey(value) ?? new Date()
  return dateKey(new Date(date.getFullYear(), date.getMonth() + amount, 1, 12))
}

function monthGrid(value: string): string[] {
  const first = dateFromKey(value)
  if (!first) return []
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset, 12)
  return Array.from({ length: 42 }, (_, index) => dateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 12)))
}

/**
 * One calendar language for Field: a compact range navigator and a directly
 * selectable Outlook-like week strip. It deliberately contains no agenda;
 * each caller renders exactly the selected day's context below it.
 */
export function FieldDayNavigator({
  days,
  selectedDate,
  onSelectDate,
  onPrevious,
  onNext,
  previousLabel,
  nextLabel,
  onCurrent,
  currentLabel,
  currentAccessibilityLabel,
  currentActionLabel,
  currentActionAccessibilityLabel,
  busy = false,
  rangeOptions,
  selectedRange,
  onSelectRange,
  getRangeLabel,
  dayHint,
  visibleHint,
  calendarPicker = false,
  todayDate,
  compactDay = false,
  embedded = false,
  isCalendarDateDisabled,
}: FieldDayNavigatorProps) {
  const locale = useLocale()
  const layout = useResponsiveLayout()
  const hasNavigator = Boolean(onPrevious && onNext)
  const rangeSelector = rangeOptions && rangeOptions.length > 0 && onSelectRange && selectedRange !== undefined && getRangeLabel
    ? { options: rangeOptions, onSelect: onSelectRange, selected: selectedRange, label: getRangeLabel }
    : null
  const isDayMode = compactDay || rangeSelector?.selected === 1
  const [rangeExpanded, setRangeExpanded] = useState(!isDayMode)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const calendarAnchorDate = selectedDate ?? todayDate ?? days.find((item) => item.isToday)?.date ?? days[0]?.date ?? null
  const [calendarMonth, setCalendarMonth] = useState(() => monthStart(calendarAnchorDate) ?? "")
  // A day is a destination, not a compressed week. Once a person selects a
  // day, keep the calendar controls compact until they explicitly ask to see
  // the wider period again.
  useEffect(() => {
    setRangeExpanded(!isDayMode)
  }, [isDayMode])
  // Seven 44dp targets fit on ordinary phones, but compact Android handsets
  // need the surrounding frame to tighten rather than shrinking the targets.
  const compactPhone = !layout.isTablet && layout.width < 390
  const narrowPhone = !layout.isTablet && layout.width < 360
  // A seven-column calendar must never shrink below seven 44dp targets. The
  // standard dialog gutters would make that impossible on 320–360dp phones,
  // so the picker uses the full available width before reducing a touch area.
  const compactCalendar = !layout.isTablet && layout.width < 376
  const calendarDays = calendarOpen ? monthGrid(calendarMonth) : []
  const calendarWeekdays = calendarDays.slice(0, 7).map((date) => formatCalendarWeekdayShort(date, locale))
  const calendarMonthLabel = calendarMonth
    ? `${formatCalendarMonthShort(calendarMonth, locale)} ${calendarMonth.slice(0, 4)}`
    : ""
  const calendarEnabled = calendarPicker && Boolean(calendarAnchorDate)
  const calendarItemsByDate = new Map(days.map((item) => [item.date, item]))

  function openCalendar() {
    const nextMonth = monthStart(calendarAnchorDate)
    if (!nextMonth) return
    setCalendarMonth(nextMonth)
    setCalendarOpen(true)
  }

  function selectCalendarDate(date: string) {
    if (busy || calendarItemsByDate.get(date)?.disabled || isCalendarDateDisabled?.(date)) return
    if (isDayMode) setRangeExpanded(false)
    onSelectDate(date)
    setCalendarOpen(false)
  }

  const todayDisabled = Boolean(todayDate && (busy || calendarItemsByDate.get(todayDate)?.disabled || isCalendarDateDisabled?.(todayDate)))

  return (
    <View style={[styles.root, embedded && styles.rootEmbedded, layout.isTablet && !embedded && styles.rootTablet, compactPhone && !embedded && styles.rootCompact, narrowPhone && !embedded && styles.rootNarrow]}>
      {hasNavigator ? (
        <View style={styles.navigationRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={previousLabel ?? t("previousWeek")}
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onPress={onPrevious}
            style={({ pressed }) => [styles.arrowButton, (busy || pressed) && styles.pressed]}
          >
            <TabIcon name="chevronLeft" color={colors.primary} size={21} />
          </Pressable>
          {calendarEnabled ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("calendarChooseDate")}
              accessibilityHint={currentAccessibilityLabel ?? currentLabel ?? t("currentWeek")}
              accessibilityState={{ disabled: busy, expanded: calendarOpen, busy }}
              disabled={busy}
              onPress={openCalendar}
              style={({ pressed }) => [styles.currentAction, styles.currentActionPicker, (busy || pressed) && styles.pressed]}
            >
              <TabIcon name="week" color={colors.primary} size={17} />
              <Text numberOfLines={1} style={styles.currentText}>{currentLabel ?? t("currentWeek")}</Text>
              <TabIcon name="chevronDown" color={colors.primary} size={17} />
            </Pressable>
          ) : (
            <View accessible accessibilityRole="text" accessibilityLabel={currentAccessibilityLabel ?? currentLabel ?? t("currentWeek")} style={styles.currentAction}>
              <Text numberOfLines={1} style={styles.currentText}>{currentLabel ?? t("currentWeek")}</Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={nextLabel ?? t("nextWeek")}
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onPress={onNext}
            style={({ pressed }) => [styles.arrowButton, (busy || pressed) && styles.pressed]}
          >
            <TabIcon name="chevronRight" color={colors.primary} size={21} />
          </Pressable>
        </View>
      ) : null}

      {!hasNavigator && calendarEnabled ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("calendarChooseDate")}
          accessibilityHint={currentAccessibilityLabel ?? currentLabel ?? t("currentWeek")}
          accessibilityState={{ disabled: busy, expanded: calendarOpen, busy }}
          disabled={busy}
          onPress={openCalendar}
          style={({ pressed }) => [styles.currentAction, styles.currentActionPicker, styles.currentActionStandalone, (busy || pressed) && styles.pressed]}
        >
          <TabIcon name="week" color={colors.primary} size={17} />
          <Text numberOfLines={1} style={styles.currentText}>{currentLabel ?? t("currentWeek")}</Text>
          <TabIcon name="chevronDown" color={colors.primary} size={17} />
        </Pressable>
      ) : null}

      {onCurrent ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={currentActionAccessibilityLabel ?? currentActionLabel ?? t("tabToday")}
          accessibilityState={{ disabled: busy, busy }}
          disabled={busy}
          onPress={onCurrent}
          style={({ pressed }) => [styles.currentShortcut, (busy || pressed) && styles.pressed]}
        >
          <TabIcon name="today" color={colors.primary} size={16} />
          <Text style={styles.currentShortcutText}>{currentActionLabel ?? t("tabToday")}</Text>
        </Pressable>
      ) : null}

      {rangeSelector && isDayMode && !rangeExpanded ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("calendarView")}
          accessibilityHint={t("calendarViewHint")}
          accessibilityState={{ expanded: false, disabled: busy, busy }}
          disabled={busy}
          onPress={() => setRangeExpanded(true)}
          style={({ pressed }) => [styles.viewToggle, (busy || pressed) && styles.pressed]}
        >
          <TabIcon name="week" color={colors.primary} size={17} />
          <Text style={styles.viewToggleText}>{t("calendarView")}</Text>
          <TabIcon name="chevronDown" color={colors.primary} size={17} />
        </Pressable>
      ) : null}

      {rangeSelector && (!isDayMode || rangeExpanded) ? (
        <View style={styles.rangeRail} accessibilityRole="tablist">
          {rangeSelector.options.map((range) => {
            const selected = range === rangeSelector.selected
            return (
              <Pressable
                key={range}
                accessibilityRole="tab"
                accessibilityLabel={rangeSelector.label(range)}
                accessibilityState={{ selected, disabled: busy, busy }}
                disabled={busy}
                onPress={() => {
                  rangeSelector.onSelect(range)
                  if (range === 1) setRangeExpanded(false)
                }}
                style={({ pressed }) => [styles.rangeChoice, selected && styles.rangeChoiceSelected, (busy || pressed) && styles.pressed]}
              >
                <Text style={[styles.rangeText, selected && styles.rangeTextSelected]}>{rangeSelector.label(range)}</Text>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      {days.length && !isDayMode ? (
        <>
          <View style={[styles.dayStrip, compactPhone && styles.dayStripCompact, narrowPhone && styles.dayStripNarrow, days.length === 1 && styles.dayStripSolo]}>
            {days.map((item) => {
              const formatted = formatCalendarDay(item.date, locale)
              const selected = item.date === selectedDate
              const disabled = Boolean(item.disabled || busy)
              const label = item.accessibilityLabel ?? [
                formatted.weekday,
                formatted.date,
                item.isToday ? t("tabToday") : null,
                item.isWorkingDay === false ? t("dayOff") : null,
              ].filter(Boolean).join(", ")
              const dotColor = item.dotColor ?? (item.isWorkingDay === false ? colors.holiday : null)
              return (
                <Pressable
                  key={item.date}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityHint={disabled ? t("routePlanningDateUnavailable") : dayHint ?? t("dailyMission")}
                  accessibilityState={{ selected, disabled, busy }}
                  disabled={disabled}
                  hitSlop={compactPhone ? 2 : undefined}
                  onPress={() => onSelectDate(item.date)}
                  style={({ pressed }) => [
                    styles.day,
                    days.length === 1 && styles.daySolo,
                    selected && styles.daySelected,
                    item.isWorkingDay === false && styles.dayOff,
                    (disabled || pressed) && styles.pressed,
                  ]}
                >
                  <Text style={[styles.weekday, selected && styles.weekdaySelected]}>{formatCalendarWeekdayShort(item.date, locale)}</Text>
                  <Text style={[styles.date, selected && styles.dateSelected]}>{formatted.day}</Text>
                  <View style={styles.dotSlot}>
                    {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
                  </View>
                </Pressable>
              )
            })}
          </View>
          {visibleHint ? <Text style={styles.visibleHint}>{visibleHint}</Text> : null}
        </>
      ) : null}

      {calendarEnabled ? (
        <Modal visible={calendarOpen} transparent animationType="fade" onRequestClose={() => setCalendarOpen(false)}>
          <View style={[styles.calendarOverlay, compactCalendar && styles.calendarOverlayCompact]}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("calendarClose")} onPress={() => setCalendarOpen(false)} style={styles.calendarBackdrop} />
            <View accessibilityViewIsModal style={[styles.calendarDialog, compactCalendar && styles.calendarDialogCompact]}>
              <View style={styles.calendarHeader}>
                <Pressable accessibilityRole="button" accessibilityLabel={t("calendarPreviousMonth")} onPress={() => setCalendarMonth((month) => shiftMonth(month, -1))} style={styles.calendarArrow}>
                  <TabIcon name="chevronLeft" color={colors.primary} size={21} />
                </Pressable>
                <Text accessibilityRole="header" style={styles.calendarTitle}>{calendarMonthLabel}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t("calendarNextMonth")} onPress={() => setCalendarMonth((month) => shiftMonth(month, 1))} style={styles.calendarArrow}>
                  <TabIcon name="chevronRight" color={colors.primary} size={21} />
                </Pressable>
              </View>
              <ScrollView style={styles.calendarBody} contentContainerStyle={styles.calendarBodyContent} showsVerticalScrollIndicator={false}>
                <View style={styles.calendarWeekdays}>
                  {calendarWeekdays.map((label, index) => <Text key={index} style={styles.calendarWeekday}>{label}</Text>)}
                </View>
                <View style={styles.calendarGrid}>
                  {calendarDays.map((date) => {
                    const formatted = formatCalendarDay(date, locale)
                    const item = calendarItemsByDate.get(date)
                    const inMonth = date.slice(0, 7) === calendarMonth.slice(0, 7)
                    const selected = date === selectedDate
                    const isToday = date === todayDate
                    const disabled = busy || item?.disabled === true || isCalendarDateDisabled?.(date) === true
                    return (
                      <Pressable
                        key={date}
                        accessibilityRole="button"
                        accessibilityLabel={item?.accessibilityLabel ?? `${formatted.weekday}, ${formatted.date}`}
                        accessibilityState={{ selected, disabled }}
                        disabled={disabled}
                        onPress={() => selectCalendarDate(date)}
                        style={({ pressed }) => [styles.calendarDay, !inMonth && styles.calendarDayOutside, disabled && styles.calendarDayDisabled, selected && styles.calendarDaySelected, isToday && !selected && styles.calendarDayToday, (busy || pressed) && styles.pressed]}
                      >
                        <View style={styles.calendarDayContent}>
                          <Text style={[styles.calendarDayText, !inMonth && styles.calendarDayTextOutside, selected && styles.calendarDayTextSelected]}>{formatted.day}</Text>
                          {item?.dotColor ? <View style={[styles.calendarDayDot, { backgroundColor: item.dotColor }]} /> : null}
                        </View>
                      </Pressable>
                    )
                  })}
                </View>
              </ScrollView>
              <View style={styles.calendarFooter}>
                {todayDate ? <Pressable accessibilityRole="button" accessibilityLabel={t("tabToday")} accessibilityState={{ disabled: todayDisabled }} disabled={todayDisabled} onPress={() => selectCalendarDate(todayDate)} style={({ pressed }) => [styles.calendarToday, (todayDisabled || pressed) && styles.pressed]}><TabIcon name="today" color={colors.primary} size={16} /><Text style={styles.calendarTodayText}>{t("tabToday")}</Text></Pressable> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={t("calendarClose")} onPress={() => setCalendarOpen(false)} style={({ pressed }) => [styles.calendarClose, pressed && styles.pressed]}><Text style={styles.calendarCloseText}>{t("calendarClose")}</Text></Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { marginHorizontal: 16, marginTop: 10, gap: 8 },
  rootEmbedded: { marginHorizontal: 0, marginTop: 0 },
  rootTablet: { alignSelf: "center", width: "94%", maxWidth: 780, marginHorizontal: 0 },
  rootCompact: { marginHorizontal: 8 },
  rootNarrow: { marginHorizontal: 4, gap: 6 },
  navigationRow: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  arrowButton: { width: 44, height: 44, borderRadius: radii.pill, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  currentAction: { minWidth: 0, flex: 1, minHeight: 44, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  currentActionPicker: { flexDirection: "row", gap: 4 },
  currentActionStandalone: { width: "100%", flex: 0, borderRadius: radii.inner, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  currentText: { color: colors.text, flexShrink: 1, fontSize: 13, fontWeight: "900", textAlign: "center" },
  currentShortcut: { alignSelf: "center", minHeight: 44, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.primarySoft, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  currentShortcutText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  viewToggle: { alignSelf: "center", minHeight: 44, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.infoBorder, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  viewToggleText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  rangeRail: { alignSelf: "center", flexDirection: "row", gap: 4, borderRadius: radii.pill, backgroundColor: colors.surfaceMuted, padding: 3, borderWidth: 1, borderColor: colors.border },
  rangeChoice: { minWidth: 44, minHeight: 44, borderRadius: radii.pill, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  rangeChoiceSelected: { backgroundColor: colors.primary },
  rangeText: { color: colors.muted, fontSize: 11, fontWeight: "900" },
  rangeTextSelected: { color: colors.headerText },
  dayStrip: { minHeight: 76, flexDirection: "row", gap: 4, padding: 5, borderRadius: radii.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  dayStripCompact: { gap: 2, padding: 2 },
  dayStripNarrow: { gap: 0, padding: 0, borderWidth: 0 },
  dayStripSolo: { justifyContent: "center" },
  day: { flex: 1, minWidth: 44, minHeight: 64, borderRadius: radii.inner, alignItems: "center", justifyContent: "center", gap: 1 },
  daySolo: { flexGrow: 0, flexBasis: 72 },
  daySelected: { backgroundColor: colors.primary },
  dayOff: { opacity: 0.66 },
  weekday: { color: colors.muted, fontSize: 11, fontWeight: "900" },
  weekdaySelected: { color: colors.headerText },
  date: { color: colors.text, fontSize: 18, fontWeight: "900" },
  dateSelected: { color: colors.headerText },
  dotSlot: { width: 6, height: 6, marginTop: 1, alignItems: "center", justifyContent: "center" },
  dot: { width: 6, height: 6, borderRadius: radii.pill },
  visibleHint: { color: colors.muted, fontSize: 11, lineHeight: 15, textAlign: "center", paddingHorizontal: 8 },
  calendarOverlay: { flex: 1, justifyContent: "center", paddingHorizontal: 14, backgroundColor: "rgba(16,38,61,0.42)" },
  calendarOverlayCompact: { paddingHorizontal: 0 },
  calendarBackdrop: { ...StyleSheet.absoluteFill },
  calendarDialog: { width: "100%", maxWidth: 500, maxHeight: "90%", alignSelf: "center", borderRadius: 24, padding: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, ...cardShadow },
  calendarDialogCompact: { borderRadius: 18, paddingHorizontal: 4 },
  calendarHeader: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  calendarArrow: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  calendarTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: "900", textAlign: "center", textTransform: "capitalize" },
  calendarBody: { flexShrink: 1 },
  calendarBodyContent: { paddingBottom: 2 },
  calendarWeekdays: { flexDirection: "row", marginTop: 10 },
  calendarWeekday: { width: "14.2857%", color: colors.muted, fontSize: 11, fontWeight: "900", textAlign: "center" },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 5 },
  calendarDay: { width: "14.2857%", minWidth: 44, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  calendarDayOutside: { opacity: 0.42 },
  calendarDayDisabled: { opacity: 0.34 },
  calendarDayToday: { borderWidth: 1, borderColor: colors.primary },
  calendarDaySelected: { backgroundColor: colors.primary },
  calendarDayContent: { minHeight: 29, alignItems: "center", justifyContent: "flex-start" },
  calendarDayText: { color: colors.text, fontSize: 14, fontWeight: "900" },
  calendarDayTextOutside: { color: colors.muted },
  calendarDayTextSelected: { color: colors.headerText },
  calendarDayDot: { width: 5, height: 5, borderRadius: radii.pill, marginTop: 2 },
  calendarFooter: { minHeight: 48, marginTop: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  calendarToday: { minHeight: 44, borderRadius: radii.inner, backgroundColor: colors.primarySoft, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  calendarTodayText: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  calendarClose: { minHeight: 44, borderRadius: radii.inner, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  calendarCloseText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  pressed: { opacity: 0.72 },
})
