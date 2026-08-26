import type { ReactNode } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { TabIcon } from "../components/TabIcon"
import { t } from "../i18n"
import { safeFieldBack } from "../navigation/safe-back"
import { colors, cardShadow, radii } from "../theme"

export function CommercialHeader({ title, subtitle, backFallback = "/(app)/(tabs)/work" }: { title: string; subtitle?: string; backFallback?: string }) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("back")} accessibilityHint={title} onPress={() => safeFieldBack(backFallback)} style={styles.backButton}>
        <TabIcon name="chevronLeft" color={colors.text} size={23} />
      </Pressable>
      <View style={styles.headerBody}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
    </View>
  )
}

export function CommercialVisitContext({ active, storeName, activeLabel, missingLabel }: {
  active: boolean
  storeName: string | null
  activeLabel: string
  missingLabel: string
}) {
  return (
    <View style={[styles.visit, active ? styles.visitActive : styles.visitMissing]}>
      <View style={[styles.visitDot, { backgroundColor: active ? colors.success : colors.warning }]} />
      <View style={styles.visitBody}>
        <Text style={styles.visitLabel}>{active ? activeLabel : missingLabel}</Text>
        {storeName ? <Text style={styles.visitStore} numberOfLines={1}>{storeName}</Text> : null}
      </View>
    </View>
  )
}

export function CommercialSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      <View style={styles.sectionContent}>{children}</View>
    </View>
  )
}

export function CommercialEmpty({ glyph, title, hint }: { glyph: string; title: string; hint: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyGlyph}><Text style={styles.emptyGlyphText}>{glyph}</Text></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyHint}>{hint}</Text>
    </View>
  )
}

export function CommercialPill({ label, tone = "neutral" }: {
  label: string
  tone?: "neutral" | "success" | "warning" | "danger" | "info"
}) {
  const palette = tone === "success"
    ? { background: colors.successBg, foreground: colors.successDark }
    : tone === "warning"
      ? { background: colors.warningBg, foreground: colors.warning }
      : tone === "danger"
        ? { background: colors.dangerBg, foreground: colors.dangerPressed }
        : tone === "info"
          ? { background: colors.infoBg, foreground: colors.info }
          : { background: colors.draftBg, foreground: colors.draft }
  return (
    <View style={[styles.pill, { backgroundColor: palette.background }]}>
      <Text style={[styles.pillText, { color: palette.foreground }]}>{label}</Text>
    </View>
  )
}

export function CommercialButton({ label, onPress, disabled = false, tone = "primary" }: {
  label: string
  onPress: () => void
  disabled?: boolean
  tone?: "primary" | "secondary" | "danger"
}) {
  const backgroundColor = tone === "danger"
    ? colors.danger
    : tone === "secondary"
      ? colors.primarySoft
      : colors.primary
  const foreground = tone === "secondary" ? colors.primary : colors.headerText
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor },
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>
    </Pressable>
  )
}

export const commercialCardStyle = {
  backgroundColor: colors.card,
  borderRadius: radii.card,
  padding: 15,
  ...cardShadow,
} as const

const styles = StyleSheet.create({
  header: { minHeight: 78, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, flexDirection: "row", alignItems: "center", gap: 11 },
  backButton: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", ...cardShadow },
  headerBody: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 24, fontWeight: "900", letterSpacing: -0.4 },
  subtitle: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  visit: { marginHorizontal: 14, marginTop: 9, borderRadius: radii.inner, paddingHorizontal: 13, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1 },
  visitActive: { backgroundColor: colors.successBg, borderColor: colors.successBorder },
  visitMissing: { backgroundColor: colors.warningBg, borderColor: colors.warningBg },
  visitDot: { width: 8, height: 8, borderRadius: 4 },
  visitBody: { flex: 1, minWidth: 0 },
  visitLabel: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  visitStore: { color: colors.text, fontSize: 13, fontWeight: "900", marginTop: 2 },
  section: { marginTop: 22 },
  sectionTitle: { marginHorizontal: 18, color: colors.text, fontSize: 17, fontWeight: "900" },
  sectionHint: { marginHorizontal: 18, color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  sectionContent: { marginTop: 10 },
  empty: { marginHorizontal: 14, borderRadius: radii.card, paddingHorizontal: 24, paddingVertical: 30, backgroundColor: colors.card, alignItems: "center", ...cardShadow },
  emptyGlyph: { width: 50, height: 50, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  emptyGlyphText: { color: colors.primary, fontSize: 22, fontWeight: "900" },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: "900", marginTop: 12, textAlign: "center" },
  emptyHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4, textAlign: "center" },
  pill: { alignSelf: "flex-start", minHeight: 28, borderRadius: radii.pill, paddingHorizontal: 10, justifyContent: "center" },
  pillText: { fontSize: 10, fontWeight: "900" },
  button: { minHeight: 46, borderRadius: 15, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 13, fontWeight: "900" },
  buttonDisabled: { opacity: 0.42 },
  buttonPressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
})
