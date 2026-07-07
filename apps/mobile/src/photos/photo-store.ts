// Фото живет в documentDirectory до успешного upload+submit (docs/05 риск 3):
// переживает kill приложения и офлайн любой длины.

import * as FileSystem from "expo-file-system/legacy"
import * as Crypto from "expo-crypto"
import type { MobileTaskStatus } from "@leadshelf/api-contracts/mobile/v1"
import { enqueuePhoto } from "../db/local-store"

const DIR = `${FileSystem.documentDirectory}photo-outbox/`

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
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
  const clientPhotoId = `photo-${Crypto.randomUUID()}`
  const mediaType = input.mediaType ?? "photo"
  const extension = mediaType === "video" ? "mp4" : "jpg"
  const fileUri = `${DIR}${clientPhotoId}.${extension}`
  await FileSystem.copyAsync({ from: input.sourceUri, to: fileUri })
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
