import * as Crypto from "expo-crypto"
import * as DocumentPicker from "expo-document-picker"
import * as FileSystem from "expo-file-system/legacy"
import * as Sharing from "expo-sharing"
import type { FieldDocumentDraft } from "../db/local-store"
import { tokenStore } from "../auth/token-store"
import {
  FIELD_DOCUMENT_MEDIA_DIR,
  persistEncryptedMedia,
  withDecryptedMedia,
} from "../media/encrypted-media-store"

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  zip: "application/zip",
}

const ALLOWED_TYPES = [...new Set(Object.values(MIME_BY_EXTENSION))]

function safeFileName(name: string): string {
  const withoutPath = name.split(/[\\/]/).at(-1) ?? "document"
  return withoutPath.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180) || "document"
}

export async function pickFieldDocument(input?: {
  title?: string | null
  visitId?: string | null
  taskId?: string | null
}): Promise<FieldDocumentDraft | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ALLOWED_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  })
  if (result.canceled) return null
  const asset = result.assets[0]
  if (!asset) return null
  const fileName = safeFileName(asset.name)
  const extension = fileName.split(".").at(-1)?.toLowerCase() ?? ""
  const mimeType = MIME_BY_EXTENSION[extension]
  if (!mimeType) throw new Error("Этот тип файла не поддерживается")
  const fileInfo = asset.size == null ? await FileSystem.getInfoAsync(asset.uri) : null
  const size = asset.size ?? (fileInfo?.exists ? fileInfo.size : null)
  if (!Number.isInteger(size) || !size || size > 25 * 1024 * 1024) {
    throw new Error("Файл должен быть не больше 25 МБ")
  }
  if (!FileSystem.documentDirectory) throw new Error("Хранилище устройства недоступно")
  const [organizationSlug, agentId] = await Promise.all([tokenStore.getOrgSlug(), tokenStore.getUserId()])
  const scope = `${organizationSlug ?? "unknown"}-${agentId ?? "unknown"}`.replace(/[^A-Za-z0-9._-]+/g, "_")
  const directory = `${FIELD_DOCUMENT_MEDIA_DIR}${scope}/`
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
  const target = `${directory}${Crypto.randomUUID()}-${fileName}`
  await persistEncryptedMedia(asset.uri, target, { deletePlaintextSource: true })
  return {
    title: input?.title?.trim() || fileName,
    fileName,
    mimeType,
    sizeBytes: size,
    fileUri: target,
    visitId: input?.visitId ?? null,
    taskId: input?.taskId ?? null,
  }
}

export async function openLocalDocument(uri: string, mimeType: string): Promise<void> {
  if (!await Sharing.isAvailableAsync()) {
    throw new Error("На этом устройстве просмотр файла недоступен")
  }
  await withDecryptedMedia(uri, (temporaryUri) => Sharing.shareAsync(temporaryUri, {
    mimeType,
    dialogTitle: "Открыть локальный файл",
  }))
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} МБ`
}
