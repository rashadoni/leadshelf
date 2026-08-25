import { useCallback, useState } from "react"
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native"
import { router, useFocusEffect } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import { cacheFieldMessages, readFieldMessages } from "../../../src/db/local-store"
import { useField } from "../../../src/field/field-context"
import { fieldNotificationCopy } from "../../../src/field/notification-copy"
import { notificationOpenDestination } from "../../../src/field/notification-target"
import { useSync } from "../../../src/sync/sync-context"
import { t, useLocale } from "../../../src/i18n"
import { formatShortDateTime } from "../../../src/i18n/date-format"
import { TabIcon, type TabIconName } from "../../../src/components/TabIcon"
import { colors, cardShadow, radii } from "../../../src/theme"
import { useResponsiveLayout } from "../../../src/layout/responsive"

type InboxMode = "messages" | "notifications"

function notificationTone(type: string): { bg: string; color: string; icon: TabIconName } {
  if (type === "alert" || type === "error") return { bg: colors.missedBg, color: colors.missed, icon: "alert" }
  if (type === "warning") return { bg: colors.warningBg, color: colors.warning, icon: "alert" }
  if (type === "task") return { bg: colors.successBg, color: colors.successDark, icon: "tasks" }
  if (type === "message") return { bg: colors.primarySoft, color: colors.primary, icon: "inbox" }
  return { bg: colors.infoBg, color: colors.info, icon: "info" }
}

export default function InboxTab() {
  const locale = useLocale()
  const field = useField()
  const layout = useResponsiveLayout()
  const [mode, setMode] = useState<InboxMode>("messages")
  const [messages, setMessages] = useState(readFieldMessages)
  const [refreshing, setRefreshing] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const copy = locale === "az" ? {
    title: "Gələnlər",
    subtitle: "Mesajlar və vacib bildirişlər bir yerdə",
    messages: "Mesajlar",
    notifications: "Bildirişlər",
    newChat: "Yeni dialoq",
    noMessages: "Hələ mesaj yoxdur",
    noMessagesHint: "Menecer və komanda ilə yazışmalar burada görünəcək.",
    attachment: "Fayl əlavə edilib",
    ack: "Təsdiq lazımdır",
    queued: "Göndərilmə növbəsində",
    sent: "Göndərildi",
    read: "Oxunub",
    unread: "Oxunmayıb",
    openThread: "Dialoqu aç",
    openNotification: "Bildirişi aç",
    refreshError: "Mesajlar yenilənmədi — telefondakı nüsxə göstərilir.",
    localThread: "Mesaj telefonda saxlanılıb. Sinxronlaşdıqdan sonra dialoq açılacaq.",
    notificationReadError: "Bildiriş telefonda saxlanılmadı. Yenidən cəhd edin.",
  } : {
    title: "Входящие",
    subtitle: "Сообщения и важные уведомления в одном месте",
    messages: "Сообщения",
    notifications: "Уведомления",
    newChat: "Новый диалог",
    noMessages: "Сообщений пока нет",
    noMessagesHint: "Здесь появятся диалоги с руководителем и командой.",
    attachment: "Прикреплён файл",
    ack: "Нужно подтвердить",
    queued: "В очереди на отправку",
    sent: "Отправлено",
    read: "Прочитано",
    unread: "Не прочитано",
    openThread: "Открыть диалог",
    openNotification: "Открыть уведомление",
    refreshError: "Сообщения не обновились — показана копия с телефона.",
    localThread: "Сообщение сохранено на телефоне. Диалог откроется после синхронизации.",
    notificationReadError: "Не удалось сохранить уведомление на телефоне. Повторите попытку.",
  }
  const { items, unread: notificationUnread } = field.notifications
  const { sync } = useSync()
  const refreshMessages = useCallback(async (showWarning = true) => {
    try {
      const next = cacheFieldMessages(await fieldApi.messages())
      setMessages(next)
      setWarning(null)
    } catch {
      setMessages(readFieldMessages())
      if (showWarning) setWarning(copy.refreshError)
    }
  }, [copy.refreshError])

  useFocusEffect(useCallback(() => {
    setMessages(readFieldMessages())
    void refreshMessages(false)
  }, [refreshMessages]))

  async function refresh() {
    setRefreshing(true)
    await Promise.allSettled([refreshMessages(true), field.refresh()])
    setRefreshing(false)
  }

  function openThread(threadId: string) {
    if (threadId.startsWith("local-direct-")) {
      Alert.alert(copy.queued, copy.localThread)
      return
    }
    router.push(`/(app)/messages/${threadId}` as never)
  }

  function openNotification(item: typeof items[number]) {
    const destination = notificationOpenDestination(item)
    // Do not make navigation wait for a network PATCH. The durable outbox owns
    // the scoped read update and SyncProvider retries it after a real outage.
    router.push(destination as never)
    void field.markNotificationRead(item.id)
      .then(() => sync())
      .catch(() => setWarning(copy.notificationReadError))
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <View style={styles.header}>
          <View style={styles.headerBody}>
            <Text style={styles.eyebrow}>{t("tabInbox").toUpperCase()}</Text>
            <Text style={styles.title}>{copy.title}</Text>
            <Text style={styles.subtitle}>{copy.subtitle}</Text>
          </View>
          {mode === "messages" && messages.capabilities.startDirectConversation ? (
            <Pressable accessibilityRole="button" accessibilityLabel={copy.newChat} onPress={() => router.push("/(app)/messages/new" as never)} style={styles.newButton}>
              <View accessible={false} style={styles.newButtonIcon}><TabIcon name="add" color={colors.headerText} size={19} /></View>
              <Text style={styles.newButtonText}>{copy.newChat}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.segment}>
          <Pressable accessibilityRole="tab" accessibilityLabel={copy.messages} accessibilityState={{ selected: mode === "messages" }} onPress={() => setMode("messages")} style={[styles.segmentButton, mode === "messages" && styles.segmentActive]}>
            <Text style={[styles.segmentText, mode === "messages" && styles.segmentTextActive]}>{copy.messages}</Text>
            {messages.unread > 0 ? <View style={styles.count}><Text style={styles.countText}>{messages.unread}</Text></View> : null}
          </Pressable>
          <Pressable accessibilityRole="tab" accessibilityLabel={copy.notifications} accessibilityState={{ selected: mode === "notifications" }} onPress={() => setMode("notifications")} style={[styles.segmentButton, mode === "notifications" && styles.segmentActive]}>
            <Text style={[styles.segmentText, mode === "notifications" && styles.segmentTextActive]}>{copy.notifications}</Text>
            {notificationUnread > 0 ? <View style={styles.count}><Text style={styles.countText}>{notificationUnread}</Text></View> : null}
          </Pressable>
        </View>

        {warning ? <View accessibilityRole="alert" style={styles.warning}><View accessible={false} style={styles.warningIcon}><TabIcon name="refresh" color={colors.warning} size={17} /></View><Text style={styles.warningText}>{warning}</Text></View> : null}

        {mode === "messages" ? (
          messages.threads.length === 0 ? (
            <Empty icon="inbox" title={copy.noMessages} hint={copy.noMessagesHint} />
          ) : (
            <View style={[styles.list, layout.isTablet && styles.listTablet]}>
              {messages.threads.map((thread) => {
                const hasAttachment = Boolean(thread.lastMessage?.attachmentDocument)
                const preview = thread.lastMessage?.body || (hasAttachment ? copy.attachment : "")
                const delivery = !thread.syncState ? thread.lastMessage?.delivery : null
                const status = [
                  thread.unread ? copy.unread : null,
                  thread.needsAcknowledgement ? copy.ack : null,
                  thread.syncState ? copy.queued : null,
                  delivery?.status === "READ" ? copy.read : delivery?.status === "SENT" ? copy.sent : null,
                ].filter(Boolean).join(". ")
                return (
                  <Pressable
                    key={thread.id}
                    accessibilityRole="button"
                    accessibilityLabel={[thread.title, preview].filter(Boolean).join(". ")}
                    accessibilityHint={thread.id.startsWith("local-direct-") ? copy.localThread : copy.openThread}
                    accessibilityState={{ busy: thread.syncState === "PENDING" }}
                    accessibilityValue={status ? { text: status } : undefined}
                    onPress={() => openThread(thread.id)}
                    style={({ pressed }) => [
                      styles.messageCard,
                      layout.isTablet && styles.listCardTablet,
                      thread.unread && styles.messageUnread,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View accessible={false} style={[styles.avatar, thread.type === "BROADCAST" && styles.broadcastAvatar]}>
                      {thread.type === "BROADCAST" ? <TabIcon name="inbox" color={colors.warning} size={20} /> : <Text style={styles.avatarText}>{thread.title.charAt(0).toUpperCase()}</Text>}
                    </View>
                    <View style={styles.messageBody}>
                      <View style={styles.messageTitleRow}>
                        <Text style={styles.messageTitle} numberOfLines={1}>{thread.title}</Text>
                        <Text style={styles.time}>{formatShortDateTime(thread.lastMessageAt, locale)}</Text>
                      </View>
                      {thread.lastMessage?.body ? (
                        <Text style={styles.preview} numberOfLines={2}>{thread.lastMessage.body}</Text>
                      ) : hasAttachment ? (
                        <View accessible={false} style={styles.attachmentPreview}><TabIcon name="document" color={colors.muted} size={14} /><Text style={[styles.preview, styles.attachmentPreviewText]}>{copy.attachment}</Text></View>
                      ) : <Text style={styles.preview}>—</Text>}
                      <View accessible={false} style={styles.metaRow}>
                        {thread.needsAcknowledgement ? <Pill label={copy.ack} tone="warning" /> : null}
                        {thread.syncState ? <Pill label={copy.queued} tone="info" /> : null}
                        {delivery ? <Pill label={delivery.status === "READ" ? copy.read : copy.sent} tone="success" icon="check" duplicateIcon={delivery.status === "READ"} /> : null}
                      </View>
                    </View>
                    {thread.unread ? <View accessible={false} style={styles.unreadDot} /> : <View accessible={false} style={styles.chevron}><TabIcon name="chevronRight" color={colors.faint} size={20} /></View>}
                  </Pressable>
                )
              })}
            </View>
          )
        ) : (
          <>
            {notificationUnread > 0 ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t("markAllRead")} accessibilityState={{ disabled: notificationUnread === 0 }} onPress={() => void field.markAllNotificationsRead()} style={styles.readAll}>
                <Text style={styles.readAllText}>{t("markAllRead")}</Text>
              </Pressable>
            ) : null}
            {items.length === 0 ? (
              <Empty icon="check" title={t("inboxEmpty")} hint={t("inboxEmptyHint")} />
            ) : (
              <View style={[styles.list, layout.isTablet && styles.listTablet]}>
                {items.map((item) => {
                  const tone = notificationTone(item.type)
                  const presented = fieldNotificationCopy(item)
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityLabel={presented.title}
                      accessibilityHint={copy.openNotification}
                      accessibilityValue={{ text: item.isRead ? copy.read : copy.unread }}
                      onPress={() => void openNotification(item)}
                      style={({ pressed }) => [
                        styles.notificationCard,
                        layout.isTablet && styles.listCardTablet,
                        !item.isRead && styles.messageUnread,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View accessible={false} style={[styles.typeIcon, { backgroundColor: tone.bg }]}>
                        <TabIcon name={tone.icon} color={tone.color} size={20} />
                      </View>
                      <View style={styles.messageBody}>
                        <Text style={styles.messageTitle}>{presented.title}</Text>
                        {presented.body ? <Text style={styles.preview}>{presented.body}</Text> : null}
                        <Text style={styles.notificationDate}>{formatShortDateTime(item.createdAt, locale)}</Text>
                      </View>
                      {!item.isRead ? <View style={styles.unreadDot} /> : null}
                    </Pressable>
                  )
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Pill({ label, tone, icon, duplicateIcon = false }: { label: string; tone: "warning" | "info" | "success"; icon?: TabIconName; duplicateIcon?: boolean }) {
  const iconColor = tone === "warning" ? colors.warning : tone === "success" ? colors.successDark : colors.info
  return <View style={[styles.pill, tone === "warning" ? styles.pillWarning : tone === "success" ? styles.pillSuccess : styles.pillInfo]}>{icon ? <View style={styles.pillIcons}><TabIcon name={icon} color={iconColor} size={11} />{duplicateIcon ? <TabIcon name={icon} color={iconColor} size={11} /> : null}</View> : null}<Text style={[styles.pillText, tone === "warning" ? styles.pillWarningText : tone === "success" ? styles.pillSuccessText : styles.pillInfoText]}>{label}</Text></View>
}

function Empty({ icon, title, hint }: { icon: TabIconName; title: string; hint: string }) {
  return <View style={styles.emptyCard}><View accessible={false} style={styles.emptyIcon}><TabIcon name={icon} color={colors.primary} size={28} /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyHint}>{hint}</Text></View>
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { minHeight: "100%", paddingBottom: 30 },
  header: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 13, flexDirection: "row", alignItems: "center", gap: 10 },
  headerBody: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  title: { color: colors.text, fontSize: 28, fontWeight: "900", letterSpacing: -0.7, marginTop: 3 },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  newButton: { minWidth: 84, minHeight: 48, borderRadius: 16, paddingHorizontal: 10, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  newButtonIcon: { height: 19, alignItems: "center", justifyContent: "center" },
  newButtonText: { color: colors.headerText, fontSize: 9, fontWeight: "900", marginTop: 2 },
  segment: { marginHorizontal: 14, padding: 4, borderRadius: 16, backgroundColor: "#E9E9EE", flexDirection: "row", gap: 4 },
  segmentButton: { flex: 1, minHeight: 44, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  segmentActive: { backgroundColor: colors.card, ...cardShadow },
  segmentText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  segmentTextActive: { color: colors.text },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  countText: { color: colors.headerText, fontSize: 9, fontWeight: "900" },
  warning: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.inner, padding: 11, backgroundColor: colors.warningBg, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  warningIcon: { width: 17, height: 17, alignItems: "center", justifyContent: "center", marginTop: 1 },
  warningText: { flex: 1, color: colors.warning, fontSize: 10, lineHeight: 15, fontWeight: "800" },
  readAll: { alignSelf: "flex-end", minHeight: 44, marginRight: 14, marginTop: 12, borderRadius: radii.pill, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  readAllText: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  list: { paddingTop: 3 },
  messageCard: { minHeight: 88, marginHorizontal: 14, marginTop: 10, padding: 13, borderRadius: radii.card, backgroundColor: colors.card, flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: colors.border, ...cardShadow },
  notificationCard: { minHeight: 82, marginHorizontal: 14, marginTop: 10, padding: 13, borderRadius: radii.card, backgroundColor: colors.card, flexDirection: "row", alignItems: "flex-start", gap: 11, borderWidth: 1, borderColor: colors.border, ...cardShadow },
  messageUnread: { borderColor: colors.infoBorder, backgroundColor: "#FCFDFF" },
  avatar: { width: 48, height: 48, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  broadcastAvatar: { backgroundColor: colors.warningBg },
  avatarText: { color: colors.primary, fontSize: 17, fontWeight: "900" },
  messageBody: { flex: 1, minWidth: 0 },
  messageTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  messageTitle: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "900" },
  time: { color: colors.faint, fontSize: 9, fontWeight: "700" },
  preview: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  attachmentPreview: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  attachmentPreviewText: { marginTop: 0 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 7 },
  pill: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 3 },
  pillIcons: { flexDirection: "row", alignItems: "center", gap: 1 },
  pillWarning: { backgroundColor: colors.warningBg },
  pillInfo: { backgroundColor: colors.infoBg },
  pillSuccess: { backgroundColor: colors.successBg },
  pillText: { fontSize: 8, fontWeight: "900" },
  pillWarningText: { color: colors.warning },
  pillInfoText: { color: colors.info },
  pillSuccessText: { color: colors.successDark },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  chevron: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  typeIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  notificationDate: { color: colors.faint, fontSize: 9, fontWeight: "600", marginTop: 7 },
  emptyCard: { margin: 14, minHeight: 310, padding: 28, backgroundColor: colors.card, borderRadius: radii.card, alignItems: "center", justifyContent: "center", ...cardShadow },
  emptyIcon: { width: 68, height: 68, borderRadius: 23, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "900", textAlign: "center" },
  emptyHint: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 7, maxWidth: 280 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
  listTablet: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 14, paddingTop: 12, alignItems: "flex-start" },
  listCardTablet: { flexBasis: "48%", flexGrow: 1, marginHorizontal: 0, marginTop: 0 },
})
