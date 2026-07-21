import * as Crypto from "expo-crypto"
import * as FileSystem from "expo-file-system/legacy"
import type { MobileCommercialMediaPurpose } from "@leadshelf/api-contracts/mobile/v1"
import type { CommercialMediaAttachment } from "../db/local-store"
import { COMMERCIAL_MEDIA_DIR, persistEncryptedMedia } from "../media/encrypted-media-store"

const DIR = COMMERCIAL_MEDIA_DIR

export async function persistCommercialMedia(input: {
  sourceUri: string
  purpose: MobileCommercialMediaPurpose
  takenAt?: string
}): Promise<CommercialMediaAttachment> {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {})
  const clientMediaId = `commercial-${Crypto.randomUUID()}`
  const fileUri = `${DIR}${clientMediaId}.jpg`
  await persistEncryptedMedia(input.sourceUri, fileUri, { deletePlaintextSource: true })
  return {
    clientMediaId,
    purpose: input.purpose,
    fileUri,
    takenAt: input.takenAt ?? new Date().toISOString(),
  }
}

export async function discardCommercialMedia(media: CommercialMediaAttachment): Promise<void> {
  await discardCommercialMediaFile(media.fileUri)
}

export async function discardCommercialMediaFile(fileUri: string): Promise<void> {
  await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {})
}
