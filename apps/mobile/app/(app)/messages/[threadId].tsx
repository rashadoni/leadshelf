import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { router, useFocusEffect, useLocalSearchParams } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import {
  cacheFieldMessageThread,
  enqueueFieldMessage,
  enqueueFieldMessageReceipt,
  readFieldMessageThread,
  type FieldDocumentDraft,
} from "../../../src/db/local-store"
import { formatFileSize, openLocalDocument, pickFieldDocument } from "../../../src/field/document-files"
import type { FieldMessageThreadData } from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import { fieldErrorMessage } from "../../../src/field/error-message"
import { t, useLocale } from "../../../src/i18n"
import { formatTime } from "../../../src/i18n/date-format"
import { useSync } from "../../../src/sync/sync-context"
import { colors, cardShadow, radii } from "../../../src/theme"
import { TabIcon } from "../../../src/components/TabIcon"

function messageThreadTypeLabel(type: string): string {
  if (type === "DIRECT") return t("messageThreadType_DIRECT")
  if (type === "BROADCAST") return t("messageThreadType_BROADCAST")
  if (type === "SYSTEM") return t("messageThreadType_SYSTEM")
  return t("messageThreadType_UNKNOWN")
}

export default function MessageThreadScreen() {
  const { threadId = "" } = useLocalSearchParams<{ threadId?: string }>()
  const locale = useLocale()
  const field = useField()
  const { sync } = useSync()
  const [data, setData] = useState<FieldMessageThreadData | null>(() => readFieldMessageThread(threadId))
  const [body, setBody] = useState("")
  const [attachment, setAttachment] = useState<FieldDocumentDraft | null>(null)
  const [localFiles, setLocalFiles] = useState<Record<string, string>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const markedMessage = useRef<string | null>(null)
  const scroll = useRef<ScrollView | null>(null)
  const stickToLatest = useRef(true)
  const copy = locale === "az" ? {
    messages: "MESAJLAR", loading: "Dialoq yüklənir…", offline: "Dialoq yenilənmədi — telefondakı nüsxə göstərilir.",
    readonly: "Bu elan yalnız oxumaq üçündür.", message: "Mesaj", placeholder: "Mesaj yazın…", attach: "Fayl", send: "Göndər",
    ack: "Oxudum, təsdiq edirəm", acked: "Təsdiqləndi", queued: "Növbədə", file: "Fayl",
    sent: "Göndərildi", read: "Oxunub",
    download: "Yüklə", open: "Aç", downloadError: "Faylı açmaq alınmadı", empty: "Bu dialoqda hələ mesaj yoxdur.",
  } : {
    messages: "СООБЩЕНИЯ", loading: "Загружаем диалог…", offline: "Диалог не обновился — показана копия с телефона.",
    readonly: "Это объявление доступно только для чтения.", message: "Сообщение", placeholder: "Напишите сообщение…", attach: "Файл", send: "Отправить",
    ack: "Прочитал(а), подтверждаю", acked: "Подтверждено", queued: "В очереди", file: "Файл",
    sent: "Отправлено", read: "Прочитано",
    download: "Скачать", open: "Открыть", downloadError: "Не удалось открыть файл", empty: "В этом диалоге пока нет сообщений.",
  }

  const load = useCallback(async (showWarning = false) => {
    try {
      const next = cacheFieldMessageThread(await fieldApi.messageThread(threadId))
      setData(next)
      setWarning(null)
    } catch {
      setData(readFieldMessageThread(threadId))
      if (showWarning) setWarning(copy.offline)
    }
  }, [copy.offline, threadId])

  useFocusEffect(useCallback(() => {
    // Returning to a thread should show the latest exchange, but a user who
    // deliberately scrolled up must be able to keep reading older messages.
    stickToLatest.current = true
    setData(readFieldMessageThread(threadId))
    void load(false)
  }, [load, threadId]))

  const latestIncomingUnread = useMemo(() => [...(data?.thread.messages ?? [])].reverse().find((message) => (
    message.senderAgentId !== field.profile?.agent.id && !message.read
  )) ?? null, [data?.thread.messages, field.profile?.agent.id])

  useEffect(() => {
    if (!latestIncomingUnread || markedMessage.current === latestIncomingUnread.id) return
    markedMessage.current = latestIncomingUnread.id
    enqueueFieldMessageReceipt({ threadId, messageId: latestIncomingUnread.id, type: "READ" })
    setData(readFieldMessageThread(threadId))
    void sync().catch(() => {})
  }, [latestIncomingUnread, sync, threadId])

  const title = useMemo(() => {
    if (!data) return "…"
    if (data.thread.subject) return data.thread.subject
    return data.thread.participants.filter((person) => person.id !== field.profile?.agent.id).map((person) => person.name).join(", ") || t("messageThreadFallback")
  }, [data, field.profile?.agent.id, locale])

  async function refresh() {
    setRefreshing(true)
    await load(true)
    setRefreshing(false)
  }

  async function chooseFile() {
    try {
      const file = await pickFieldDocument()
      if (file) setAttachment(file)
    } catch (cause) {
      setWarning(fieldErrorMessage(cause, "messageActionFailed"))
    }
  }

  async function send() {
    if ((!body.trim() && !attachment) || busy) return
    setBusy(true)
    try {
      enqueueFieldMessage({ threadId, recipientAgentId: null, body: body.trim() || null }, attachment)
      setBody("")
      setAttachment(null)
      setData(readFieldMessageThread(threadId))
      stickToLatest.current = true
      requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: true }))
      await sync().catch(() => {})
      await load(false)
    } catch (cause) {
      setWarning(fieldErrorMessage(cause, "messageActionFailed"))
    } finally {
      setBusy(false)
    }
  }

  async function acknowledge(messageId: string) {
    enqueueFieldMessageReceipt({ threadId, messageId, type: "ACKNOWLEDGED" })
    setData(readFieldMessageThread(threadId))
    void sync().then(() => load(false)).catch(() => {})
  }

  async function openAttachment(document: { id: string; fileName: string; mimeType: string; downloadUrl?: string; localUri?: string | null }) {
    try {
      const localUri = localFiles[document.id] ?? document.localUri ?? await fieldApi.downloadDocument({
        documentId: document.id,
        fileName: document.fileName,
        downloadUrl: document.downloadUrl,
      })
      setLocalFiles((current) => ({ ...current, [document.id]: localUri }))
      await openLocalDocument(localUri, document.mimeType)
    } catch (cause) {
      Alert.alert(copy.downloadError, fieldErrorMessage(cause, "documentOpenUnavailable"))
    }
  }

  if (!data) {
    return <SafeAreaView style={styles.root} edges={["top"]}><View style={styles.loading}><Text style={styles.loadingMark}>•••</Text><Text style={styles.loadingText}>{copy.loading}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.loadingBack}><TabIcon name="chevronLeft" color={colors.text} size={21} /></Pressable></View></SafeAreaView>
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={8}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.back}><TabIcon name="chevronLeft" color={colors.text} size={21} /></Pressable>
          <View style={styles.headerBody}><Text style={styles.eyebrow}>{copy.messages}</Text><Text style={styles.title} numberOfLines={1}>{title}</Text><Text style={styles.participants}>{messageThreadTypeLabel(data.thread.type)}</Text></View>
        </View>
        {warning ? <View style={styles.warning}><Text style={styles.warningText}>{warning}</Text></View> : null}
        <ScrollView
          ref={scroll}
          style={styles.flex}
          contentContainerStyle={styles.messages}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
          scrollEventThrottle={16}
          onScroll={({ nativeEvent }) => {
            // Keep following the conversation only while the reader is
            // already near its end. A refresh must not pull them away from
            // an older message they intentionally opened.
            stickToLatest.current = nativeEvent.layoutMeasurement.height + nativeEvent.contentOffset.y >= nativeEvent.contentSize.height - 44
          }}
          onContentSizeChange={() => {
            if (stickToLatest.current) scroll.current?.scrollToEnd({ animated: false })
          }}
        >
          {data.thread.messages.length === 0 ? <Text style={styles.empty}>{copy.empty}</Text> : null}
          {data.thread.messages.map((message) => {
            const own = message.senderAgentId === field.profile?.agent.id || Boolean(message.syncState)
            const localUri = message.attachmentDocument ? localFiles[message.attachmentDocument.id] ?? message.attachmentDocument.localUri : null
            return (
              <View key={message.id} style={[styles.messageRow, own && styles.messageRowOwn]}>
                {!own ? <View style={styles.smallAvatar}><Text style={styles.smallAvatarText}>{message.senderName.charAt(0)}</Text></View> : null}
                <View style={[styles.bubble, own ? styles.bubbleOwn : styles.bubbleOther]}>
                  {!own ? <Text style={styles.sender}>{message.senderName}</Text> : null}
                  {message.body ? <Text style={[styles.body, own && styles.bodyOwn]}>{message.body}</Text> : null}
                  {message.attachmentDocument ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`${localUri ? copy.open : copy.download}: ${message.attachmentDocument.fileName}`} onPress={() => void openAttachment({
                      id: message.attachmentDocument!.id,
                      fileName: message.attachmentDocument!.fileName,
                      mimeType: message.attachmentDocument!.mimeType,
                      downloadUrl: message.attachmentDocument!.downloadUrl,
                      localUri,
                    })} style={[styles.attachment, own && styles.attachmentOwn]}>
                      <View style={styles.attachmentIcon}><Text style={styles.attachmentIconText}>DOC</Text></View>
                      <View style={styles.attachmentBody}><Text style={[styles.attachmentName, own && styles.attachmentNameOwn]} numberOfLines={1}>{message.attachmentDocument.fileName}</Text><Text style={[styles.attachmentMeta, own && styles.attachmentMetaOwn]}>{formatFileSize(message.attachmentDocument.sizeBytes, locale)} · {localUri ? copy.open : copy.download}</Text></View>
                    </Pressable>
                  ) : null}
                  <View style={styles.messageMeta}>
                    <Text style={[styles.messageTime, own && styles.messageTimeOwn]}>{formatTime(message.sentAt)}</Text>
                    {message.syncState ? <Text style={styles.queued}>{copy.queued}</Text> : null}
                    {!message.syncState && message.delivery ? (
                      <View style={styles.delivery}>
                        <TabIcon name="check" color={colors.headerSubtext} size={10} />
                        {message.delivery.status === "READ" ? <TabIcon name="check" color={colors.headerSubtext} size={10} /> : null}
                        <Text style={styles.deliveryText}>{message.delivery.status === "READ" ? copy.read : copy.sent}</Text>
                      </View>
                    ) : null}
                  </View>
                  {message.acknowledgementRequired ? (
                    message.acknowledged ? <View style={styles.acked}><TabIcon name="check" color={colors.successDark} size={14} /><Text style={styles.ackedText}>{copy.acked}</Text></View> : <Pressable accessibilityRole="button" accessibilityLabel={copy.ack} onPress={() => acknowledge(message.id)} style={styles.ack}><Text style={styles.ackText}>{copy.ack}</Text></Pressable>
                  ) : null}
                </View>
              </View>
            )
          })}
        </ScrollView>

        {data.capabilities.reply ? (
          <View style={styles.composer}>
            {attachment ? <View style={styles.selectedFile}><TabIcon name="document" color={colors.info} size={16} /><Text style={styles.selectedFileText} numberOfLines={1}>{attachment.fileName}</Text><Pressable accessibilityRole="button" accessibilityLabel={t("cancel")} onPress={() => setAttachment(null)} style={styles.selectedFileRemove}><TabIcon name="close" color={colors.info} size={18} /></Pressable></View> : null}
            <View style={styles.composerRow}>
              <Pressable accessibilityRole="button" accessibilityLabel={copy.attach} onPress={() => void chooseFile()} style={styles.attachButton}><TabIcon name="document" color={colors.primary} size={18} /><Text style={styles.attachButtonLabel}>{copy.attach}</Text></Pressable>
              <TextInput accessibilityLabel={copy.message} accessibilityHint={copy.placeholder} value={body} onChangeText={setBody} multiline maxLength={4000} placeholder={copy.placeholder} placeholderTextColor={colors.faint} style={styles.input} />
              <Pressable accessibilityRole="button" accessibilityLabel={copy.send} disabled={busy || (!body.trim() && !attachment)} onPress={() => void send()} style={[styles.send, (busy || (!body.trim() && !attachment)) && styles.disabled]}><TabIcon name="route" color={colors.headerText} size={20} /></Pressable>
            </View>
          </View>
        ) : <View style={styles.readonly}><Text style={styles.readonlyText}>{copy.readonly}</Text></View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, flex: { flex: 1 },
  header: { minHeight: 70, paddingHorizontal: 13, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }, headerBody: { flex: 1, minWidth: 0 }, eyebrow: { color: colors.primary, fontSize: 8, fontWeight: "900", letterSpacing: 0.9 }, title: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 2 }, participants: { color: colors.muted, fontSize: 8, fontWeight: "800", marginTop: 2 },
  warning: { margin: 10, marginBottom: 0, padding: 10, borderRadius: 12, backgroundColor: colors.warningBg }, warningText: { color: colors.warning, fontSize: 9, lineHeight: 14, fontWeight: "800" },
  messages: { paddingHorizontal: 12, paddingVertical: 14, gap: 10 }, empty: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 80 },
  messageRow: { flexDirection: "row", alignItems: "flex-end", gap: 7, maxWidth: "88%" }, messageRowOwn: { alignSelf: "flex-end", justifyContent: "flex-end" },
  smallAvatar: { width: 28, height: 28, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, smallAvatarText: { color: colors.primary, fontSize: 10, fontWeight: "900" },
  bubble: { minWidth: 88, maxWidth: "100%", borderRadius: 18, paddingHorizontal: 12, paddingVertical: 9 }, bubbleOwn: { backgroundColor: colors.primary, borderBottomRightRadius: 5 }, bubbleOther: { backgroundColor: colors.card, borderBottomLeftRadius: 5, ...cardShadow },
  sender: { color: colors.primary, fontSize: 8, fontWeight: "900", marginBottom: 4 }, body: { color: colors.text, fontSize: 13, lineHeight: 19 }, bodyOwn: { color: colors.headerText },
  attachment: { marginTop: 7, minHeight: 52, borderRadius: 13, padding: 7, backgroundColor: colors.bg, flexDirection: "row", alignItems: "center", gap: 8 }, attachmentOwn: { backgroundColor: "rgba(255,255,255,0.15)" }, attachmentIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" }, attachmentIconText: { color: colors.info, fontSize: 7, fontWeight: "900" }, attachmentBody: { flex: 1, minWidth: 0 }, attachmentName: { color: colors.text, fontSize: 10, fontWeight: "900" }, attachmentNameOwn: { color: colors.headerText }, attachmentMeta: { color: colors.info, fontSize: 8, fontWeight: "700", marginTop: 2 }, attachmentMetaOwn: { color: colors.headerSubtext },
  messageMeta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, marginTop: 5 }, messageTime: { color: colors.faint, fontSize: 7, fontWeight: "700" }, messageTimeOwn: { color: colors.headerSubtext }, queued: { color: "#E0E7FF", fontSize: 7, fontWeight: "900" }, delivery: { flexDirection: "row", alignItems: "center", gap: 1 }, deliveryText: { color: colors.headerSubtext, fontSize: 7, fontWeight: "900" },
  ack: { marginTop: 8, minHeight: 44, borderRadius: 12, paddingHorizontal: 10, backgroundColor: colors.warningBg, alignItems: "center", justifyContent: "center" }, ackText: { color: colors.warning, fontSize: 9, fontWeight: "900" }, acked: { marginTop: 7, alignSelf: "flex-start", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: colors.successBg, flexDirection: "row", alignItems: "center", gap: 4 }, ackedText: { color: colors.successDark, fontSize: 8, fontWeight: "900" },
  composer: { padding: 10, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border }, composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  selectedFile: { minHeight: 44, marginBottom: 7, borderRadius: 11, paddingHorizontal: 10, backgroundColor: colors.infoBg, flexDirection: "row", alignItems: "center", gap: 7 }, selectedFileText: { flex: 1, color: colors.info, fontSize: 9, fontWeight: "800" }, selectedFileRemove: { width: 44, height: 44, marginVertical: -4, marginRight: -10, alignItems: "center", justifyContent: "center" },
  attachButton: { width: 48, minHeight: 48, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, attachButtonLabel: { color: colors.primary, fontSize: 7, fontWeight: "900" },
  input: { flex: 1, minHeight: 48, maxHeight: 112, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 12, backgroundColor: colors.bg, color: colors.text, fontSize: 12, lineHeight: 17 }, send: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, disabled: { opacity: 0.35 },
  readonly: { minHeight: 58, paddingHorizontal: 16, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, alignItems: "center", justifyContent: "center" }, readonlyText: { color: colors.muted, fontSize: 10, fontWeight: "800" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, loadingMark: { color: colors.primary, fontSize: 24, fontWeight: "900" }, loadingText: { color: colors.muted, fontSize: 12, marginTop: 9 }, loadingBack: { position: "absolute", top: 12, left: 14, width: 44, height: 44, borderRadius: 15, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
})
