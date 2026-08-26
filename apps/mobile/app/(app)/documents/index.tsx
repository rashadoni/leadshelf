import { useCallback, useMemo, useState } from "react"
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { fieldApi } from "../../../src/api/mobile-client"
import {
  cacheFieldDocuments,
  enqueueFieldDocumentState,
  enqueueFieldDocumentUpload,
  readFieldDocuments,
  setFieldDocumentLocalUri,
} from "../../../src/db/local-store"
import { formatFileSize, openLocalDocument, pickFieldDocument } from "../../../src/field/document-files"
import type { FieldDocument } from "../../../src/field/contracts"
import { useField } from "../../../src/field/field-context"
import { fieldErrorMessage } from "../../../src/field/error-message"
import { t, useLocale } from "../../../src/i18n"
import { useResponsiveLayout } from "../../../src/layout/responsive"
import { useSync } from "../../../src/sync/sync-context"
import { colors, cardShadow, radii } from "../../../src/theme"
import { FieldScreenChrome } from "../../../src/components/FieldScreenChrome"
import { TabIcon } from "../../../src/components/TabIcon"
import { safeFieldBack } from "../../../src/navigation/safe-back"

type DocumentFilter = "all" | "required" | "offline"
type UploadScope = { kind: "general"; id: null; label: string } | { kind: "visit" | "task"; id: string; label: string }
type Warning = { message: string; retryable?: boolean }

export default function DocumentsScreen() {
  const locale = useLocale()
  const field = useField()
  const layout = useResponsiveLayout()
  const { sync } = useSync()
  const [data, setData] = useState(readFieldDocuments)
  const [filter, setFilter] = useState<DocumentFilter>("all")
  const [uploadOpen, setUploadOpen] = useState(false)
  const [selectedScope, setSelectedScope] = useState<UploadScope | null>(null)
  const [taskPickerOpen, setTaskPickerOpen] = useState(false)
  const [taskQuery, setTaskQuery] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [picking, setPicking] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [warning, setWarning] = useState<Warning | null>(null)
  const copy = locale === "az" ? {
    eyebrow: "İŞ MƏRKƏZİ", title: "Sənədlər", hint: "Tapşırıq faylları, vizit materialları və ofisdən göndərilən sənədlər.",
    add: "Fayl əlavə et", all: "Hamısı", required: "Vacib", offline: "Telefonda", empty: "Bu bölmədə sənəd yoxdur",
    emptyHint: "Filtri dəyişin və ya yeni fayl əlavə edin.", requiredBadge: "Mütləq", unread: "Yeni", downloaded: "Telefonda",
    queued: "Növbədə", failed: "Diqqət lazımdır", download: "Yüklə", open: "Aç", cloudOff: "Bulud diski istifadə edilmir",
    uploadTitle: "Faylı hara bağlayaq?", general: "Ümumi sənəd", visit: "Aktiv vizit", task: "Tapşırıq",
    choose: "Fayl seç", cancel: "Ləğv et", saved: "Fayl saxlanıldı", savedHint: "Göndərmə növbəsinə əlavə edildi.",
    refreshError: "Sənədlər yenilənmədi — telefondakı nüsxə göstərilir.", noScope: "Əvvəlcə faylın kontekstini seçin.",
    taskSearch: "Tapşırığı axtar", taskSearchEmpty: "Uyğun açıq tapşırıq yoxdur",
    uploadUnavailable: "Bu hesab üçün fayl əlavə etmək icazəli deyil.", downloadUnavailable: "Bu sənədi telefona endirmək icazəli deyil.", uploadLimit: "Maksimum ölçü: {size}",
  } : {
    eyebrow: "РАБОЧИЙ ЦЕНТР", title: "Документы", hint: "Файлы задач, материалы визитов и документы, назначенные офисом.",
    add: "Добавить файл", all: "Все", required: "Обязательные", offline: "На телефоне", empty: "Здесь пока нет документов",
    emptyHint: "Смените фильтр или добавьте новый файл.", requiredBadge: "Обязательный", unread: "Новый", downloaded: "На телефоне",
    queued: "В очереди", failed: "Нужно внимание", download: "Скачать", open: "Открыть", cloudOff: "Облачный диск не используется",
    uploadTitle: "К чему привязать файл?", general: "Общий документ", visit: "Активный визит", task: "Задача",
    choose: "Выбрать файл", cancel: "Отмена", saved: "Файл сохранён", savedHint: "Он добавлен в очередь на отправку.",
    refreshError: "Документы не обновились — показана копия с телефона.", noScope: "Сначала выберите контекст файла.",
    taskSearch: "Найти задачу", taskSearchEmpty: "Подходящих открытых задач нет",
    uploadUnavailable: "Для этой учётной записи добавление файлов недоступно.", downloadUnavailable: "Скачать этот документ на телефон нельзя.", uploadLimit: "Максимальный размер: {size}",
  }
  const canUpload = data.capabilities.upload
  const uploadLimitText = copy.uploadLimit.replace("{size}", formatFileSize(data.capabilities.maxUploadBytes, locale))

  const activeVisit = useMemo(() => field.week?.days.flatMap((day) => day.visits.items).find((visit) => visit.status === "CHECKED_IN") ?? null, [field.week])
  const scopes = useMemo<UploadScope[]>(() => [
    { kind: "general", id: null, label: copy.general },
    ...(activeVisit ? [{ kind: "visit" as const, id: activeVisit.id, label: `${copy.visit}: ${activeVisit.customer.name}` }] : []),
  ], [activeVisit, copy.general, copy.visit])
  const taskScopes = useMemo<UploadScope[]>(() => (
    field.agentTasks?.tasks
      .filter((task) => task.status !== "COMPLETED" && task.status !== "CANCELLED")
      .map((task) => ({ kind: "task" as const, id: task.id, label: `${copy.task}: ${task.title}` })) ?? []
  ), [copy.task, field.agentTasks?.tasks])
  const visibleTaskScopes = useMemo(() => {
    const query = taskQuery.trim().toLocaleLowerCase()
    if (!query) return taskScopes
    return taskScopes.filter((scope) => scope.label.toLocaleLowerCase().includes(query))
  }, [taskQuery, taskScopes])

  const visible = useMemo(() => data.documents.filter((document) => {
    if (filter === "required") return document.assignment.required && !document.assignment.readAt
    if (filter === "offline") return Boolean(document.localUri)
    return true
  }), [data.documents, filter])

  const load = useCallback(async (showWarning = false) => {
    try {
      setData(cacheFieldDocuments(await fieldApi.documents("all")))
      setWarning(null)
    } catch {
      setData(readFieldDocuments())
      if (showWarning) setWarning({ message: copy.refreshError, retryable: true })
    }
  }, [copy.refreshError])

  useFocusEffect(useCallback(() => {
    setData(readFieldDocuments())
    void load(false)
  }, [load]))

  async function refresh() {
    setRefreshing(true)
    await load(true)
    setRefreshing(false)
  }

  async function pickAndQueue() {
    if (!data.capabilities.upload) {
      setWarning({ message: copy.uploadUnavailable })
      return
    }
    if (!selectedScope) {
      setWarning({ message: copy.noScope })
      return
    }
    setPicking(true)
    try {
      const draft = await pickFieldDocument({
        visitId: selectedScope.kind === "visit" ? selectedScope.id : null,
        taskId: selectedScope.kind === "task" ? selectedScope.id : null,
        maxBytes: data.capabilities.maxUploadBytes,
      })
      if (!draft) return
      enqueueFieldDocumentUpload(draft)
      setData(readFieldDocuments())
      setUploadOpen(false)
      setSelectedScope(null)
      setTaskPickerOpen(false)
      setTaskQuery("")
      Alert.alert(copy.saved, copy.savedHint)
      void sync().then(() => load(false)).catch(() => {})
    } catch (cause) {
      setWarning({ message: fieldErrorMessage(cause, "documentActionFailed") })
    } finally {
      setPicking(false)
    }
  }

  async function openDocument(document: FieldDocument) {
    if (!document.localUri && !data.capabilities.offlineDownload) {
      setWarning({ message: copy.downloadUnavailable })
      return
    }
    setBusyId(document.id)
    try {
      const localUri = document.localUri ?? await fieldApi.downloadDocument({
        documentId: document.id,
        fileName: document.fileName,
        downloadUrl: document.downloadUrl || undefined,
      })
      setData(setFieldDocumentLocalUri(document.id, localUri))
      if (!document.assignment.downloadedAt) enqueueFieldDocumentState(document.id, "DOWNLOADED")
      await openLocalDocument(localUri, document.mimeType)
      if (!document.assignment.readAt) {
        enqueueFieldDocumentState(document.id, "READ")
        setData(readFieldDocuments())
      }
      void sync().catch(() => {})
    } catch (cause) {
      Alert.alert(copy.title, fieldErrorMessage(cause, "documentOpenUnavailable"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <FieldScreenChrome />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <View style={[styles.content, layout.isTablet && styles.contentTablet]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("back")} accessibilityState={{ disabled: picking }} disabled={picking} onPress={() => safeFieldBack("/(app)/(tabs)/work")} style={[styles.back, picking && styles.disabled]}><TabIcon name="chevronLeft" color={colors.text} size={23} /></Pressable>
          <View style={styles.headerBody}><Text style={styles.eyebrow}>{copy.eyebrow}</Text><Text style={styles.title}>{copy.title}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={copy.add} accessibilityHint={canUpload ? copy.uploadTitle : copy.uploadUnavailable} accessibilityState={{ expanded: uploadOpen, disabled: !canUpload || picking }} disabled={!canUpload || picking} onPress={() => setUploadOpen((value) => !value)} style={[styles.add, (!canUpload || picking) && styles.disabled]}><TabIcon name="add" color={colors.headerText} size={17} /><Text style={styles.addText}>{copy.add}</Text></Pressable>
        </View>
        <Text style={styles.intro}>{copy.hint}</Text>

        <View style={styles.stats}>
          <Stat value={data.documents.length} label={copy.all} tone="info" />
          <Stat value={data.documents.filter((document) => document.assignment.required && !document.assignment.readAt).length} label={copy.required} tone="warning" />
          <Stat value={data.documents.filter((document) => document.localUri).length} label={copy.offline} tone="success" />
        </View>

        {uploadOpen && canUpload ? (
          <View style={styles.uploadCard}>
            <View style={styles.uploadTitleRow}><Text style={styles.uploadTitle}>{copy.uploadTitle}</Text><View style={styles.localPill}><Text style={styles.localPillText}>⌁ {copy.cloudOff}</Text></View></View>
            <Text style={styles.uploadLimit}>{uploadLimitText}</Text>
            <View style={styles.scopeList}>
              {scopes.map((scope) => {
                const selected = selectedScope?.kind === scope.kind && selectedScope?.id === scope.id
                const iconName = scope.kind === "general" ? "document" : scope.kind === "visit" ? "visit" : "tasks"
                return <Pressable key={`${scope.kind}-${scope.id}`} accessibilityRole="button" accessibilityLabel={scope.label} accessibilityState={{ selected }} onPress={() => setSelectedScope(scope)} style={[styles.scope, selected && styles.scopeSelected]}><TabIcon name={iconName} color={selected ? colors.headerText : colors.primary} size={17} /><Text style={[styles.scopeText, selected && styles.scopeTextSelected]} numberOfLines={2}>{scope.label}</Text>{selected ? <TabIcon name="check" color={colors.headerText} size={17} /> : null}</Pressable>
              })}
              {taskScopes.length > 0 ? <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={selectedScope?.kind === "task" ? selectedScope.label : copy.task}
                  accessibilityHint={copy.taskSearch}
                  accessibilityState={{ expanded: taskPickerOpen, selected: selectedScope?.kind === "task" }}
                  onPress={() => setTaskPickerOpen((value) => !value)}
                  style={[styles.scope, taskPickerOpen && styles.scopePickerOpen, selectedScope?.kind === "task" && styles.scopeSelected]}
                >
                  <TabIcon name="tasks" color={selectedScope?.kind === "task" ? colors.headerText : colors.primary} size={17} />
                  <Text style={[styles.scopeText, selectedScope?.kind === "task" && styles.scopeTextSelected]} numberOfLines={1}>{selectedScope?.kind === "task" ? selectedScope.label : copy.task}</Text>
                  <TabIcon name={taskPickerOpen ? "chevronUp" : "chevronDown"} color={selectedScope?.kind === "task" ? colors.headerText : colors.primary} size={18} />
                </Pressable>
                {taskPickerOpen ? <View style={styles.taskPicker}>
                  <View style={styles.taskSearch}><TabIcon name="search" color={colors.faint} size={18} /><TextInput accessibilityLabel={copy.taskSearch} value={taskQuery} onChangeText={setTaskQuery} placeholder={copy.taskSearch} placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} style={styles.taskSearchInput} /></View>
                  <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.taskResults} contentContainerStyle={styles.taskResultsContent}>
                    {visibleTaskScopes.length ? visibleTaskScopes.map((scope) => {
                      const selected = selectedScope?.kind === "task" && selectedScope.id === scope.id
                      return <Pressable key={`${scope.kind}-${scope.id}`} accessibilityRole="button" accessibilityLabel={scope.label} accessibilityState={{ selected }} onPress={() => { setSelectedScope(scope); setTaskPickerOpen(false); setTaskQuery("") }} style={[styles.taskResult, selected && styles.taskResultSelected]}><Text style={[styles.taskResultText, selected && styles.taskResultTextSelected]} numberOfLines={2}>{scope.label}</Text>{selected ? <TabIcon name="check" color={colors.primary} size={17} /> : null}</Pressable>
                    }) : <Text style={styles.taskEmpty}>{copy.taskSearchEmpty}</Text>}
                  </ScrollView>
                </View> : null}
              </> : null}
            </View>
            {!selectedScope ? <Text accessibilityRole="text" style={styles.scopeHint}>{copy.noScope}</Text> : null}
            <View style={styles.uploadActions}><Pressable accessibilityRole="button" accessibilityLabel={copy.cancel} accessibilityState={{ disabled: picking }} disabled={picking} onPress={() => { setUploadOpen(false); setSelectedScope(null); setTaskPickerOpen(false); setTaskQuery("") }} style={[styles.cancel, picking && styles.disabled]}><Text style={styles.cancelText}>{copy.cancel}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={copy.choose} accessibilityHint={selectedScope ? undefined : copy.noScope} accessibilityState={{ busy: picking, disabled: picking || !selectedScope }} disabled={picking || !selectedScope} onPress={() => void pickAndQueue()} style={[styles.choose, (picking || !selectedScope) && styles.disabled]}><Text style={styles.chooseText}>{picking ? "…" : copy.choose}</Text></Pressable></View>
          </View>
        ) : null}

        {warning ? <View accessibilityRole="alert" style={styles.warning}><View style={styles.warningBody}><Text style={styles.warningText}>{warning.message}</Text>{warning.retryable ? <Pressable accessibilityRole="button" accessibilityLabel={t("refresh")} accessibilityState={{ busy: refreshing, disabled: refreshing }} disabled={refreshing} onPress={() => void refresh()} style={[styles.warningRetry, refreshing && styles.disabled]}><TabIcon name="refresh" color={colors.warning} size={17} /><Text style={styles.warningRetryText}>{t("refresh")}</Text></Pressable> : null}</View></View> : null}

        <View style={styles.filters}>
          <Filter selected={filter === "all"} label={copy.all} onPress={() => setFilter("all")} />
          <Filter selected={filter === "required"} label={copy.required} onPress={() => setFilter("required")} />
          <Filter selected={filter === "offline"} label={copy.offline} onPress={() => setFilter("offline")} />
        </View>

        {visible.length === 0 ? (
          <View style={styles.empty}><View style={styles.emptyMark}><TabIcon name="document" color={colors.info} size={27} /></View><Text style={styles.emptyTitle}>{copy.empty}</Text><Text style={styles.emptyHint}>{canUpload ? copy.emptyHint : copy.uploadUnavailable}</Text><View style={styles.emptyActions}>{filter !== "all" ? <Pressable accessibilityRole="button" accessibilityLabel={copy.all} onPress={() => setFilter("all")} style={styles.emptySecondaryAction}><Text style={styles.emptySecondaryText}>{copy.all}</Text></Pressable> : null}{canUpload ? <Pressable accessibilityRole="button" accessibilityLabel={copy.add} accessibilityHint={copy.uploadTitle} accessibilityState={{ expanded: uploadOpen }} onPress={() => setUploadOpen(true)} style={styles.emptyPrimaryAction}><TabIcon name="add" color={colors.headerText} size={17} /><Text style={styles.emptyPrimaryText}>{copy.add}</Text></Pressable> : null}</View></View>
        ) : <View style={[styles.documentList, layout.isTablet && styles.documentListTablet]}>{visible.map((document) => {
          const actionLabel = document.localUri ? copy.open : copy.download
          const documentName = document.title || document.fileName
          const isBusy = busyId === document.id
          const canOpen = Boolean(document.localUri) || data.capabilities.offlineDownload
          return (
          <View key={document.id} style={[styles.card, layout.isTablet && styles.cardTablet, document.assignment.required && !document.assignment.readAt && styles.cardRequired]}>
            <View style={styles.fileTop}>
              <View style={[styles.fileIcon, document.assignment.required && !document.assignment.readAt && styles.fileIconRequired]}><Text style={[styles.fileIconText, document.assignment.required && !document.assignment.readAt && styles.fileIconTextRequired]}>{document.fileName.split(".").at(-1)?.toUpperCase().slice(0, 4) || "DOC"}</Text></View>
              <View style={styles.fileBody}><Text style={styles.fileName} numberOfLines={2}>{documentName}</Text><Text style={styles.fileMeta}>{document.fileName} · {formatFileSize(document.sizeBytes, locale)}</Text></View>
            </View>
            {document.visit ? <View style={styles.context}><TabIcon name="visit" color={colors.muted} size={13} /><Text style={styles.contextText}>{document.visit.customer.name}</Text></View> : null}
            {document.task ? <View style={styles.context}><TabIcon name="tasks" color={colors.muted} size={13} /><Text style={styles.contextText}>{document.task.title}</Text></View> : null}
            <View style={styles.badges}>
              {document.assignment.required ? <Badge label={copy.requiredBadge} tone="warning" /> : null}
              {!document.assignment.readAt ? <Badge label={copy.unread} tone="info" /> : null}
              {document.localUri ? <Badge label={copy.downloaded} tone="success" /> : null}
              {document.syncState === "PENDING" ? <Badge label={copy.queued} tone="info" /> : null}
              {document.syncState === "CONFLICT" || document.syncState === "REJECTED" ? <Badge label={copy.failed} tone="danger" /> : null}
            </View>
            {!canOpen ? <Text style={styles.restrictedHint}>{copy.downloadUnavailable}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={`${actionLabel}: ${documentName}`} accessibilityHint={canOpen ? undefined : copy.downloadUnavailable} accessibilityState={{ busy: isBusy, disabled: isBusy || !canOpen }} disabled={isBusy || !canOpen} onPress={() => void openDocument(document)} style={({ pressed }) => [styles.open, pressed && styles.pressed, (isBusy || !canOpen) && styles.disabled]}><Text style={styles.openText}>{isBusy ? "…" : actionLabel}</Text><Text style={styles.openArrow}>{document.localUri ? "↗" : "↓"}</Text></Pressable>
          </View>
          )
        })}</View>}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function Stat({ value, label, tone }: { value: number; label: string; tone: "info" | "warning" | "success" }) { const palette = tone === "warning" ? { bg: colors.warningBg, color: colors.warning } : tone === "success" ? { bg: colors.successBg, color: colors.successDark } : { bg: colors.infoBg, color: colors.info }; return <View style={[styles.stat, { backgroundColor: palette.bg }]}><Text style={[styles.statValue, { color: palette.color }]}>{value}</Text><Text style={[styles.statLabel, { color: palette.color }]} numberOfLines={1}>{label}</Text></View> }
function Filter({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.filter, selected && styles.filterSelected]}><Text style={[styles.filterText, selected && styles.filterTextSelected]}>{label}</Text></Pressable> }
function Badge({ label, tone }: { label: string; tone: "warning" | "info" | "success" | "danger" }) { const palette = tone === "warning" ? { bg: colors.warningBg, color: colors.warning } : tone === "success" ? { bg: colors.successBg, color: colors.successDark } : tone === "danger" ? { bg: colors.dangerBg, color: colors.missed } : { bg: colors.infoBg, color: colors.info }; return <View style={[styles.badge, { backgroundColor: palette.bg }]}><Text style={[styles.badgeText, { color: palette.color }]}>{label}</Text></View> }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, scroll: { paddingBottom: 36 }, content: { width: "100%" }, contentTablet: { maxWidth: 1_060, alignSelf: "center" },
  header: { paddingHorizontal: 14, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 10 }, back: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }, headerBody: { flex: 1 }, eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "900", letterSpacing: 0.9 }, title: { color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 2 }, add: { minHeight: 46, minWidth: 84, borderRadius: 15, paddingHorizontal: 10, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, addText: { color: colors.headerText, fontSize: 11, fontWeight: "900", marginTop: 2, textAlign: "center" }, intro: { color: colors.muted, fontSize: 12, lineHeight: 18, marginHorizontal: 16, marginTop: 12 },
  stats: { flexDirection: "row", gap: 8, paddingHorizontal: 14, marginTop: 17 }, stat: { flex: 1, minWidth: 0, height: 67, borderRadius: 17, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }, statValue: { fontSize: 20, fontWeight: "900" }, statLabel: { fontSize: 11, fontWeight: "900", marginTop: 3 },
  uploadCard: { marginHorizontal: 14, marginTop: 14, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.infoBorder, ...cardShadow }, uploadTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 }, uploadTitle: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "900" }, localPill: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: colors.successBg }, localPillText: { color: colors.successDark, fontSize: 11, fontWeight: "900" }, uploadLimit: { color: colors.muted, fontSize: 11, lineHeight: 16, fontWeight: "700", marginTop: 6 }, scopeList: { gap: 7, marginTop: 12 }, scope: { minHeight: 49, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: colors.bg, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: colors.border }, scopePickerOpen: { borderColor: colors.primary }, scopeSelected: { backgroundColor: colors.primary, borderColor: colors.primary }, scopeText: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: "800" }, scopeTextSelected: { color: colors.headerText }, taskPicker: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, overflow: "hidden" }, taskSearch: { minHeight: 46, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 7, borderBottomWidth: 1, borderBottomColor: colors.border }, taskSearchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 12, fontWeight: "700" }, taskResults: { maxHeight: 250 }, taskResultsContent: { paddingVertical: 4 }, taskResult: { minHeight: 48, paddingHorizontal: 11, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 }, taskResultSelected: { backgroundColor: colors.primarySoft }, taskResultText: { flex: 1, color: colors.text, fontSize: 11, lineHeight: 15, fontWeight: "800" }, taskResultTextSelected: { color: colors.primary }, taskEmpty: { color: colors.muted, fontSize: 11, lineHeight: 15, paddingHorizontal: 11, paddingVertical: 14, textAlign: "center" }, scopeHint: { color: colors.warning, fontSize: 11, lineHeight: 15, fontWeight: "800", marginTop: 10 }, uploadActions: { flexDirection: "row", gap: 8, marginTop: 12 }, cancel: { flex: 1, minHeight: 45, borderRadius: 14, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }, cancelText: { color: colors.muted, fontSize: 11, fontWeight: "900" }, choose: { flex: 2, minHeight: 45, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }, chooseText: { color: colors.headerText, fontSize: 11, fontWeight: "900" },
  warning: { marginHorizontal: 14, marginTop: 11, borderRadius: radii.inner, padding: 10, backgroundColor: colors.warningBg }, warningBody: { flexDirection: "row", alignItems: "center", gap: 10 }, warningText: { flex: 1, color: colors.warning, fontSize: 11, lineHeight: 16, fontWeight: "800" }, warningRetry: { minHeight: 44, paddingHorizontal: 8, borderRadius: 12, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", gap: 2 }, warningRetryText: { color: colors.warning, fontSize: 11, fontWeight: "900" },
  filters: { flexDirection: "row", gap: 7, paddingHorizontal: 14, marginTop: 16, marginBottom: 2 }, filter: { flex: 1, minHeight: 44, borderRadius: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }, filterSelected: { backgroundColor: colors.text, borderColor: colors.text }, filterText: { color: colors.muted, fontSize: 11, fontWeight: "900" }, filterTextSelected: { color: colors.headerText },
  documentList: {}, documentListTablet: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 14, marginTop: 10 }, card: { marginHorizontal: 14, marginTop: 10, borderRadius: radii.card, padding: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, ...cardShadow }, cardTablet: { flexBasis: "48%", flexGrow: 1, marginHorizontal: 0, marginTop: 0 }, cardRequired: { borderColor: colors.warningBorder }, fileTop: { flexDirection: "row", alignItems: "center", gap: 11 }, fileIcon: { width: 50, height: 50, borderRadius: 16, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" }, fileIconRequired: { backgroundColor: colors.warningBg }, fileIconText: { color: colors.info, fontSize: 11, fontWeight: "900" }, fileIconTextRequired: { color: colors.warning }, fileBody: { flex: 1, minWidth: 0 }, fileName: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "900" }, fileMeta: { color: colors.muted, fontSize: 11, marginTop: 4 }, context: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 9 }, contextText: { flex: 1, color: colors.muted, fontSize: 11, fontWeight: "700" }, badges: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 10 }, badge: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 5 }, badgeText: { fontSize: 11, fontWeight: "900" }, restrictedHint: { color: colors.warning, fontSize: 11, lineHeight: 16, fontWeight: "700", marginTop: 10 }, open: { minHeight: 44, borderRadius: 14, marginTop: 12, paddingHorizontal: 14, backgroundColor: colors.primarySoft, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, openText: { color: colors.primary, fontSize: 12, fontWeight: "900" }, openArrow: { color: colors.primary, fontSize: 17, fontWeight: "900" },
  empty: { margin: 14, minHeight: 260, borderRadius: radii.card, backgroundColor: colors.card, alignItems: "center", justifyContent: "center", padding: 24, ...cardShadow }, emptyMark: { width: 66, height: 66, borderRadius: 22, backgroundColor: colors.infoBg, alignItems: "center", justifyContent: "center" }, emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "900", textAlign: "center", marginTop: 15 }, emptyHint: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 6 }, emptyActions: { alignSelf: "stretch", flexDirection: "row", gap: 8, marginTop: 16 }, emptySecondaryAction: { flex: 1, minHeight: 44, borderRadius: 14, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }, emptySecondaryText: { color: colors.muted, fontSize: 11, fontWeight: "900" }, emptyPrimaryAction: { flex: 1, minHeight: 44, borderRadius: 14, backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 10 }, emptyPrimaryText: { color: colors.headerText, fontSize: 11, fontWeight: "900" }, disabled: { opacity: 0.58 }, pressed: { opacity: 0.7 },
})
