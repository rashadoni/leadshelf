// Visit evidence must survive an app kill while offline. Camera files live in
// cache by default, so copy them into documentDirectory before enqueuing the
// durable multipart upload operation.

import * as Crypto from "expo-crypto"
import * as FileSystem from "expo-file-system/legacy"
import { enqueueFieldVisitPhoto } from "../db/local-store"
import type { FieldVisitPhotoPayload } from "./execution-outbox"

const DIR = `${FileSystem.documentDirectory}field-visit-photo-outbox/`

export async function persistAndQueueFieldVisitPhoto(input: {
  visitId: string
  agentId: string
  sourceUri: string
  category?: string | null
  latitude: number | null
  longitude: number | null
  takenAt: string
}): Promise<{ clientOpId: string; payload: FieldVisitPhotoPayload }> {
  const payload = await persistFieldVisitPhoto(input)
  return { ...enqueueFieldVisitPhoto(payload), payload }
}

export async function persistFieldVisitPhoto(input: {
  visitId: string
  agentId: string
  sourceUri: string
  category?: string | null
  latitude: number | null
  longitude: number | null
  takenAt: string
}): Promise<FieldVisitPhotoPayload> {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
  const clientPhotoId = `mobile-photo-${Crypto.randomUUID()}`
  const fileUri = `${DIR}${clientPhotoId}.jpg`
  await FileSystem.copyAsync({ from: input.sourceUri, to: fileUri })
  const payload: FieldVisitPhotoPayload = {
    clientPhotoId,
    visitId: input.visitId,
    agentId: input.agentId,
    fileUri,
    category: input.category ?? "visit",
    latitude: input.latitude,
    longitude: input.longitude,
    takenAt: input.takenAt,
  }
  return payload
}

export async function discardFieldVisitPhotoFile(fileUri: string): Promise<void> {
  await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {})
}
