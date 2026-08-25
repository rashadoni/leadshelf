import { useEffect, useState } from "react"
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { enqueueFieldMessage, type FieldDocumentDraft } from "../../../src/db/local-store"
import { formatFileSize, pickFieldDocument } from "../../../src/field/document-files"
import { fieldErrorMessage } from "../../../src/field/error-message"
import { useField } from "../../../src/field/field-context"
import { agentRoleLabel } from "../../../src/field/labels"
import { t, useLocale } from "../../../src/i18n"
import { safeFieldBack } from "../../../src/navigation/safe-back"
import { useSync } from "../../../src/sync/sync-context"
import { colors, cardShadow, radii } from "../../../src/theme"
import { TabIcon } from "../../../src/components/TabIcon"

export default function NewMessageScreen() {
  const locale = useLocale()
  const field = useField()
  const { sync } = useSync()
  const inbox = field.messages
  const [recipientId, setRecipientId] = useState<string | null>(null)
  const [body, setBody] = useState("")
  const [attachment, setAttachment] = useState<FieldDocumentDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const copy = locale === "az" ? {
    eyebrow: "MESAJLAR",
    title: "Yeni dialoq",
    hint: "Menecer və ya komanda üzvünü seçin. Mesaj internet olmasa da saxlanılacaq.",
    recipient: "Kimə",
    message: "Mesaj",
    placeholder: "Qısa və aydın yazın…",
    attach: "Fayl əlavə et",
    local: "Fayl yalnız cihazda saxlanılır və şirkət serverinə göndərilir. Bulud diski istifadə edilmir.",
    send: "Göndər",
    required: "Əməkdaş seçin və mesaj və ya fayl əlavə edin.",
    queuedTitle: "Mesaj saxlanıldı",
    queuedBody: "Göndərmə növbəsinə əlavə edildi.",
    recipientsLoading: "Əlçatan əməkdaşlar yüklənir…",
    noRecipients: "Yeni dialoq üçün əlçatan əməkdaş yoxdur.",
    noRecipientsHint: "Gələnlər bölməsinə qayıdın və məlumatı yeniləyin və ya rəhbərə müraciət edin.",
    discardTitle: "Mesajı ləğv edək?",
    discardBody: "Yazdığınız mətn və seçilmiş fayl silinəcək.",
    discardConfirm: "Ləğv et",
  } : {
    eyebrow: "СООБЩЕНИЯ",
    title: "Новый диалог",
    hint: "Выберите руководителя или коллегу. Сообщение сохранится даже без интернета.",
    recipient: "Кому",
    message: "Сообщение",
    placeholder: "Напишите коротко и понятно…",
    attach: "Прикрепить файл",
    local: "Файл хранится на устройстве и отправляется только на сервер компании. Облачный диск не используется.",
    send: "Отправить",
    required: "Выберите получателя и добавьте сообщение или файл.",
    queuedTitle: "Сообщение сохранено",
    queuedBody: "Оно добавлено в очередь на отправку.",
    recipientsLoading: "Загружаем доступных сотрудников…",
    noRecipients: "Нет доступных сотрудников для нового диалога.",
    noRecipientsHint: "Вернитесь во «Входящие» и обновите данные или обратитесь к руководителю.",
    discardTitle: "Отменить сообщение?",
    discardBody: "Набранный текст и выбранный файл будут удалены.",
    discardConfirm: "Отменить",
  }

  const canSend = Boolean(recipientId && (body.trim() || attachment))

  useEffect(() => {
    if (recipientId && !inbox.availableRecipients.some((person) => person.id === recipientId)) {
      setRecipientId(null)
    }
  }, [inbox.availableRecipients, recipientId])

  async function chooseFile() {
    setError(null)
    try {
      const file = await pickFieldDocument()
      if (file) setAttachment(file)
    } catch (cause) {
      setError(fieldErrorMessage(cause, "messageActionFailed"))
    }
  }

  async function send() {
    if (!recipientId || !canSend || busy) {
      setError(copy.required)
      return
    }
    setBusy(true)
    setError(null)
    try {
      enqueueFieldMessage({ threadId: null, recipientAgentId: recipientId, body: body.trim() || null }, attachment)
      Alert.alert(copy.queuedTitle, copy.queuedBody, [{ text: t("ok"), onPress: () => safeFieldBack("/(app)/(tabs)/inbox") }])
      void sync().catch(() => {})
    } catch (cause) {
      setError(fieldErrorMessage(cause, "messageActionFailed"))
    } finally {
      setBusy(false)
    }
  }

  function goBack() {
    if (busy) return
    if (!body.trim() && !attachment) {
      safeFieldBack("/(app)/(tabs)/inbox")
      return
    }
    Alert.alert(copy.discardTitle, copy.discardBody, [
      { text: t("cancel"), style: "cancel" },
      { text: copy.discardConfirm, style: "destructive", onPress: () => safeFieldBack("/(app)/(tabs)/inbox") },
    ])
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("back")} accessibilityState={{ disabled: busy }} disabled={busy} onPress={goBack} style={[styles.back, busy && styles.disabled]}>
              <TabIcon name="chevronLeft" color={colors.text} size={21} />
            </Pressable>
            <View style={styles.headerBody}><Text style={styles.eyebrow}>{copy.eyebrow}</Text><Text style={styles.title}>{copy.title}</Text></View>
          </View>
          <Text style={styles.intro}>{copy.hint}</Text>

          <Text style={styles.sectionTitle}>{copy.recipient}</Text>
          <View style={styles.recipients}>
            {inbox.availableRecipients.length > 0 ? inbox.availableRecipients.map((person) => (
              <Pressable key={person.id} accessibilityRole="button" accessibilityState={{ selected: recipientId === person.id }} accessibilityLabel={`${person.name}, ${agentRoleLabel(person.role)}`} onPress={() => setRecipientId(person.id)} style={[styles.recipient, recipientId === person.id && styles.recipientSelected]}>
                <View style={[styles.avatar, recipientId === person.id && styles.avatarSelected]}><Text style={[styles.avatarText, recipientId === person.id && styles.avatarTextSelected]}>{person.name.charAt(0).toUpperCase()}</Text></View>
                <View style={styles.recipientBody}><Text style={[styles.recipientName, recipientId === person.id && styles.recipientNameSelected]} numberOfLines={1}>{person.name}</Text><Text style={[styles.recipientRole, recipientId === person.id && styles.recipientRoleSelected]}>{agentRoleLabel(person.role)}</Text></View>
                {recipientId === person.id ? <TabIcon name="check" color={colors.headerText} size={20} /> : null}
              </Pressable>
            )) : <View style={styles.recipientsEmpty}><TabIcon name="inbox" color={colors.info} size={20} /><View style={styles.recipientsEmptyBody}><Text style={styles.recipientsEmptyTitle}>{field.phase === "loading" || field.phase === "refreshing" ? copy.recipientsLoading : copy.noRecipients}</Text>{field.phase === "loading" || field.phase === "refreshing" ? null : <Text style={styles.recipientsEmptyHint}>{copy.noRecipientsHint}</Text>}</View></View>}
          </View>

          <Text style={styles.sectionTitle}>{copy.message}</Text>
          <View style={styles.composer}>
            <TextInput accessibilityLabel={copy.message} accessibilityHint={copy.placeholder} value={body} onChangeText={setBody} multiline maxLength={4000} placeholder={copy.placeholder} placeholderTextColor={colors.faint} textAlignVertical="top" style={styles.input} />
            {attachment ? (
              <View style={styles.fileCard}>
                <View style={styles.fileIcon}><Text style={styles.fileIconText}>DOC</Text></View>
                <View style={styles.fileBody}><Text style={styles.fileName} numberOfLines={1}>{attachment.fileName}</Text><Text style={styles.fileMeta}>{formatFileSize(attachment.sizeBytes, locale)}</Text></View>
                <Pressable accessibilityRole="button" accessibilityLabel={t("cancel")} onPress={() => setAttachment(null)} style={styles.remove}><TabIcon name="close" color={colors.muted} size={19} /></Pressable>
              </View>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel={copy.attach} onPress={() => void chooseFile()} style={styles.attach}><TabIcon name="document" color={colors.primary} size={19} /><Text style={styles.attachText}>{copy.attach}</Text></Pressable>
            )}
          </View>

          <View style={styles.privacy}><TabIcon name="info" color={colors.successDark} size={18} /><Text style={styles.privacyText}>{copy.local}</Text></View>
          {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={copy.send} accessibilityState={{ disabled: busy || !canSend, busy }} disabled={busy || !canSend} onPress={() => void send()} style={({ pressed }) => [styles.send, (pressed || busy || !canSend) && styles.pressed]}><Text style={styles.sendText}>{busy ? "…" : copy.send}</Text>{!busy ? <TabIcon name="route" color={colors.headerText} size={20} /> : null}</Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, flex: { flex: 1 }, scroll: { paddingBottom: 34 },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  back: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  headerBody: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 0.9 }, title: { color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 2 },
  intro: { color: colors.muted, fontSize: 12, lineHeight: 18, marginHorizontal: 16, marginTop: 12 },
  sectionTitle: { color: colors.text, fontSize: 14, fontWeight: "900", marginHorizontal: 16, marginTop: 22, marginBottom: 9 },
  recipients: { gap: 8, paddingHorizontal: 14 },
  recipient: { minHeight: 64, borderRadius: 17, padding: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 10 },
  recipientsEmpty: { minHeight: 74, borderRadius: 17, padding: 12, backgroundColor: colors.infoBg, flexDirection: "row", alignItems: "flex-start", gap: 9 }, recipientsEmptyBody: { flex: 1 }, recipientsEmptyTitle: { color: colors.info, fontSize: 10, lineHeight: 15, fontWeight: "900" }, recipientsEmptyHint: { color: colors.info, fontSize: 9, lineHeight: 14, marginTop: 3 },
  recipientSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }, avatarSelected: { backgroundColor: "rgba(255,255,255,0.18)" },
  avatarText: { color: colors.primary, fontSize: 15, fontWeight: "900" }, avatarTextSelected: { color: colors.headerText },
  recipientBody: { flex: 1 }, recipientName: { color: colors.text, fontSize: 13, fontWeight: "900" }, recipientNameSelected: { color: colors.headerText }, recipientRole: { color: colors.muted, fontSize: 9, fontWeight: "800", marginTop: 3 }, recipientRoleSelected: { color: colors.headerSubtext },
  composer: { marginHorizontal: 14, borderRadius: radii.card, padding: 13, backgroundColor: colors.card, ...cardShadow },
  input: { minHeight: 130, color: colors.text, fontSize: 14, lineHeight: 21, padding: 2 },
  attach: { minHeight: 48, borderRadius: 14, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.infoBorder, borderStyle: "dashed", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  attachText: { color: colors.primary, fontSize: 11, fontWeight: "900" },
  fileCard: { minHeight: 58, borderRadius: 14, padding: 9, backgroundColor: colors.infoBg, flexDirection: "row", alignItems: "center", gap: 9 },
  fileIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" }, fileIconText: { color: colors.info, fontSize: 8, fontWeight: "900" }, fileBody: { flex: 1 }, fileName: { color: colors.text, fontSize: 11, fontWeight: "900" }, fileMeta: { color: colors.info, fontSize: 9, fontWeight: "700", marginTop: 3 }, remove: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  privacy: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.inner, padding: 11, backgroundColor: colors.successBg, flexDirection: "row", alignItems: "flex-start", gap: 8 }, privacyText: { flex: 1, color: colors.successDark, fontSize: 9, lineHeight: 14, fontWeight: "700" },
  error: { marginHorizontal: 14, marginTop: 12, borderRadius: radii.inner, padding: 11, backgroundColor: colors.dangerBg }, errorText: { color: colors.missed, fontSize: 10, lineHeight: 15, fontWeight: "800" },
  send: { minHeight: 54, marginHorizontal: 14, marginTop: 18, borderRadius: 17, backgroundColor: colors.primary, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 }, sendText: { color: colors.headerText, fontSize: 14, fontWeight: "900" }, pressed: { opacity: 0.7 }, disabled: { opacity: 0.5 },
})
