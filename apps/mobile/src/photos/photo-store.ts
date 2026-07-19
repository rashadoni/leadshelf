// Фото живет в documentDirectory до успешного upload+submit (docs/05 риск 3):
// переживает kill приложения и офлайн любой длины.

import * as FileSystem from "expo-file-system/legacy"
import * as Crypto from "expo-crypto"
import type { MobileTaskStatus } from "@leadshelf/api-contracts/mobile/v1"
import { enqueuePhoto } from "../db/local-store"
import { canStorePhoto, PhotoStorageLimitError } from "./photo-storage-policy"
import {
  PHOTO_MEDIA_DIR,
  persistEncryptedMedia,
} from "../media/encrypted-media-store"

export const PHOTO_OUTBOX_DIR = PHOTO_MEDIA_DIR

export async function readPhotoOutboxUsage(): Promise<{ files: number; bytes: number }> {
  const names = await FileSystem.readDirectoryAsync(PHOTO_OUTBOX_DIR).catch(() => [])
  const infos = await Promise.all(
    names.map((name) => FileSystem.getInfoAsync(`${PHOTO_OUTBOX_DIR}${name}`).catch(() => null)),
  )
  return infos.reduce(
    (usage, info) => {
      if (info?.exists && !info.isDirectory) {
        usage.files++
        usage.bytes += typeof info.size === "number" ? info.size : 0
      }
      return usage
    },
    { files: 0, bytes: 0 },
  )
}

async function assertStorageCapacity(sourceUri: string): Promise<void> {
  const source = await FileSystem.getInfoAsync(sourceUri)
  const incomingBytes = source.exists && !source.isDirectory ? source.size : Number.NaN
  const decision = canStorePhoto(await readPhotoOutboxUsage(), incomingBytes)
  if (!decision.allowed) throw new PhotoStorageLimitError(decision.reason)
}

export async function persistAndQueuePhoto(input: {
  taskId: string
  sourceUri: string
  expectedTaskStatus: MobileTaskStatus
  takenAt: string
  mediaType?: "photo" | "video"
  durationMs?: number | null
  captureStepJson?: string | null
  exifJson?: string | null
  captureFlagsJson?: string | null
  captureTelemetryJson?: string | null
}): Promise<string> {
  await FileSystem.makeDirectoryAsync(PHOTO_OUTBOX_DIR, { intermediates: true }).catch(() => {})
  await assertStorageCapacity(input.sourceUri)
  const clientPhotoId = `photo-${Crypto.randomUUID()}`
  const mediaType = input.mediaType ?? "photo"
  const extension = mediaType === "video" ? "mp4" : "jpg"
  const fileUri = `${PHOTO_OUTBOX_DIR}${clientPhotoId}.${extension}`
  await persistEncryptedMedia(input.sourceUri, fileUri, { deletePlaintextSource: true })
  enqueuePhoto({
    clientPhotoId,
    clientOpId: `op-${Crypto.randomUUID()}`,
    taskId: input.taskId,
    fileUri,
    expectedTaskStatus: input.expectedTaskStatus,
    takenAt: input.takenAt,
    mediaType,
    durationMs: input.durationMs ?? null,
    captureStepJson: input.captureStepJson ?? null,
    exifJson: input.exifJson ?? null,
    captureFlagsJson: input.captureFlagsJson ?? null,
    captureTelemetryJson: input.captureTelemetryJson ?? null,
  })
  return clientPhotoId
}
