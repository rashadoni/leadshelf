import { useEffect, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { tokenStore, type OnboardingSection } from "../auth/token-store"
import { t, useLocale, type MessageKey } from "../i18n"
import { colors, radii } from "../theme"
import { TabIcon, type TabIconName } from "./TabIcon"

export function SectionHint({
  section,
  icon,
  titleKey,
  bodyKey,
}: {
  section: OnboardingSection
  icon: TabIconName
  titleKey: MessageKey
  bodyKey: MessageKey
}) {
  useLocale()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    void tokenStore.getOnboarded(section).then((seen) => setVisible(!seen))
  }, [section])

  if (!visible) return null

  function dismiss() {
    setVisible(false)
    void tokenStore.setOnboarded(section)
  }

  return (
    <View style={styles.root}>
      <View style={styles.icon}>
        <TabIcon name={icon} color={colors.primary} size={22} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{t(titleKey)}</Text>
        <Text style={styles.text}>{t(bodyKey)}</Text>
      </View>
      <Pressable accessibilityRole="button" hitSlop={8} onPress={dismiss} style={styles.action}>
        <Text style={styles.actionText}>{t("onboardGot")}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 14,
    marginTop: 10,
    padding: 12,
    borderRadius: radii.card,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  icon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.inner,
    backgroundColor: colors.card,
  },
  body: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 13, fontWeight: "800" },
  text: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  action: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  actionText: { color: colors.primary, fontSize: 12, fontWeight: "800" },
})
