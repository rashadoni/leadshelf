import { useEffect } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { TabIcon } from "../../../src/components/TabIcon"
import { useField } from "../../../src/field/field-context"
import { fieldNotificationCopy } from "../../../src/field/notification-copy"
import { notificationDestination, notificationTarget } from "../../../src/field/notification-target"
import { t, useLocale } from "../../../src/i18n"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { safeFieldBack } from "../../../src/navigation/safe-back"
import { cardShadow, colors, radii } from "../../../src/theme"
import { FieldScreenChrome } from "../../../src/components/FieldScreenChrome"

function notificationTypeLabel(type: string): string {
  switch (type.toLowerCase()) {
    case "alert":
    case "error":
      return t("notificationTypeAlert")
    case "warning":
      return t("notificationTypeWarning")
    case "task":
      return t("notificationTypeTask")
    case "message":
      return t("notificationTypeMessage")
    default:
      return t("notificationTypeInfo")
  }
}

export default function NotificationDetailScreen() {
  const locale = useLocale()
  const field = useField()
  const { notificationId: parameter } = useLocalSearchParams<{ notificationId?: string | string[] }>()
  const notificationId = typeof parameter === "string" ? parameter : ""
  const item = field.notifications.items.find((notification) => notification.id === notificationId) ?? null
  const unreadNotificationId = item && !item.isRead ? item.id : null

  useEffect(() => {
    if (!unreadNotificationId) return
    // A direct detail link still carries the exact notification id, so it can
    // use the same scoped durable read as Inbox instead of leaving its badge.
    void field.markNotificationRead(unreadNotificationId)
  }, [field.markNotificationRead, unreadNotificationId])

  const goBack = () => safeFieldBack("/(app)/(tabs)/inbox")

  if (!item) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <FieldScreenChrome />
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={goBack} style={styles.back}>
            <TabIcon name="chevronLeft" color={colors.text} size={23} />
          </Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("tabInbox").toUpperCase()}</Text>
            <Text style={styles.title}>{t("notificationDetailTitle")}</Text>
          </View>
        </View>
        <View style={styles.unavailableCard}>
          <View style={styles.unavailableIcon}><TabIcon name="info" color={colors.info} size={26} /></View>
          <Text style={styles.unavailableTitle}>{t("notificationDetailUnavailable")}</Text>
          <Text style={styles.unavailableText}>{t("notificationDetailUnavailableHint")}</Text>
        </View>
      </SafeAreaView>
    )
  }

  const copy = fieldNotificationCopy(item)
  const hasSemanticTarget = notificationTarget(item) != null
  const targetDestination = notificationDestination(item)

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <FieldScreenChrome />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={goBack} style={styles.back}>
            <TabIcon name="chevronLeft" color={colors.text} size={23} />
          </Pressable>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("tabInbox").toUpperCase()}</Text>
            <Text style={styles.title}>{t("notificationDetailTitle")}</Text>
            <Text style={styles.subtitle}>{t("notificationDetailHint")}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.icon}><TabIcon name="info" color={colors.info} size={24} /></View>
          <Text style={styles.notificationTitle}>{copy.title}</Text>
          <Text style={styles.notificationBody}>{copy.body || t("notificationDetailNoBody")}</Text>
          <View style={styles.facts}>
            <View style={styles.factRow}>
              <Text style={styles.factLabel}>{t("notificationDetailType", { type: notificationTypeLabel(item.type) })}</Text>
            </View>
            <View style={styles.factRow}>
              <Text style={styles.factLabel}>{t("notificationDetailDate", { date: formatShortDateTime(item.createdAt, locale) })}</Text>
            </View>
          </View>
        </View>

        {targetDestination ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("notificationDetailOpenTarget")}
            accessibilityHint={t("notificationDetailHint")}
            onPress={() => router.push(targetDestination as never)}
            style={({ pressed }) => [styles.targetButton, pressed && styles.pressed]}
          >
            <Text style={styles.targetButtonText}>{t("notificationDetailOpenTarget")}</Text>
            <TabIcon name="chevronRight" color={colors.headerText} size={20} />
          </Pressable>
        ) : null}

        {!hasSemanticTarget ? (
          <View style={styles.noTargetCard}>
            <View style={styles.noTargetIcon}><TabIcon name="info" color={colors.info} size={19} /></View>
            <Text style={styles.noTargetText}>{t("notificationDetailNoLinkedObject")}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 32 },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.9 },
  title: { color: colors.text, fontSize: 21, fontWeight: "900", marginTop: 2 },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  card: { marginHorizontal: 14, marginTop: 18, borderRadius: radii.card, backgroundColor: colors.card, padding: 17, borderWidth: 1, borderColor: colors.border, ...cardShadow },
  icon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" },
  notificationTitle: { color: colors.text, fontSize: 18, lineHeight: 23, fontWeight: "900", marginTop: 14 },
  notificationBody: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 7 },
  facts: { marginTop: 18, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 7 },
  factRow: { minHeight: 22, justifyContent: "center" },
  factLabel: { color: colors.faint, fontSize: 11, lineHeight: 16, fontWeight: "800" },
  targetButton: { minHeight: 52, marginHorizontal: 14, marginTop: 11, borderRadius: radii.inner, backgroundColor: colors.primary, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  targetButtonText: { flex: 1, color: colors.headerText, fontSize: 13, fontWeight: "900" },
  pressed: { opacity: 0.74 },
  noTargetCard: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginHorizontal: 14, marginTop: 11, padding: 12, borderRadius: radii.inner, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: colors.infoBorder },
  noTargetIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.cardOverlay, alignItems: "center", justifyContent: "center" },
  noTargetText: { flex: 1, color: colors.info, fontSize: 11, lineHeight: 16, fontWeight: "800", paddingTop: 2 },
  unavailableCard: { minHeight: 290, margin: 14, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", padding: 28, ...cardShadow },
  unavailableIcon: { width: 58, height: 58, borderRadius: 19, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  unavailableTitle: { color: colors.text, fontSize: 16, fontWeight: "900", textAlign: "center" },
  unavailableText: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 7 },
})
