import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useField } from "../../../src/field/field-context"
import { t, useLocale } from "../../../src/i18n"
import { colors, cardShadow, radii } from "../../../src/theme"

function notificationTone(type: string) {
  if (type === "alert" || type === "error") return { bg: colors.missedBg, color: colors.missed, glyph: "!" }
  if (type === "warning") return { bg: colors.warningBg, color: colors.warning, glyph: "!" }
  if (type === "task") return { bg: colors.successBg, color: colors.successDark, glyph: "✓" }
  return { bg: colors.infoBg, color: colors.info, glyph: "i" }
}

export default function InboxTab() {
  const locale = useLocale()
  const field = useField()
  const { items, unread } = field.notifications
  const busy = field.phase === "loading" || field.phase === "refreshing"
  const dateFormatter = new Intl.DateTimeFormat(locale === "az" ? "az-AZ" : "ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void field.refresh()} />}
      >
        <View style={styles.header}>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("tabInbox").toUpperCase()}</Text>
            <Text style={styles.title}>{t("inboxTitle")}</Text>
            {unread > 0 ? <Text style={styles.subtitle}>{unread} {t("unread")}</Text> : null}
          </View>
          {unread > 0 ? (
            <Pressable onPress={() => void field.markAllNotificationsRead()} style={styles.readAll}>
              <Text style={styles.readAllText}>{t("markAllRead")}</Text>
            </Pressable>
          ) : null}
        </View>

        {items.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><Text style={styles.emptyIconText}>✓</Text></View>
            <Text style={styles.emptyTitle}>{t("inboxEmpty")}</Text>
            <Text style={styles.emptyHint}>{t("inboxEmptyHint")}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {items.map((item) => {
              const tone = notificationTone(item.type)
              return (
                <View key={item.id} style={[styles.card, !item.isRead && styles.unreadCard]}>
                  <View style={[styles.typeIcon, { backgroundColor: tone.bg }]}>
                    <Text style={[styles.typeGlyph, { color: tone.color }]}>{tone.glyph}</Text>
                  </View>
                  <View style={styles.body}>
                    <View style={styles.titleRow}>
                      <Text style={styles.notificationTitle}>{item.title}</Text>
                      {!item.isRead ? <View style={styles.unreadDot} /> : null}
                    </View>
                    {item.body ? <Text style={styles.notificationBody}>{item.body}</Text> : null}
                    <Text style={styles.date}>{dateFormatter.format(new Date(item.createdAt))}</Text>
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 28 },
  header: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12, flexDirection: "row", alignItems: "flex-end", gap: 10 },
  headerBody: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  title: { color: colors.text, fontSize: 27, fontWeight: "900", letterSpacing: -0.6, marginTop: 4 },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 3 },
  readAll: { backgroundColor: colors.primarySoft, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 9 },
  readAllText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  emptyCard: { margin: 14, minHeight: 300, padding: 28, backgroundColor: colors.card, borderRadius: radii.card, alignItems: "center", justifyContent: "center", ...cardShadow },
  emptyIcon: { width: 66, height: 66, borderRadius: 22, backgroundColor: colors.successBg, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyIconText: { color: colors.success, fontSize: 28, fontWeight: "900" },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "900", textAlign: "center" },
  emptyHint: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 7, maxWidth: 280 },
  list: { paddingTop: 3 },
  card: { marginHorizontal: 14, marginTop: 10, padding: 14, borderRadius: radii.card, backgroundColor: colors.card, flexDirection: "row", alignItems: "flex-start", gap: 11, borderWidth: 1, borderColor: colors.border, ...cardShadow },
  unreadCard: { borderColor: colors.infoBorder, backgroundColor: "#FCFDFF" },
  typeIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  typeGlyph: { fontSize: 16, fontWeight: "900" },
  body: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  notificationTitle: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "900" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  notificationBody: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  date: { color: colors.faint, fontSize: 10, fontWeight: "600", marginTop: 8 },
})
