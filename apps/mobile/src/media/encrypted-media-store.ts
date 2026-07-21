import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from "expo-crypto"
import * as Crypto from "expo-crypto"
import { File } from "expo-file-system"
import * as FileSystem from "expo-file-system/legacy"
import * as SecureStore from "expo-secure-store"
import {
  MEDIA_ENCRYPTION_KEY_NAME,
  MEDIA_ENCRYPTION_MARKER_NAME,
  MEDIA_TEMP_SUFFIX,
  hasEncryptedMediaHeader,
  mediaEncryptionBootstrapPlan,
  normalizeMediaKey,
  openEncryptedMediaPayload,
  safeTemporaryExtension,
  sealEncryptedMediaPayload,
} from "./media-encryption"

export const PHOTO_MEDIA_DIR = `${FileSystem.documentDirectory}photo-outbox/`
export const COMMERCIAL_MEDIA_DIR = `${FileSystem.documentDirectory}commercial-media-outbox/`
export const FIELD_VISIT_MEDIA_DIR = `${FileSystem.documentDirectory}field-visit-photo-outbox/`
export const FIELD_DOCUMENT_MEDIA_DIR = `${FileSystem.documentDirectory}mtm-documents/`

const ENCRYPTED_DIRECTORIES = [
  PHOTO_MEDIA_DIR,
  COMMERCIAL_MEDIA_DIR,
  FIELD_VISIT_MEDIA_DIR,
  FIELD_DOCUMENT_MEDIA_DIR,
]
const DECRYPTED_TEMP_DIR = `${FileSystem.cacheDirectory}leadshelf-media-decrypted/`
const MARKER_URI = `${FileSystem.documentDirectory}${MEDIA_ENCRYPTION_MARKER_NAME}`
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}
const AAD = new Uint8Array([0x4c, 0x65, 0x61, 0x64, 0x53, 0x68, 0x65, 0x6c, 0x66, 0x2d, 0x6d, 0x65, 0x64, 0x69, 0x61, 0x2d, 0x76, 0x31])

let bootstrapPromise: Promise<void> | null = null

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => right[index] === value)
}

async function readMarker(): Promise<string | null> {
  const info = await FileSystem.getInfoAsync(MARKER_URI)
  if (!info.exists) return null
  const marker = await FileSystem.readAsStringAsync(MARKER_URI)
  return marker?.trim() || null
}

async function writeMarker(value: "migrating:v1" | "ready:v1"): Promise<void> {
  await FileSystem.writeAsStringAsync(MARKER_URI, value)
}

async function readKey(): Promise<AESEncryptionKey | null> {
  const value = await SecureStore.getItemAsync(MEDIA_ENCRYPTION_KEY_NAME, KEY_OPTIONS)
  if (!value) return null
  return AESEncryptionKey.import(normalizeMediaKey(value), "hex") as Promise<AESEncryptionKey>
}

async function createKey(): Promise<AESEncryptionKey> {
  const encoded = bytesToHex(await Crypto.getRandomBytesAsync(32))
  await SecureStore.setItemAsync(MEDIA_ENCRYPTION_KEY_NAME, encoded, KEY_OPTIONS)
  const persisted = await SecureStore.getItemAsync(MEDIA_ENCRYPTION_KEY_NAME, KEY_OPTIONS)
  if (persisted !== encoded) throw new Error("[mobile-media] device-only key persistence failed")
  return AESEncryptionKey.import(encoded, "hex") as Promise<AESEncryptionKey>
}

async function listFilesRecursively(directory: string): Promise<string[]> {
  const root = await FileSystem.getInfoAsync(directory)
  if (!root.exists) return []
  if (!root.isDirectory) throw new Error("[mobile-media] encrypted storage path is not a directory")
  const names = await FileSystem.readDirectoryAsync(directory)
  const nested = await Promise.all(names.map(async (name) => {
    const uri = `${directory.replace(/\/$/, "")}/${name}`
    const info = await FileSystem.getInfoAsync(uri).catch(() => null)
    if (!info?.exists) return []
    return info.isDirectory ? listFilesRecursively(`${uri}/`) : [uri]
  }))
  return nested.flat()
}

async function encryptBytes(plaintext: Uint8Array, key: AESEncryptionKey): Promise<Uint8Array> {
  const sealed = await aesEncryptAsync(plaintext, key, { additionalData: AAD })
  const combined = await sealed.combined()
  const reopened = AESSealedData.fromCombined(combined)
  const verified = await aesDecryptAsync(reopened, key, { additionalData: AAD })
  if (!equalBytes(plaintext, verified)) throw new Error("[mobile-media] encryption verification failed")
  return sealEncryptedMediaPayload(combined)
}

async function decryptBytes(encrypted: Uint8Array, key: AESEncryptionKey): Promise<Uint8Array> {
  const sealed = AESSealedData.fromCombined(openEncryptedMediaPayload(encrypted))
  return aesDecryptAsync(sealed, key, { additionalData: AAD })
}

async function writeAtomically(uri: string, bytes: Uint8Array): Promise<void> {
  const temporary = new File(`${uri}${MEDIA_TEMP_SUFFIX}`)
  const destination = new File(uri)
  try {
    temporary.create({ intermediates: true, overwrite: true })
    temporary.write(bytes)
    await temporary.move(destination, { overwrite: true })
  } catch (error) {
    if (temporary.exists) temporary.delete()
    throw error
  }
}

async function encryptFileInPlace(uri: string, key: AESEncryptionKey): Promise<void> {
  if (uri.endsWith(MEDIA_TEMP_SUFFIX)) {
    await FileSystem.deleteAsync(uri, { idempotent: true })
    return
  }
  const source = new File(uri)
  if (!source.exists) return
  const bytes = await source.bytes()
  if (hasEncryptedMediaHeader(bytes)) {
    await decryptBytes(bytes, key)
    return
  }
  await writeAtomically(uri, await encryptBytes(bytes, key))
}

export async function bootstrapEncryptedMediaStorage(): Promise<void> {
  bootstrapPromise ??= (async () => {
    if (!FileSystem.documentDirectory || !FileSystem.cacheDirectory) {
      throw new Error("[mobile-media] native file storage is unavailable")
    }
    await FileSystem.deleteAsync(DECRYPTED_TEMP_DIR, { idempotent: true })
    const [key, marker] = await Promise.all([readKey(), readMarker()])
    const plan = mediaEncryptionBootstrapPlan({ keyExists: Boolean(key), marker })
    if (plan === "missing-key") {
      throw new Error("[mobile-media] encrypted media key is unavailable; approved local wipe is required")
    }
    const activeKey = key ?? await createKey()
    if (plan !== "open") await writeMarker("migrating:v1")
    // Scan on every startup: after a rollback an older app can create a new
    // plaintext outbox file even though the v1 marker already exists.
    for (const directory of ENCRYPTED_DIRECTORIES) {
      for (const uri of await listFilesRecursively(directory)) {
        await encryptFileInPlace(uri, activeKey)
      }
    }
    await writeMarker("ready:v1")
  })()
  return bootstrapPromise
}

async function activeKey(): Promise<AESEncryptionKey> {
  await bootstrapEncryptedMediaStorage()
  const key = await readKey()
  if (!key) throw new Error("[mobile-media] encrypted media key became unavailable")
  return key
}

export async function persistEncryptedMedia(
  sourceUri: string,
  destinationUri: string,
  options: { deletePlaintextSource?: boolean } = {},
): Promise<void> {
  const source = new File(sourceUri)
  if (!source.exists) throw new Error("[mobile-media] source file is unavailable")
  const plaintext = await source.bytes()
  if (hasEncryptedMediaHeader(plaintext)) throw new Error("[mobile-media] source is already encrypted")
  await writeAtomically(destinationUri, await encryptBytes(plaintext, await activeKey()))
  if (options.deletePlaintextSource) {
    try {
      await FileSystem.deleteAsync(sourceUri, { idempotent: true })
    } catch (error) {
      await FileSystem.deleteAsync(destinationUri, { idempotent: true }).catch(() => undefined)
      throw error
    }
  }
}

export async function materializeEncryptedMedia(uri: string): Promise<{
  uri: string
  cleanup: () => Promise<void>
}> {
  const source = new File(uri)
  if (!source.exists) throw new Error("[mobile-media] encrypted file is unavailable")
  const plaintext = await decryptBytes(await source.bytes(), await activeKey())
  await FileSystem.makeDirectoryAsync(DECRYPTED_TEMP_DIR, { intermediates: true })
  const temporaryUri = `${DECRYPTED_TEMP_DIR}${Crypto.randomUUID()}.${safeTemporaryExtension(uri)}`
  const temporary = new File(temporaryUri)
  try {
    temporary.create({ overwrite: false })
    temporary.write(plaintext)
  } catch (error) {
    await FileSystem.deleteAsync(temporaryUri, { idempotent: true })
    throw error
  }
  return {
    uri: temporaryUri,
    cleanup: () => FileSystem.deleteAsync(temporaryUri, { idempotent: true }),
  }
}

export async function withDecryptedMedia<T>(
  uri: string,
  operation: (temporaryUri: string) => Promise<T>,
): Promise<T> {
  const materialized = await materializeEncryptedMedia(uri)
  try {
    return await operation(materialized.uri)
  } finally {
    await materialized.cleanup()
  }
}

export async function withTemporaryPlaintextMedia<T>(
  extension: string,
  operation: (temporaryUri: string) => Promise<T>,
): Promise<T> {
  await bootstrapEncryptedMediaStorage()
  await FileSystem.makeDirectoryAsync(DECRYPTED_TEMP_DIR, { intermediates: true })
  const safeExtension = safeTemporaryExtension(`temporary.${extension}`)
  const temporaryUri = `${DECRYPTED_TEMP_DIR}${Crypto.randomUUID()}.${safeExtension}`
  try {
    return await operation(temporaryUri)
  } finally {
    await FileSystem.deleteAsync(temporaryUri, { idempotent: true })
  }
}

export async function readEncryptedMediaUsage(): Promise<{ files: number; bytes: number }> {
  const uris = (await Promise.all(ENCRYPTED_DIRECTORIES.map(listFilesRecursively))).flat()
  const infos = await Promise.all(uris.map((uri) => FileSystem.getInfoAsync(uri)))
  return infos.reduce(
    (usage, info) => {
      if (info.exists && !info.isDirectory) {
        usage.files += 1
        usage.bytes += typeof info.size === "number" ? info.size : 0
      }
      return usage
    },
    { files: 0, bytes: 0 },
  )
}

export async function deleteAllEncryptedMedia(): Promise<void> {
  const failures: unknown[] = []
  for (const directory of [...ENCRYPTED_DIRECTORIES, DECRYPTED_TEMP_DIR]) {
    await FileSystem.deleteAsync(directory, { idempotent: true }).catch((error) => failures.push(error))
  }
  if (failures.length > 0) throw new Error("[mobile-media] one or more media directories could not be deleted")
  await FileSystem.deleteAsync(MARKER_URI, { idempotent: true })
  await SecureStore.deleteItemAsync(MEDIA_ENCRYPTION_KEY_NAME, KEY_OPTIONS)
  bootstrapPromise = null
}
