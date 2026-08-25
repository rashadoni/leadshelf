import { Pressable, StyleSheet, Text, View, type ColorValue } from "react-native"
import { TabIcon } from "../components/TabIcon"
import { t, useLocale } from "../i18n"
import { formatCalendarDay, formatCalendarWeekdayShort } from "../i18n/date-format"
import { useResponsiveLayout } from "../layout/responsive"
import { colors, radii } from "../theme"

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
  busy?: boolean
  rangeOptions?: readonly number[]
  selectedRange?: number
  onSelectRange?: (range: number) => void
  getRangeLabel?: (range: number) => string
  dayHint?: string
  visibleHint?: string
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
  busy = false,
  rangeOptions,
  selectedRange,
  onSelectRange,
  getRangeLabel,
  dayHint,
  visibleHint,
}: FieldDayNavigatorProps) {
  const locale = useLocale()
  const layout = useResponsiveLayout()
  const hasNavigator = Boolean(onPrevious && onNext)
  // Seven 44dp targets fit on ordinary phones, but compact Android handsets
  // need the surrounding frame to tighten rather than shrinking the targets.
  const compactPhone = !layout.isTablet && layout.width < 390
  const narrowPhone = !layout.isTablet && layout.width < 360

  return (
    <View style={[styles.root, layout.isTablet && styles.rootTablet, compactPhone && styles.rootCompact, narrowPhone && styles.rootNarrow]}>
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
          {onCurrent ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={currentAccessibilityLabel ?? currentLabel ?? t("currentWeek")}
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              onPress={onCurrent}
              style={({ pressed }) => [styles.currentAction, (busy || pressed) && styles.pressed]}
            >
              <Text numberOfLines={1} style={styles.currentText}>{currentLabel ?? t("currentWeek")}</Text>
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

      {rangeOptions?.length && onSelectRange && selectedRange !== undefined && getRangeLabel ? (
        <View style={styles.rangeRail} accessibilityRole="tablist">
          {rangeOptions.map((range) => {
            const selected = range === selectedRange
            return (
              <Pressable
                key={range}
                accessibilityRole="tab"
                accessibilityLabel={getRangeLabel(range)}
                accessibilityState={{ selected, disabled: busy, busy }}
                disabled={busy}
                onPress={() => onSelectRange(range)}
                style={({ pressed }) => [styles.rangeChoice, selected && styles.rangeChoiceSelected, (busy || pressed) && styles.pressed]}
              >
                <Text style={[styles.rangeText, selected && styles.rangeTextSelected]}>{getRangeLabel(range)}</Text>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      {days.length ? (
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
    </View>
  )
}

const styles = StyleSheet.create({
  root: { marginHorizontal: 16, marginTop: 10, gap: 8 },
  rootTablet: { alignSelf: "center", width: "94%", maxWidth: 780, marginHorizontal: 0 },
  rootCompact: { marginHorizontal: 8 },
  rootNarrow: { marginHorizontal: 4, gap: 6 },
  navigationRow: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  arrowButton: { width: 44, height: 44, borderRadius: radii.pill, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  currentAction: { minWidth: 0, flex: 1, minHeight: 44, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  currentText: { color: colors.text, fontSize: 13, fontWeight: "900" },
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
  weekday: { color: colors.muted, fontSize: 10, fontWeight: "900" },
  weekdaySelected: { color: colors.headerText },
  date: { color: colors.text, fontSize: 18, fontWeight: "900" },
  dateSelected: { color: colors.headerText },
  dotSlot: { width: 6, height: 6, marginTop: 1, alignItems: "center", justifyContent: "center" },
  dot: { width: 6, height: 6, borderRadius: radii.pill },
  visibleHint: { color: colors.muted, fontSize: 11, lineHeight: 15, textAlign: "center", paddingHorizontal: 8 },
  pressed: { opacity: 0.72 },
})
