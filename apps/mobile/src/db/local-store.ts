// LocalStore на expo-sqlite (решение docs/19: Expo Go сегодня; миграция на
// WatermelonDB позже за этим же интерфейсом). Ack-курсоры пишутся только
// после commit-а applyPull — гарантия sync-протокола.

import * as SQLite from "expo-sqlite"
import * as Crypto from "expo-crypto"
import * as FileSystem from "expo-file-system/legacy"
import * as SecureStore from "expo-secure-store"
import {
  mobilePhotoSubmitPayloadSchema,
  mobileLocationUpdatePayloadSchema,
  mobileCommercialSnapshotSchema,
  mobilePromoInventoryRecordPayloadSchema,
  mobilePromotionEnrollPayloadSchema,
  mobilePromotionSubmitPayloadSchema,
  mobileProofExceptionPayloadSchema,
  mobileRewardClaimPayloadSchema,
  mobileSalesReturnCreatePayloadSchema,
  mobileTaskCommentPayloadSchema,
  mobileTaskStatusPayloadSchema,
  mobileVisitCheckInPayloadSchema,
  mobileVisitCheckOutPayloadSchema,
  type MobileProofExceptionPayload,
  type MobileCommercialSnapshot,
  type MobileCommercialMediaPurpose,
  type MobilePromoInventoryRecordPayload,
  type MobilePromotionEnrollPayload,
  type MobilePromotionSubmitPayload,
  type MobilePushOperation,
  type MobileRewardClaimPayload,
  type MobileSalesReturnCreatePayload,
  type MobileTaskStatus,
} from "@leadshelf/api-contracts/mobile/v1"
import { orderCreateRequestSchema, type OrderCreateRequest } from "@leadshelf/api-contracts/orders/v1"
import type {
  LocalStore,
  OutboxRow,
  PhotoQueueRow,
  PullResponse,
  RouteRow,
  RouteStopRow,
  StoreRow,
  TaskRow,
  VisitRow,
} from "../sync/ports"
import type { MobilePhotoUploadResponse, MobileShelfComparisonResult } from "@leadshelf/api-contracts/mobile/v1"
import { OPEN_TASK_STATUSES } from "../tasks/status"
import {
  attachCommercialMediaToOperation,
  detachCommercialMediaFromOperation,
  type CommercialMediaOperationKind,
} from "../commercial/media-outbox"
import {
  parseQueuedOrderDetailCode,
  parseQueuedOrderPayload,
  parseQueuedOrderServerId,
  type QueuedOrderLine,
} from "../orders/queued-order"
import {
  parseLocalPlanogramLibrary,
  type LocalPlanogramBundleRow,
  type LocalPlanogramLibrary,
} from "../planogram/local-library"
import { calculateLocalDatabaseCapacity, type LocalDatabaseCapacity } from "./capacity"
import {
  assertSqlCipherIntegrity,
  buildEncryptedAttachSql,
  bytesToHex,
  DATABASE_KEY_NAME,
  ENCRYPTED_DATABASE_NAME,
  ENCRYPTION_MARKER_TABLE,
  encryptedDatabaseBootstrapPlan,
  LEGACY_DATABASE_NAME,
  normalizeSqlCipherKey,
  quoteSqliteIdentifier,
  sqliteFileUri,
  sqlCipherKeyLiteral,
} from "./sqlite-encryption"
import {
  parseFieldRouteCreatePayload,
  parseFieldRouteChangeRequestPayload,
  parseFieldRoutePublishPayload,
  parseFieldRouteUpdatePayload,
  type FieldRouteCreatePayload,
  type FieldRouteChangeRequestPayload,
  type FieldRouteUpdatePayload,
} from "../field/route-outbox"
import {
  parseFieldVisitActionPayload,
  parseFieldVisitCheckInPayload,
  parseFieldLocationPayload,
  parseFieldVisitPhotoPayload,
  parseFieldVisitUpdatePayload,
  parseFieldWorkdayEventPayload,
  parseFieldTaskCreatePayload,
  parseFieldTaskEventPayload,
  parseFieldTaskUpdatePayload,
  parseFieldCommitmentCreatePayload,
  parseFieldCommitmentFulfillPayload,
  parseFieldMessageCreatePayload,
  parseFieldMessageReceiptPayload,
  parseFieldDocumentStatePayload,
  parseFieldDocumentUploadPayload,
  parseFieldHrmRequestCreatePayload,
  parseFieldHrmRequestCancelPayload,
  type FieldCommitmentCreatePayload,
  type FieldCommitmentFulfillPayload,
  type FieldMessageCreatePayload,
  type FieldMessageReceiptPayload,
  type FieldDocumentStatePayload,
  type FieldDocumentUploadPayload,
  type FieldHrmRequestCreatePayload,
  type FieldHrmRequestCancelPayload,
  type FieldLocationPayload,
  type FieldTaskCreatePayload,
  type FieldTaskEventPayload,
  type FieldTaskUpdatePayload,
  type FieldVisitActionPayload,
  type FieldVisitCheckInPayload,
  type FieldVisitPhotoPayload,
  type FieldVisitUpdatePayload,
  type FieldWorkdayEventPayload,
} from "../field/execution-outbox"
import type {
  FieldAgentTasksData,
  FieldCommitmentsData,
  FieldDocument,
  FieldDocumentsData,
  FieldHrmData,
  FieldHrmRequest,
  FieldMessage,
  FieldMessagesData,
  FieldMessageThreadData,
  FieldWorkdayData,
} from "../field/contracts"
import {
  FIELD_COMMITMENTS_CACHE_KEY,
  projectFieldCommitments,
  type FieldCommitmentProjectionOperation,
} from "../field/commitment-cache"
import {
  FIELD_AGENT_TASKS_CACHE_KEY,
  addOptimisticAgentTask,
  appendOptimisticAgentTaskEvent,
  reconcileAgentTaskOperation,
  updateOptimisticAgentTask,
  type FieldTaskCustomerPreview,
} from "../field/task-cache"
import { bootstrapEncryptedMediaStorage } from "../media/encrypted-media-store"

let db!: SQLite.SQLiteDatabase
let initPromise: Promise<void> | null = null
export const COMMERCIAL_CACHE_KEY = "shelf.commercial.snapshot.v1"

const DATABASE_KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}

function databasePath(name: string): string {
  const directory = SQLite.defaultDatabaseDirectory
  if (!directory) throw new Error("[mobile-db] native database directory is unavailable")
  return `${directory.replace(/\/$/, "")}/${name}`
}

async function databaseExists(name: string): Promise<boolean> {
  return (await FileSystem.getInfoAsync(sqliteFileUri(databasePath(name)))).exists
}

function readOrCreateDatabaseKey(allowCreate: boolean): string {
  const existing = SecureStore.getItem(DATABASE_KEY_NAME, DATABASE_KEY_OPTIONS)
  if (existing) return normalizeSqlCipherKey(existing)
  if (!allowCreate) throw new Error("[mobile-db] encrypted database key is unavailable; approved local wipe is required")
  const created = bytesToHex(Crypto.getRandomBytes(32))
  SecureStore.setItem(DATABASE_KEY_NAME, created, DATABASE_KEY_OPTIONS)
  return created
}

function openEncryptedDatabase(key: string): SQLite.SQLiteDatabase {
  const opened = SQLite.openDatabaseSync(ENCRYPTED_DATABASE_NAME, { useNewConnection: true })
  try {
    opened.execSync(`PRAGMA key = ${sqlCipherKeyLiteral(key)}; PRAGMA cipher_memory_security = ON;`)
    const version = opened.getFirstSync<{ cipher_version: string }>("PRAGMA cipher_version")?.cipher_version
    if (!version) throw new Error("[mobile-db] SQLCipher is not present in this native build")
    return opened
  } catch (error) {
    opened.closeSync()
    throw error
  }
}

type DatabaseInventory = {
  rows: Record<string, number>
  schema: string[]
}

function databaseInventory(database: SQLite.SQLiteDatabase): DatabaseInventory {
  const tables = database.getAllSync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  const rows = Object.fromEntries(tables
    .filter(({ name }) => name !== ENCRYPTION_MARKER_TABLE)
    .map(({ name }) => {
      const row = database.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${quoteSqliteIdentifier(name)}`,
      )
      return [name, row?.count ?? 0]
    }))
  const schema = database.getAllSync<{ type: string; name: string; tableName: string; sql: string }>(
    `SELECT type, name, tbl_name AS tableName, sql
     FROM sqlite_master
     WHERE sql IS NOT NULL AND name <> ?
     ORDER BY type, name`,
    [ENCRYPTION_MARKER_TABLE],
  ).map((row) => JSON.stringify(row))
  return { rows, schema }
}

function legacyDatabaseInventory(): DatabaseInventory {
  const legacy = SQLite.openDatabaseSync(LEGACY_DATABASE_NAME, { useNewConnection: true })
  try {
    return databaseInventory(legacy)
  } finally {
    legacy.closeSync()
  }
}

function assertEncryptedDatabase(
  database: SQLite.SQLiteDatabase,
  expected?: DatabaseInventory,
  fullIntegrityCheck = false,
): void {
  const marker = database.getFirstSync<{ version: number }>(
    `SELECT version FROM ${quoteSqliteIdentifier(ENCRYPTION_MARKER_TABLE)} WHERE id=1`,
  )
  if (marker?.version !== 1) throw new Error("[mobile-db] encryption migration marker is missing")
  if (fullIntegrityCheck) {
    const integrity = database.getAllSync<Record<string, string>>("PRAGMA cipher_integrity_check")
    const values = integrity.flatMap((row) => Object.values(row))
    assertSqlCipherIntegrity(values)
  }
  if (expected && JSON.stringify(databaseInventory(database)) !== JSON.stringify(expected)) {
    throw new Error("[mobile-db] plaintext migration row inventory mismatch")
  }
}

async function migrateLegacyDatabase(key: string): Promise<SQLite.SQLiteDatabase> {
  const legacy = SQLite.openDatabaseSync(LEGACY_DATABASE_NAME, { useNewConnection: true })
  const expected = databaseInventory(legacy)
  let migrationError: unknown
  try {
    legacy.execSync(`
      ${buildEncryptedAttachSql(databasePath(ENCRYPTED_DATABASE_NAME), key)}
      SELECT sqlcipher_export('encrypted');
      CREATE TABLE encrypted.${quoteSqliteIdentifier(ENCRYPTION_MARKER_TABLE)} (
        id INTEGER PRIMARY KEY CHECK (id=1), version INTEGER NOT NULL, migratedAt TEXT NOT NULL
      );
      INSERT INTO encrypted.${quoteSqliteIdentifier(ENCRYPTION_MARKER_TABLE)} (id, version, migratedAt)
      VALUES (1, 1, '${new Date().toISOString()}');
      DETACH DATABASE encrypted;
    `)
  } catch (error) {
    migrationError = error
  } finally {
    legacy.closeSync()
  }
  if (migrationError) {
    await SQLite.deleteDatabaseAsync(ENCRYPTED_DATABASE_NAME).catch(() => undefined)
    throw migrationError
  }
  const encrypted = openEncryptedDatabase(key)
  try {
    assertEncryptedDatabase(encrypted, expected, true)
    await SQLite.deleteDatabaseAsync(LEGACY_DATABASE_NAME)
    return encrypted
  } catch (error) {
    encrypted.closeSync()
    throw error
  }
}

async function bootstrapEncryptedDatabase(): Promise<SQLite.SQLiteDatabase> {
  const [encryptedDatabaseExists, legacyDatabaseExists] = await Promise.all([
    databaseExists(ENCRYPTED_DATABASE_NAME),
    databaseExists(LEGACY_DATABASE_NAME),
  ])
  const storedKey = SecureStore.getItem(DATABASE_KEY_NAME, DATABASE_KEY_OPTIONS)
  const plan = encryptedDatabaseBootstrapPlan({
    encryptedDatabaseExists,
    legacyDatabaseExists,
    keyExists: Boolean(storedKey),
  })
  if (plan === "missing-key") {
    throw new Error("[mobile-db] encrypted database key is unavailable; approved local wipe is required")
  }
  const key = readOrCreateDatabaseKey(true)
  if (plan === "migrate-legacy") return migrateLegacyDatabase(key)
  let encrypted: SQLite.SQLiteDatabase | null = null
  try {
    encrypted = openEncryptedDatabase(key)
    if (plan === "create-encrypted") {
      encrypted.execSync(`
        CREATE TABLE ${quoteSqliteIdentifier(ENCRYPTION_MARKER_TABLE)} (
          id INTEGER PRIMARY KEY CHECK (id=1), version INTEGER NOT NULL, migratedAt TEXT NOT NULL
        );
        INSERT INTO ${quoteSqliteIdentifier(ENCRYPTION_MARKER_TABLE)} (id, version, migratedAt)
        VALUES (1, 1, '${new Date().toISOString()}');
      `)
    }
    const expectedLegacyInventory = legacyDatabaseExists ? legacyDatabaseInventory() : undefined
    assertEncryptedDatabase(
      encrypted,
      expectedLegacyInventory,
      plan === "create-encrypted" || Boolean(expectedLegacyInventory),
    )
    if (legacyDatabaseExists) {
      await SQLite.deleteDatabaseAsync(LEGACY_DATABASE_NAME)
    }
    return encrypted
  } catch (error) {
    encrypted?.closeSync()
    if (plan === "create-encrypted") {
      await SQLite.deleteDatabaseAsync(ENCRYPTED_DATABASE_NAME).catch(() => undefined)
    }
    throw error
  }
}

function resetRecoverablePhotoSubmit(clientPhotoId: string): void {
  const rows = db.getAllSync<{ clientOpId: string }>(
    `SELECT clientOpId FROM outbox_ops
     WHERE kind='photo.submit'
       AND status='rejected'
       AND detail='"photo_not_uploaded_yet"'
       AND json_extract(payload, '$.clientPhotoId')=?`,
    [clientPhotoId],
  )
  for (const row of rows) {
    // Сервер уже запомнил прежний clientOpId как rejected. Новый id нужен,
    // чтобы после успешной загрузки повтор был отдельной идемпотентной попыткой.
    db.runSync(
      "UPDATE outbox_ops SET clientOpId=?, status='pending', attempts=0, detail=NULL WHERE clientOpId=?",
      [`op-${Crypto.randomUUID()}`, row.clientOpId],
    )
  }
}

export function initDb(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      db = await bootstrapEncryptedDatabase()
      initializeSchema()
      await bootstrapEncryptedMediaStorage()
    })()
  }
  return initPromise
}

function initializeSchema(): void {
  db.execSync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, title TEXT, status TEXT, dueAt TEXT,
      storeId TEXT, planogramVersionId TEXT, locationHint TEXT, updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY, name TEXT, code TEXT, address TEXT, latitude REAL, longitude REAL
    );
    CREATE TABLE IF NOT EXISTS planogram_bundles (
      versionId TEXT PRIMARY KEY, json TEXT
    );
    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY, name TEXT, agentId TEXT, isActive INTEGER, updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS route_stops (
      id TEXT PRIMARY KEY, routeId TEXT, storeId TEXT, sortOrder INTEGER, plannedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS visits (
      id TEXT PRIMARY KEY, agentId TEXT, storeId TEXT, routeStopId TEXT,
      status TEXT, checkInAt TEXT, checkOutAt TEXT, anomalyFlags TEXT, updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS cursors (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS field_cache (
      k TEXT PRIMARY KEY, json TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mobile_session_scope (
      id INTEGER PRIMARY KEY CHECK (id=1),
      organizationSlug TEXT NOT NULL,
      agentId TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbox_ops (
      clientOpId TEXT PRIMARY KEY, kind TEXT, payload TEXT,
      clientCreatedAt TEXT, status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0, detail TEXT
    );
    CREATE TABLE IF NOT EXISTS photo_queue (
      clientPhotoId TEXT PRIMARY KEY, taskId TEXT, fileUri TEXT,
      takenAt TEXT, exifJson TEXT, mediaType TEXT DEFAULT 'photo',
      durationMs INTEGER, captureStepJson TEXT, uploaded INTEGER DEFAULT 0,
      uploadedAt TEXT, serverPhotoId TEXT, objectKey TEXT, qualityScore REAL,
      qualityCheck TEXT, visionReviewId TEXT, visionStatus TEXT, visionReason TEXT
    );
    CREATE TABLE IF NOT EXISTS commercial_media_queue (
      clientMediaId TEXT PRIMARY KEY,
      clientOpId TEXT NOT NULL UNIQUE,
      purpose TEXT NOT NULL,
      fileUri TEXT NOT NULL,
      takenAt TEXT NOT NULL,
      uploaded INTEGER DEFAULT 0,
      uploadedAt TEXT,
      objectKey TEXT,
      attempts INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      lastError TEXT
    );
    CREATE TABLE IF NOT EXISTS server_photo_submissions (
      id TEXT PRIMARY KEY,
      clientPhotoId TEXT,
      taskId TEXT,
      storeId TEXT,
      objectKey TEXT,
      mediaType TEXT DEFAULT 'photo',
      durationMs INTEGER,
      captureStepJson TEXT,
      takenAt TEXT,
      qualityScore REAL,
      reviewId TEXT,
      reviewReason TEXT,
      reviewStatus TEXT,
      reviewScore REAL,
      reviewNote TEXT,
      reviewedAt TEXT,
      visionReviewId TEXT,
      visionStatus TEXT,
      visionReason TEXT,
      visionScore REAL,
      comparisonResult TEXT,
      updatedAt TEXT
    );
  `)
  const taskColumns = db.getAllSync<{ name: string }>("PRAGMA table_info(tasks)")
  if (!taskColumns.some((c) => c.name === "locationHint")) {
    db.execSync("ALTER TABLE tasks ADD COLUMN locationHint TEXT")
  }
  if (!taskColumns.some((c) => c.name === "captureTemplate")) {
    db.execSync("ALTER TABLE tasks ADD COLUMN captureTemplate TEXT")
  }
  if (!taskColumns.some((c) => c.name === "captureRetakes")) {
    db.execSync("ALTER TABLE tasks ADD COLUMN captureRetakes TEXT")
  }
  const storeColumns = db.getAllSync<{ name: string }>("PRAGMA table_info(stores)")
  if (!storeColumns.some((c) => c.name === "latitude")) {
    db.execSync("ALTER TABLE stores ADD COLUMN latitude REAL")
  }
  if (!storeColumns.some((c) => c.name === "longitude")) {
    db.execSync("ALTER TABLE stores ADD COLUMN longitude REAL")
  }
  const photoColumns = db.getAllSync<{ name: string }>("PRAGMA table_info(photo_queue)")
  const ensurePhotoColumn = (name: string, sql: string) => {
    if (!photoColumns.some((c) => c.name === name)) db.execSync(sql)
  }
  ensurePhotoColumn("uploadedAt", "ALTER TABLE photo_queue ADD COLUMN uploadedAt TEXT")
  ensurePhotoColumn("exifJson", "ALTER TABLE photo_queue ADD COLUMN exifJson TEXT")
  ensurePhotoColumn("mediaType", "ALTER TABLE photo_queue ADD COLUMN mediaType TEXT DEFAULT 'photo'")
  ensurePhotoColumn("durationMs", "ALTER TABLE photo_queue ADD COLUMN durationMs INTEGER")
  ensurePhotoColumn("captureStepJson", "ALTER TABLE photo_queue ADD COLUMN captureStepJson TEXT")
  ensurePhotoColumn("serverPhotoId", "ALTER TABLE photo_queue ADD COLUMN serverPhotoId TEXT")
  ensurePhotoColumn("objectKey", "ALTER TABLE photo_queue ADD COLUMN objectKey TEXT")
  ensurePhotoColumn("qualityScore", "ALTER TABLE photo_queue ADD COLUMN qualityScore REAL")
  ensurePhotoColumn("qualityCheck", "ALTER TABLE photo_queue ADD COLUMN qualityCheck TEXT")
  ensurePhotoColumn("visionReviewId", "ALTER TABLE photo_queue ADD COLUMN visionReviewId TEXT")
  ensurePhotoColumn("visionStatus", "ALTER TABLE photo_queue ADD COLUMN visionStatus TEXT")
  ensurePhotoColumn("visionReason", "ALTER TABLE photo_queue ADD COLUMN visionReason TEXT")
  ensurePhotoColumn("captureFlagsJson", "ALTER TABLE photo_queue ADD COLUMN captureFlagsJson TEXT")
  ensurePhotoColumn(
    "captureTelemetryJson",
    "ALTER TABLE photo_queue ADD COLUMN captureTelemetryJson TEXT",
  )
  ensurePhotoColumn("attempts", "ALTER TABLE photo_queue ADD COLUMN attempts INTEGER DEFAULT 0")
  ensurePhotoColumn("status", "ALTER TABLE photo_queue ADD COLUMN status TEXT DEFAULT 'pending'")
  ensurePhotoColumn("lastError", "ALTER TABLE photo_queue ADD COLUMN lastError TEXT")
  const serverPhotoColumns = db.getAllSync<{ name: string }>("PRAGMA table_info(server_photo_submissions)")
  const ensureServerPhotoColumn = (name: string, sql: string) => {
    if (!serverPhotoColumns.some((c) => c.name === name)) db.execSync(sql)
  }
  ensureServerPhotoColumn("mediaType", "ALTER TABLE server_photo_submissions ADD COLUMN mediaType TEXT DEFAULT 'photo'")
  ensureServerPhotoColumn("durationMs", "ALTER TABLE server_photo_submissions ADD COLUMN durationMs INTEGER")
  ensureServerPhotoColumn("captureStepJson", "ALTER TABLE server_photo_submissions ADD COLUMN captureStepJson TEXT")
  ensureServerPhotoColumn("comparisonResult", "ALTER TABLE server_photo_submissions ADD COLUMN comparisonResult TEXT")
  const uploadedWithStuckSubmit = db.getAllSync<{ clientPhotoId: string }>(
    `SELECT DISTINCT p.clientPhotoId
     FROM photo_queue p
     JOIN outbox_ops o
       ON o.kind='photo.submit'
      AND json_extract(o.payload, '$.clientPhotoId')=p.clientPhotoId
     WHERE p.uploaded=1
       AND o.status='rejected'
       AND o.detail='"photo_not_uploaded_yet"'`,
  )
  db.withTransactionSync(() => {
    for (const photo of uploadedWithStuckSubmit) resetRecoverablePhotoSubmit(photo.clientPhotoId)
  })
}

export type SessionScopeResult =
  | { ok: true; changed: boolean }
  | { ok: false; pendingOps: number; pendingPhotos: number }

/**
 * Prevent cached data from one agent becoming visible to another agent.
 * A scope switch is automatic only when there is no unsent work to lose.
 */
export function prepareMobileSessionScope(
  organizationSlug: string,
  agentId: string,
): SessionScopeResult {
  const current = db.getFirstSync<{ organizationSlug: string; agentId: string }>(
    "SELECT organizationSlug, agentId FROM mobile_session_scope WHERE id=1",
  )
  if (current?.organizationSlug === organizationSlug && current.agentId === agentId) {
    return { ok: true, changed: false }
  }

  const pendingOps = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM outbox_ops WHERE status IN ('pending','conflict','rejected')",
  )?.n ?? 0
  const pendingPhotos = db.getFirstSync<{ n: number }>(
    `SELECT
      (SELECT COUNT(*) FROM photo_queue WHERE uploaded=0) +
      (SELECT COUNT(*) FROM commercial_media_queue WHERE uploaded=0) AS n`,
  )?.n ?? 0
  if ((current || pendingOps > 0 || pendingPhotos > 0) && (pendingOps > 0 || pendingPhotos > 0)) {
    return { ok: false, pendingOps, pendingPhotos }
  }

  db.withTransactionSync(() => {
    for (const table of [
      "tasks",
      "stores",
      "planogram_bundles",
      "routes",
      "route_stops",
      "visits",
      "cursors",
      "outbox_ops",
      "photo_queue",
      "commercial_media_queue",
      "server_photo_submissions",
      "field_cache",
    ]) {
      db.execSync(`DELETE FROM ${table}`)
    }
    db.runSync(
      `INSERT INTO mobile_session_scope (id, organizationSlug, agentId, updatedAt)
       VALUES (1,?,?,?)
       ON CONFLICT(id) DO UPDATE SET organizationSlug=excluded.organizationSlug,
         agentId=excluded.agentId, updatedAt=excluded.updatedAt`,
      [organizationSlug, agentId, new Date().toISOString()],
    )
  })
  return { ok: true, changed: true }
}

export function writeFieldCache(key: string, value: unknown): void {
  db.runSync(
    `INSERT INTO field_cache (k, json, updatedAt) VALUES (?,?,?)
     ON CONFLICT(k) DO UPDATE SET json=excluded.json, updatedAt=excluded.updatedAt`,
    [key, JSON.stringify(value), new Date().toISOString()],
  )
}

export function readFieldCache<T>(key: string): { value: T; updatedAt: string } | null {
  const row = db.getFirstSync<{ json: string; updatedAt: string }>(
    "SELECT json, updatedAt FROM field_cache WHERE k=?",
    [key],
  )
  if (!row) return null
  try {
    return { value: JSON.parse(row.json) as T, updatedAt: row.updatedAt }
  } catch {
    db.runSync("DELETE FROM field_cache WHERE k=?", [key])
    return null
  }
}

export const FIELD_MESSAGES_CACHE_KEY = "field.messages.current"
export const FIELD_DOCUMENTS_CACHE_KEY = "field.documents.current"
export const FIELD_HRM_CACHE_KEY = "field.hrm.current"

function fieldMessageThreadCacheKey(threadId: string): string {
  return `field.messages.thread.${threadId}`
}

export function readFieldMessages(): FieldMessagesData {
  return readFieldCache<FieldMessagesData>(FIELD_MESSAGES_CACHE_KEY)?.value ?? {
    threads: [],
    unread: 0,
    availableRecipients: [],
    capabilities: {
      startDirectConversation: false,
      sendAttachments: true,
      acknowledgeBroadcasts: true,
    },
  }
}

export function cacheFieldMessages(next: FieldMessagesData): FieldMessagesData {
  const previous = readFieldMessages()
  const serverIds = new Set(next.threads.map((thread) => thread.id))
  const optimistic = previous.threads.filter((thread) => thread.syncState && !serverIds.has(thread.id))
  const merged = { ...next, threads: [...optimistic, ...next.threads] }
  writeFieldCache(FIELD_MESSAGES_CACHE_KEY, merged)
  return merged
}

export function readFieldMessageThread(threadId: string): FieldMessageThreadData | null {
  return readFieldCache<FieldMessageThreadData>(fieldMessageThreadCacheKey(threadId))?.value ?? null
}

export function cacheFieldMessageThread(next: FieldMessageThreadData): FieldMessageThreadData {
  const previous = readFieldMessageThread(next.thread.id)
  const serverClientIds = new Set(next.thread.messages.map((message) => message.clientMessageId).filter(Boolean))
  const optimistic = previous?.thread.messages.filter((message) => (
    message.syncState && message.clientMessageId && !serverClientIds.has(message.clientMessageId)
  )) ?? []
  const localUriByDocument = new Map<string, string>()
  for (const message of previous?.thread.messages ?? []) {
    if (message.attachmentDocument?.localUri) {
      localUriByDocument.set(message.attachmentDocument.id, message.attachmentDocument.localUri)
    }
  }
  const merged: FieldMessageThreadData = {
    ...next,
    thread: {
      ...next.thread,
      messages: [
        ...next.thread.messages.map((message) => message.attachmentDocument ? {
          ...message,
          attachmentDocument: {
            ...message.attachmentDocument,
            localUri: localUriByDocument.get(message.attachmentDocument.id) ?? null,
          },
        } : message),
        ...optimistic,
      ].sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
    },
  }
  writeFieldCache(fieldMessageThreadCacheKey(next.thread.id), merged)
  return merged
}

export function readFieldDocuments(): FieldDocumentsData {
  return readFieldCache<FieldDocumentsData>(FIELD_DOCUMENTS_CACHE_KEY)?.value ?? {
    documents: [],
    capabilities: { upload: true, offlineDownload: true, maxUploadBytes: 25 * 1024 * 1024 },
  }
}

export function cacheFieldDocuments(next: FieldDocumentsData): FieldDocumentsData {
  const previous = readFieldDocuments()
  const localUri = new Map<string, string>()
  for (const document of previous.documents) {
    if (!document.localUri) continue
    localUri.set(document.id, document.localUri)
    if (document.clientDocumentId) localUri.set(document.clientDocumentId, document.localUri)
  }
  const serverKeys = new Set(next.documents.flatMap((document) => [document.id, document.clientDocumentId].filter(Boolean)))
  const optimistic = previous.documents.filter((document) => (
    document.syncState && !serverKeys.has(document.id) && !serverKeys.has(document.clientDocumentId)
  ))
  const merged: FieldDocumentsData = {
    ...next,
    documents: [
      ...optimistic,
      ...next.documents.map((document) => ({
        ...document,
        localUri: localUri.get(document.id) ?? (document.clientDocumentId ? localUri.get(document.clientDocumentId) : null) ?? null,
      })),
    ],
  }
  writeFieldCache(FIELD_DOCUMENTS_CACHE_KEY, merged)
  return merged
}

export function setFieldDocumentLocalUri(documentId: string, localUri: string): FieldDocumentsData {
  const current = readFieldDocuments()
  const next = {
    ...current,
    documents: current.documents.map((document) => (
      document.id === documentId || document.clientDocumentId === documentId
        ? { ...document, localUri, assignment: { ...document.assignment, downloadedAt: new Date().toISOString() } }
        : document
    )),
  }
  writeFieldCache(FIELD_DOCUMENTS_CACHE_KEY, next)
  return next
}

export function readFieldHrm(): FieldHrmData | null {
  return readFieldCache<FieldHrmData>(FIELD_HRM_CACHE_KEY)?.value ?? null
}

export function cacheFieldHrm(next: FieldHrmData): FieldHrmData {
  const previous = readFieldHrm()
  const serverClientIds = new Set(next.requests.map((request) => request.clientRequestId))
  const optimistic = previous?.requests.filter((request) => request.syncState && !serverClientIds.has(request.clientRequestId)) ?? []
  const merged = { ...next, requests: [...optimistic, ...next.requests] }
  writeFieldCache(FIELD_HRM_CACHE_KEY, merged)
  return merged
}

export const localStore: LocalStore = {
  async applyPull(data: PullResponse) {
    db.withTransactionSync(() => {
      db.runSync(
        `INSERT INTO field_cache (k, json, updatedAt) VALUES (?,?,?)
         ON CONFLICT(k) DO UPDATE SET json=excluded.json, updatedAt=excluded.updatedAt`,
        [COMMERCIAL_CACHE_KEY, JSON.stringify(data.commercial), data.commercial.generatedAt],
      )
      for (const t of data.tasks) {
        db.runSync(
          `INSERT INTO tasks (id, title, status, dueAt, storeId, planogramVersionId, locationHint, captureTemplate, captureRetakes, updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title, status=excluded.status,
             dueAt=excluded.dueAt, storeId=excluded.storeId,
             planogramVersionId=excluded.planogramVersionId, locationHint=excluded.locationHint,
             captureTemplate=excluded.captureTemplate, captureRetakes=excluded.captureRetakes,
             updatedAt=excluded.updatedAt`,
          [
            t.id,
            t.title,
            t.status,
            t.dueAt,
            t.storeId,
            t.planogramVersionId,
            t.locationHint ? JSON.stringify(t.locationHint) : null,
            t.captureTemplate ? JSON.stringify(t.captureTemplate) : null,
            t.captureRetakes && t.captureRetakes.length > 0 ? JSON.stringify(t.captureRetakes) : null,
            t.updatedAt,
          ],
        )
      }
      for (const s of data.stores) {
        db.runSync(
          `INSERT INTO stores (id, name, code, address, latitude, longitude) VALUES (?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code, address=excluded.address,
             latitude=excluded.latitude, longitude=excluded.longitude`,
          [s.id, s.name, s.code, s.address, s.latitude, s.longitude],
        )
      }
      for (const b of data.planogramBundles) {
        db.runSync(
          `INSERT INTO planogram_bundles (versionId, json) VALUES (?,?)
           ON CONFLICT(versionId) DO UPDATE SET json=excluded.json`,
          [b.versionId, JSON.stringify(b)],
        )
      }
      for (const route of data.routes) {
        db.runSync(
          `INSERT INTO routes (id, name, agentId, isActive, updatedAt) VALUES (?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, agentId=excluded.agentId,
             isActive=excluded.isActive, updatedAt=excluded.updatedAt`,
          [route.id, route.name, route.agentId, route.isActive ? 1 : 0, route.updatedAt],
        )
        for (const stop of route.stops) {
          db.runSync(
            `INSERT INTO route_stops (id, routeId, storeId, sortOrder, plannedAt) VALUES (?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET routeId=excluded.routeId, storeId=excluded.storeId,
               sortOrder=excluded.sortOrder, plannedAt=excluded.plannedAt`,
            [stop.id, stop.routeId, stop.storeId, stop.sortOrder, stop.plannedAt],
          )
        }
      }
      for (const visit of data.visits) {
        db.runSync(
          `INSERT INTO visits (id, agentId, storeId, routeStopId, status, checkInAt, checkOutAt, anomalyFlags, updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET status=excluded.status, checkInAt=excluded.checkInAt,
             checkOutAt=excluded.checkOutAt, anomalyFlags=excluded.anomalyFlags, updatedAt=excluded.updatedAt`,
          [
            visit.id,
            visit.agentId,
            visit.storeId,
            visit.routeStopId,
            visit.status,
            visit.checkInAt,
            visit.checkOutAt,
            visit.anomalyFlags == null ? null : JSON.stringify(visit.anomalyFlags),
            visit.updatedAt,
          ],
        )
      }
      for (const photo of data.photoSubmissions) {
        db.runSync(
          `INSERT INTO server_photo_submissions (
             id, clientPhotoId, taskId, storeId, objectKey, mediaType, durationMs, captureStepJson,
             takenAt, qualityScore,
             reviewId, reviewReason, reviewStatus, reviewScore, reviewNote, reviewedAt,
             visionReviewId, visionStatus, visionReason, visionScore, comparisonResult, updatedAt
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             clientPhotoId=excluded.clientPhotoId,
             taskId=excluded.taskId,
             storeId=excluded.storeId,
             objectKey=excluded.objectKey,
             mediaType=excluded.mediaType,
             durationMs=excluded.durationMs,
             captureStepJson=excluded.captureStepJson,
             takenAt=excluded.takenAt,
             qualityScore=excluded.qualityScore,
             reviewId=excluded.reviewId,
             reviewReason=excluded.reviewReason,
             reviewStatus=excluded.reviewStatus,
             reviewScore=excluded.reviewScore,
             reviewNote=excluded.reviewNote,
             reviewedAt=excluded.reviewedAt,
             visionReviewId=excluded.visionReviewId,
             visionStatus=excluded.visionStatus,
             visionReason=excluded.visionReason,
             visionScore=excluded.visionScore,
             comparisonResult=excluded.comparisonResult,
             updatedAt=excluded.updatedAt`,
          [
            photo.id,
            photo.clientPhotoId,
            photo.taskId,
            photo.storeId,
            photo.key,
            photo.mediaType,
            photo.durationMs ?? null,
            photo.captureStep ? JSON.stringify(photo.captureStep) : null,
            photo.takenAt,
            photo.qualityScore,
            photo.review?.id ?? null,
            photo.review?.reason ?? null,
            photo.review?.status ?? null,
            photo.review?.score ?? null,
            photo.review?.note ?? null,
            photo.review?.reviewedAt ?? null,
            photo.vision?.id ?? null,
            photo.vision?.status ?? null,
            photo.vision?.note ?? null,
            photo.vision?.score ?? null,
            photo.comparison ? JSON.stringify(photo.comparison) : null,
            photo.updatedAt,
          ],
        )
      }
    })
  },

  async getCursors() {
    const rows = db.getAllSync<{ k: string; v: string }>("SELECT k, v FROM cursors")
    const map = Object.fromEntries(rows.map((r) => [r.k, r.v]))
    return {
      tasks: map.tasks ?? null,
      planogramBundles: map.planogramBundles ?? null,
      routes: map.routes ?? null,
      visits: map.visits ?? null,
      photoSubmissions: map.photoSubmissions ?? null,
    }
  },

  async setCursors(c) {
    db.withTransactionSync(() => {
      for (const [k, v] of Object.entries(c)) {
        if (v == null) continue
        db.runSync(
          "INSERT INTO cursors (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
          [k, v],
        )
      }
    })
  },

  async pendingOutbox(limit = 100) {
    return db
      .getAllSync<{
        clientOpId: string
        kind: string
        payload: string
        clientCreatedAt: string | null
        status: string
        attempts: number
      }>(
        `SELECT * FROM outbox_ops
         WHERE (status='pending'
            OR (status='rejected' AND kind='photo.submit' AND detail='"photo_not_uploaded_yet"'))
           AND NOT EXISTS (
             SELECT 1 FROM commercial_media_queue media
             WHERE media.clientOpId=outbox_ops.clientOpId AND media.uploaded=0
           )
         ORDER BY clientCreatedAt, rowid LIMIT ?`,
        [limit],
      )
      .map((r): OutboxRow => {
        const rawPayload = JSON.parse(r.payload) as unknown
        if (r.kind === "task.status") {
          return {
            clientOpId: r.clientOpId,
            kind: "task.status",
            payload: mobileTaskStatusPayloadSchema.parse(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "photo.submit") {
          return {
            clientOpId: r.clientOpId,
            kind: "photo.submit",
            payload: mobilePhotoSubmitPayloadSchema.parse(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "visit.checkin") {
          return {
            clientOpId: r.clientOpId,
            kind: "visit.checkin",
            payload: mobileVisitCheckInPayloadSchema.parse(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "visit.checkout") {
          return {
            clientOpId: r.clientOpId,
            kind: "visit.checkout",
            payload: mobileVisitCheckOutPayloadSchema.parse(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "location.update") {
          return {
            clientOpId: r.clientOpId,
            kind: "location.update",
            payload: mobileLocationUpdatePayloadSchema.parse(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.route.create") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.route.create",
            payload: parseFieldRouteCreatePayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.route.update") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.route.update",
            payload: parseFieldRouteUpdatePayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.route.publish") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.route.publish",
            payload: parseFieldRoutePublishPayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.route.change-request") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.route.change-request",
            payload: parseFieldRouteChangeRequestPayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.visit.checkin") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.visit.checkin",
            payload: parseFieldVisitCheckInPayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.visit.action") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.visit.action",
            payload: parseFieldVisitActionPayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.visit.update") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.visit.update",
            payload: parseFieldVisitUpdatePayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.visit.photo") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.visit.photo",
            payload: parseFieldVisitPhotoPayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.workday.event") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.workday.event",
            payload: parseFieldWorkdayEventPayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.location") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.location",
            payload: parseFieldLocationPayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.task.create") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.task.create",
            payload: parseFieldTaskCreatePayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.task.update") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.task.update",
            payload: parseFieldTaskUpdatePayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.task.event") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.task.event",
            payload: parseFieldTaskEventPayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.commitment.create") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.commitment.create",
            payload: parseFieldCommitmentCreatePayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.commitment.fulfill") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.commitment.fulfill",
            payload: parseFieldCommitmentFulfillPayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.message.send") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.message.send",
            payload: parseFieldMessageCreatePayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.message.receipt") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.message.receipt",
            payload: parseFieldMessageReceiptPayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.document.upload") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.document.upload",
            payload: parseFieldDocumentUploadPayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.document.state") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.document.state",
            payload: parseFieldDocumentStatePayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.hrm.create") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.hrm.create",
            payload: parseFieldHrmRequestCreatePayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "field.hrm.cancel") {
          return {
            clientOpId: r.clientOpId,
            kind: "field.hrm.cancel",
            payload: parseFieldHrmRequestCancelPayload(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "order.create") {
          return {
            clientOpId: r.clientOpId,
            kind: "order.create",
            payload: orderCreateRequestSchema.parse(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "promotion.enroll") {
          return {
            clientOpId: r.clientOpId,
            kind: "promotion.enroll",
            payload: mobilePromotionEnrollPayloadSchema.parse(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "promotion.submit") {
          return {
            clientOpId: r.clientOpId,
            kind: "promotion.submit",
            payload: mobilePromotionSubmitPayloadSchema.parse(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "inventory.record") {
          return {
            clientOpId: r.clientOpId,
            kind: "inventory.record",
            payload: mobilePromoInventoryRecordPayloadSchema.parse(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "return.create") {
          return {
            clientOpId: r.clientOpId,
            kind: "return.create",
            payload: mobileSalesReturnCreatePayloadSchema.parse(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "reward.claim") {
          return {
            clientOpId: r.clientOpId,
            kind: "reward.claim",
            payload: mobileRewardClaimPayloadSchema.parse(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        if (r.kind === "proof.exception") {
          return {
            clientOpId: r.clientOpId,
            kind: "proof.exception",
            payload: mobileProofExceptionPayloadSchema.parse(rawPayload),
            clientCreatedAt: r.clientCreatedAt ?? undefined,
            status: "pending",
            attempts: r.attempts,
          }
        }
        return {
          clientOpId: r.clientOpId,
          kind: "task.comment",
          payload: mobileTaskCommentPayloadSchema.parse(rawPayload),
          clientCreatedAt: r.clientCreatedAt ?? undefined,
          status: "pending",
          attempts: r.attempts,
        }
      })
  },

  async outboxDiagnostics() {
    const row = db.getFirstSync<{
      pendingOps: number | null
      conflictOps: number | null
      rejectedOps: number | null
      oldestPendingAt: string | null
    }>(`SELECT
      SUM(CASE WHEN status='pending' OR (status='rejected' AND kind='photo.submit' AND detail='"photo_not_uploaded_yet"') THEN 1 ELSE 0 END) AS pendingOps,
      SUM(CASE WHEN status='conflict' THEN 1 ELSE 0 END) AS conflictOps,
      SUM(CASE WHEN status='rejected' AND (kind!='photo.submit' OR COALESCE(detail,'')!='"photo_not_uploaded_yet"') THEN 1 ELSE 0 END) AS rejectedOps,
      MIN(CASE WHEN status='pending' OR (status='rejected' AND kind='photo.submit' AND detail='"photo_not_uploaded_yet"') THEN clientCreatedAt ELSE NULL END) AS oldestPendingAt
      FROM outbox_ops`)
    return {
      pendingOps: row?.pendingOps ?? 0,
      conflictOps: row?.conflictOps ?? 0,
      rejectedOps: row?.rejectedOps ?? 0,
      oldestPendingAt: row?.oldestPendingAt ?? null,
    }
  },

  async markOutbox(clientOpId, status, detail) {
    const op = db.getFirstSync<{ kind: string; payload: string }>(
      "SELECT kind, payload FROM outbox_ops WHERE clientOpId=?",
      [clientOpId],
    )
    db.runSync("UPDATE outbox_ops SET status=?, detail=? WHERE clientOpId=?", [
      status,
      detail == null ? null : JSON.stringify(detail),
      clientOpId,
    ])
    if (op) applyOutboxResultSideEffects(clientOpId, op.kind, op.payload, status, detail)
  },

  async bumpOutboxAttempts(ids) {
    db.withTransactionSync(() => {
      for (const id of ids) {
        db.runSync("UPDATE outbox_ops SET attempts = attempts + 1 WHERE clientOpId=?", [id])
      }
    })
  },

  async pendingPhotos() {
    const rows = db.getAllSync<{
      clientPhotoId: string
      taskId: string
      fileUri: string
      takenAt: string
      mediaType: "photo" | "video" | null
      durationMs: number | null
      captureStepJson: string | null
      exifJson: string | null
      captureFlagsJson: string | null
      captureTelemetryJson: string | null
      attempts: number | null
    }>(
      `SELECT clientPhotoId, taskId, fileUri, takenAt, mediaType, durationMs, captureStepJson, exifJson,
        captureFlagsJson, captureTelemetryJson, attempts
       FROM photo_queue
       WHERE uploaded=0 AND (status IS NULL OR status='pending')`,
    )
    return rows.map(
      (r): PhotoQueueRow => ({ ...r, mediaType: r.mediaType ?? "photo", attempts: r.attempts ?? 0, uploaded: false }),
    )
  },

  async unuploadedPhotoIds() {
    return db
      .getAllSync<{ clientPhotoId: string }>("SELECT clientPhotoId FROM photo_queue WHERE uploaded=0")
      .map((row) => row.clientPhotoId)
  },

  async markPhotoUploaded(clientPhotoId, result) {
    db.withTransactionSync(() => {
      db.runSync(
        `UPDATE photo_queue SET uploaded=1, uploadedAt=?, serverPhotoId=?, objectKey=?,
          qualityScore=?, qualityCheck=?, visionReviewId=?, visionStatus=?, visionReason=?, lastError=NULL
         WHERE clientPhotoId=?`,
        [
          new Date().toISOString(),
          result.photoId,
          result.key,
          result.qualityScore ?? null,
          result.qualityCheck == null ? null : JSON.stringify(result.qualityCheck),
          result.visionReviewId ?? null,
          result.visionStatus ?? null,
          result.visionReason ?? null,
          clientPhotoId,
        ],
      )
      resetRecoverablePhotoSubmit(clientPhotoId)
    })
  },

  async bumpPhotoAttempts(clientPhotoIds, reason) {
    db.withTransactionSync(() => {
      for (const id of clientPhotoIds) {
        db.runSync(
          "UPDATE photo_queue SET attempts = COALESCE(attempts,0) + 1, lastError=? WHERE clientPhotoId=?",
          [reason?.slice(0, 500) ?? null, id],
        )
      }
    })
  },

  async quarantinePhoto(clientPhotoId, reason) {
    db.runSync(
      "UPDATE photo_queue SET status='quarantined', lastError=?, attempts = COALESCE(attempts,0) + 1 WHERE clientPhotoId=?",
      [reason.slice(0, 500), clientPhotoId],
    )
  },

  async quarantinedPhotoCount() {
    const row = db.getFirstSync<{ n: number }>(
      `SELECT
        (SELECT COUNT(*) FROM photo_queue WHERE uploaded=0 AND status='quarantined') +
        (SELECT COUNT(*) FROM commercial_media_queue WHERE uploaded=0 AND status='quarantined') AS n`,
    )
    return row?.n ?? 0
  },

  async cleanupUploadedPhotoFiles() {
    const rows = db.getAllSync<{ clientPhotoId: string; fileUri: string }>(
      `SELECT DISTINCT p.clientPhotoId, p.fileUri
       FROM photo_queue p
       JOIN outbox_ops o
         ON o.kind='photo.submit'
        AND o.status='applied'
        AND json_extract(o.payload, '$.clientPhotoId')=p.clientPhotoId
       JOIN server_photo_submissions s ON s.clientPhotoId=p.clientPhotoId
       WHERE p.uploaded=1 AND p.fileUri IS NOT NULL`,
    )
    let removed = 0
    for (const row of rows) {
      try {
        await FileSystem.deleteAsync(row.fileUri, { idempotent: true })
        db.runSync("UPDATE photo_queue SET fileUri=NULL WHERE clientPhotoId=?", [row.clientPhotoId])
        removed++
      } catch {
        // Оставляем URI: очистка повторится после следующей синхронизации.
      }
    }
    return removed
  },
  async pendingCommercialMedia() {
    return db.getAllSync<{
      clientMediaId: string
      clientOpId: string
      purpose: MobileCommercialMediaPurpose
      fileUri: string
      takenAt: string
      attempts: number | null
      uploaded: number
    }>(
      `SELECT clientMediaId, clientOpId, purpose, fileUri, takenAt, attempts, uploaded
       FROM commercial_media_queue
       WHERE uploaded=0 AND (status IS NULL OR status='pending')
       ORDER BY takenAt, rowid`,
    ).map((row) => ({ ...row, attempts: row.attempts ?? 0, uploaded: Boolean(row.uploaded) }))
  },

  async markCommercialMediaUploaded(clientMediaId, result) {
    const media = db.getFirstSync<{
      clientOpId: string
      purpose: MobileCommercialMediaPurpose
    }>("SELECT clientOpId, purpose FROM commercial_media_queue WHERE clientMediaId=?", [clientMediaId])
    if (!media) throw new Error("Commercial media queue row not found")
    if (media.purpose !== result.purpose) throw new Error("Commercial media purpose mismatch")
    const operation = db.getFirstSync<{ kind: string; payload: string }>(
      "SELECT kind, payload FROM outbox_ops WHERE clientOpId=?",
      [media.clientOpId],
    )
    if (!operation) throw new Error("Commercial media operation not found")
    const rawPayload = parseJsonOrNull<Record<string, unknown>>(operation.payload)
    if (!rawPayload) throw new Error("Commercial media operation payload is invalid")
    if (operation.kind !== "promotion.submit" && operation.kind !== "return.create") {
      throw new Error("Commercial media operation kind mismatch")
    }
    const nextPayload = attachCommercialMediaToOperation({
      kind: operation.kind,
      payload: rawPayload,
      purpose: media.purpose,
      key: result.key,
    })

    db.withTransactionSync(() => {
      db.runSync(
        "UPDATE outbox_ops SET payload=?, status='pending', detail=NULL WHERE clientOpId=?",
        [JSON.stringify(nextPayload), media.clientOpId],
      )
      db.runSync(
        `UPDATE commercial_media_queue
         SET uploaded=1, uploadedAt=?, objectKey=?, lastError=NULL
         WHERE clientMediaId=?`,
        [new Date().toISOString(), result.key, clientMediaId],
      )
    })
  },

  async bumpCommercialMediaAttempts(clientMediaIds, reason) {
    db.withTransactionSync(() => {
      for (const clientMediaId of clientMediaIds) {
        db.runSync(
          `UPDATE commercial_media_queue
           SET attempts=COALESCE(attempts,0)+1, lastError=?
           WHERE clientMediaId=?`,
          [reason?.slice(0, 500) ?? null, clientMediaId],
        )
      }
    })
  },

  async quarantineCommercialMedia(clientMediaId, reason) {
    db.runSync(
      `UPDATE commercial_media_queue
       SET status='quarantined', attempts=COALESCE(attempts,0)+1, lastError=?
       WHERE clientMediaId=?`,
      [reason.slice(0, 500), clientMediaId],
    )
  },
}

export interface CommercialMediaRecoveryRow {
  clientMediaId: string
  clientOpId: string
  purpose: MobileCommercialMediaPurpose
  operationKind: CommercialMediaOperationKind
  fileUri: string
  takenAt: string
  attempts: number
  status: "pending" | "quarantined"
  lastError: string | null
}

export function listCommercialMediaRecoveryQueue(): CommercialMediaRecoveryRow[] {
  return db.getAllSync<{
    clientMediaId: string
    clientOpId: string
    purpose: MobileCommercialMediaPurpose
    operationKind: CommercialMediaOperationKind
    fileUri: string
    takenAt: string
    attempts: number | null
    status: string | null
    lastError: string | null
  }>(
    `SELECT media.clientMediaId, media.clientOpId, media.purpose,
            ops.kind AS operationKind, media.fileUri, media.takenAt,
            media.attempts, media.status, media.lastError
     FROM commercial_media_queue media
     JOIN outbox_ops ops ON ops.clientOpId=media.clientOpId
     WHERE media.uploaded=0
     ORDER BY CASE WHEN media.status='quarantined' THEN 0 ELSE 1 END,
              media.takenAt, media.rowid`,
  ).flatMap((row) => {
    if (row.operationKind !== "promotion.submit" && row.operationKind !== "return.create") return []
    return [{
      ...row,
      attempts: row.attempts ?? 0,
      status: row.status === "quarantined" ? "quarantined" as const : "pending" as const,
    }]
  })
}

export function retryCommercialMedia(clientMediaId: string): boolean {
  const media = db.getFirstSync<{ clientOpId: string }>(
    "SELECT clientOpId FROM commercial_media_queue WHERE clientMediaId=? AND uploaded=0",
    [clientMediaId],
  )
  if (!media) return false
  db.withTransactionSync(() => {
    db.runSync(
      `UPDATE commercial_media_queue
       SET status='pending', attempts=0, lastError=NULL
       WHERE clientMediaId=? AND uploaded=0`,
      [clientMediaId],
    )
    db.runSync(
      "UPDATE outbox_ops SET status='pending', detail=NULL WHERE clientOpId=?",
      [media.clientOpId],
    )
  })
  return true
}

export function detachCommercialMedia(clientMediaId: string): { fileUri: string; clientOpId: string } | null {
  const row = db.getFirstSync<{
    clientOpId: string
    purpose: MobileCommercialMediaPurpose
    fileUri: string
    operationKind: string
    payload: string
  }>(
    `SELECT media.clientOpId, media.purpose, media.fileUri,
            ops.kind AS operationKind, ops.payload
     FROM commercial_media_queue media
     JOIN outbox_ops ops ON ops.clientOpId=media.clientOpId
     WHERE media.clientMediaId=? AND media.uploaded=0`,
    [clientMediaId],
  )
  if (!row) return null
  if (row.operationKind !== "promotion.submit" && row.operationKind !== "return.create") {
    throw new Error("Commercial media operation kind mismatch")
  }
  const payload = parseJsonOrNull<Record<string, unknown>>(row.payload)
  if (!payload) throw new Error("Commercial media operation payload is invalid")
  const nextPayload = detachCommercialMediaFromOperation({
    kind: row.operationKind,
    payload,
    purpose: row.purpose,
  })
  db.withTransactionSync(() => {
    db.runSync("DELETE FROM commercial_media_queue WHERE clientMediaId=? AND uploaded=0", [clientMediaId])
    db.runSync(
      "UPDATE outbox_ops SET payload=?, status='pending', detail=NULL WHERE clientOpId=?",
      [JSON.stringify(nextPayload), row.clientOpId],
    )
  })
  return { fileUri: row.fileUri, clientOpId: row.clientOpId }
}

// --- локальные чтения/записи для UI ---

export function getLogoutDataSummary(): {
  unsyncedOperations: number
  unsyncedPhotos: number
} {
  const operations = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM outbox_ops WHERE status IS NULL OR status!='applied'",
  )
  const photos = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM photo_queue WHERE uploaded=0",
  )
  return {
    unsyncedOperations: operations?.n ?? 0,
    unsyncedPhotos: photos?.n ?? 0,
  }
}

export function purgeLocalOperationalData(): void {
  db.withTransactionSync(() => {
    db.execSync(`
      DELETE FROM outbox_ops;
      DELETE FROM photo_queue;
      DELETE FROM server_photo_submissions;
      DELETE FROM visits;
      DELETE FROM route_stops;
      DELETE FROM routes;
      DELETE FROM planogram_bundles;
      DELETE FROM tasks;
      DELETE FROM stores;
      DELETE FROM cursors;
    `)
  })
}

export function getLocalDatabaseCapacity(): LocalDatabaseCapacity {
  const pageCount = db.getFirstSync<{ page_count: number }>("PRAGMA page_count")?.page_count ?? 0
  const pageSize = db.getFirstSync<{ page_size: number }>("PRAGMA page_size")?.page_size ?? 0
  const freePageCount = db.getFirstSync<{ freelist_count: number }>("PRAGMA freelist_count")?.freelist_count ?? 0
  return calculateLocalDatabaseCapacity({ pageCount, pageSize, freePageCount })
}

type TaskDbRow = Omit<TaskRow, "locationHint" | "captureTemplate" | "captureRetakes"> & {
  locationHint?: string | null
  captureTemplate?: string | null
  captureRetakes?: string | null
}

function parseJsonOrNull<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function mapTaskRow(row: TaskDbRow): TaskRow {
  return {
    ...row,
    locationHint: parseJsonOrNull(row.locationHint),
    captureTemplate: parseJsonOrNull(row.captureTemplate),
    captureRetakes: parseJsonOrNull(row.captureRetakes) ?? undefined,
  }
}

export function listTasks(): TaskRow[] {
  return db
    .getAllSync<TaskDbRow>("SELECT * FROM tasks ORDER BY dueAt IS NULL, dueAt, title")
    .map(mapTaskRow)
}

/** Совпадает с определением «открытых» на локальном dashboard. */
export function countOpenTasks(): number {
  const placeholders = OPEN_TASK_STATUSES.map(() => "?").join(",")
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM tasks WHERE status IN (${placeholders})`,
    [...OPEN_TASK_STATUSES],
  )
  return row?.count ?? 0
}

export function getTask(id: string): TaskRow | null {
  const row = db.getFirstSync<TaskDbRow>("SELECT * FROM tasks WHERE id=?", [id])
  return row ? mapTaskRow(row) : null
}

export function getStore(id: string): StoreRow | null {
  return db.getFirstSync<StoreRow>("SELECT * FROM stores WHERE id=?", [id])
}

export function getBundle(versionId: string): Record<string, unknown> | null {
  const row = db.getFirstSync<{ json: string }>(
    "SELECT json FROM planogram_bundles WHERE versionId=?",
    [versionId],
  )
  return row ? (JSON.parse(row.json) as Record<string, unknown>) : null
}

/** Планограммы и оборудование только из назначенных задач, уже сохранённых в SQLite. */
export function listLocalPlanogramLibrary(): LocalPlanogramLibrary {
  const rows = db.getAllSync<LocalPlanogramBundleRow>(
    `SELECT pb.versionId, pb.json, MIN(t.id) AS taskId
     FROM planogram_bundles pb
     INNER JOIN tasks t ON t.planogramVersionId=pb.versionId
     GROUP BY pb.versionId, pb.json`,
  )
  return parseLocalPlanogramLibrary(rows)
}

export type TaskPhotoProofRow = {
  clientPhotoId: string
  taskId: string
  fileUri: string | null
  takenAt: string
  exifJson: string | null
  mediaType: "photo" | "video"
  durationMs: number | null
  captureStepJson: string | null
  uploaded: boolean
  uploadedAt: string | null
  serverPhotoId: string | null
  objectKey: string | null
  qualityScore: number | null
  qualityCheck: unknown | null
  visionReviewId: string | null
  visionStatus: string | null
  visionReason: string | null
  reviewId: string | null
  reviewReason: string | null
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED" | null
  reviewScore: number | null
  reviewNote: string | null
  reviewedAt: string | null
  comparisonResult: MobileShelfComparisonResult | null
  outboxStatus: "pending" | "applied" | "conflict" | "rejected" | null
  outboxDetail: unknown | null
}

export function listTaskPhotoProofs(taskId: string): TaskPhotoProofRow[] {
  const localRows = db.getAllSync<{
    clientPhotoId: string
    taskId: string
    fileUri: string | null
    takenAt: string
    exifJson: string | null
    mediaType: "photo" | "video" | null
    durationMs: number | null
    captureStepJson: string | null
    uploaded: number
    uploadedAt: string | null
    serverPhotoId: string | null
    objectKey: string | null
    qualityScore: number | null
    qualityCheck: string | null
    visionReviewId: string | null
    visionStatus: string | null
    visionReason: string | null
    outboxStatus: "pending" | "applied" | "conflict" | "rejected" | null
    outboxDetail: string | null
  }>(
    `SELECT p.clientPhotoId, p.taskId, p.fileUri, p.takenAt, p.exifJson, p.mediaType, p.durationMs,
      p.captureStepJson, p.uploaded, p.uploadedAt,
      p.serverPhotoId, p.objectKey, p.qualityScore, p.qualityCheck,
      p.visionReviewId, p.visionStatus, p.visionReason,
      o.status AS outboxStatus, o.detail AS outboxDetail
     FROM photo_queue p
     LEFT JOIN outbox_ops o
       ON o.kind='photo.submit'
      AND json_extract(o.payload, '$.clientPhotoId') = p.clientPhotoId
     WHERE p.taskId=?
    ORDER BY p.takenAt DESC`,
    [taskId],
  )
  const localProofs = localRows.map((row): TaskPhotoProofRow => ({
    ...row,
    mediaType: row.mediaType ?? "photo",
    uploaded: Boolean(row.uploaded),
    qualityCheck: row.qualityCheck ? JSON.parse(row.qualityCheck) : null,
    reviewId: null,
    reviewReason: null,
    reviewStatus: null,
    reviewScore: null,
    reviewNote: null,
    reviewedAt: null,
    comparisonResult: null,
    outboxDetail: row.outboxDetail ? JSON.parse(row.outboxDetail) : null,
  }))
  const localClientIds = new Set(localProofs.map((row) => row.clientPhotoId))
  const serverRows = db.getAllSync<{
    id: string
    clientPhotoId: string | null
    taskId: string
    objectKey: string | null
    mediaType: "photo" | "video" | null
    durationMs: number | null
    captureStepJson: string | null
    takenAt: string
    qualityScore: number | null
    reviewId: string | null
    reviewReason: string | null
    reviewStatus: "PENDING" | "APPROVED" | "REJECTED" | null
    reviewScore: number | null
    reviewNote: string | null
    reviewedAt: string | null
    visionReviewId: string | null
    visionStatus: string | null
    visionReason: string | null
    comparisonResult: string | null
  }>(
    `SELECT id, clientPhotoId, taskId, objectKey, mediaType, durationMs, captureStepJson,
      takenAt, qualityScore,
      reviewId, reviewReason, reviewStatus, reviewScore, reviewNote, reviewedAt,
      visionReviewId, visionStatus, visionReason, comparisonResult
     FROM server_photo_submissions
     WHERE taskId=?
     ORDER BY takenAt DESC`,
    [taskId],
  )
  const serverByClientId = new Map(
    serverRows
      .filter((row): row is typeof row & { clientPhotoId: string } => Boolean(row.clientPhotoId))
      .map((row) => [row.clientPhotoId, row]),
  )
  const mergedLocalProofs = localProofs.map((proof) => {
    const server = serverByClientId.get(proof.clientPhotoId)
    if (!server) return proof
    return {
      ...proof,
      uploaded: true,
      serverPhotoId: proof.serverPhotoId ?? server.id,
      objectKey: proof.objectKey ?? server.objectKey,
      qualityScore: server.qualityScore ?? proof.qualityScore,
      visionReviewId: server.visionReviewId ?? proof.visionReviewId,
      visionStatus: server.visionStatus ?? proof.visionStatus,
      visionReason: server.visionReason ?? proof.visionReason,
      reviewId: server.reviewId,
      reviewReason: server.reviewReason,
      reviewStatus: server.reviewStatus,
      reviewScore: server.reviewScore,
      reviewNote: server.reviewNote,
      reviewedAt: server.reviewedAt,
      comparisonResult: parseJsonOrNull<MobileShelfComparisonResult>(server.comparisonResult),
    }
  })
  const serverProofs = serverRows
    .filter((row) => !row.clientPhotoId || !localClientIds.has(row.clientPhotoId))
    .map(
      (row): TaskPhotoProofRow => ({
        clientPhotoId: row.clientPhotoId ?? `server-${row.id}`,
        taskId: row.taskId,
        fileUri: null,
        exifJson: null,
        mediaType: row.mediaType ?? "photo",
        durationMs: row.durationMs,
        captureStepJson: row.captureStepJson,
        takenAt: row.takenAt,
        uploaded: true,
        uploadedAt: null,
        serverPhotoId: row.id,
        objectKey: row.objectKey,
        qualityScore: row.qualityScore,
        qualityCheck: null,
        visionReviewId: row.visionReviewId,
        visionStatus: row.visionStatus,
        visionReason: row.visionReason,
        reviewId: row.reviewId,
        reviewReason: row.reviewReason,
        reviewStatus: row.reviewStatus,
        reviewScore: row.reviewScore,
        reviewNote: row.reviewNote,
        reviewedAt: row.reviewedAt,
        comparisonResult: parseJsonOrNull<MobileShelfComparisonResult>(row.comparisonResult),
        outboxStatus: null,
        outboxDetail: null,
      }),
    )
  return [...mergedLocalProofs, ...serverProofs].sort((a, b) => b.takenAt.localeCompare(a.takenAt))
}

export function listRoutes(): RouteRow[] {
  return db
    .getAllSync<Omit<RouteRow, "stops" | "isActive"> & { isActive: number }>(
      "SELECT id, name, agentId, isActive, updatedAt FROM routes WHERE isActive=1 ORDER BY name",
    )
    .map((route) => ({ ...route, isActive: Boolean(route.isActive), stops: listRouteStops(route.id) }))
}

export function listRouteStops(routeId: string): RouteStopRow[] {
  return db.getAllSync<RouteStopRow>(
    "SELECT id, routeId, storeId, sortOrder, plannedAt FROM route_stops WHERE routeId=? ORDER BY sortOrder",
    [routeId],
  )
}

export function listVisits(): VisitRow[] {
  return db
    .getAllSync<VisitRow & { anomalyFlags: string | null }>(
      "SELECT * FROM visits ORDER BY checkInAt DESC, updatedAt DESC",
    )
    .map((visit) => ({
      ...visit,
      anomalyFlags: visit.anomalyFlags ? JSON.parse(visit.anomalyFlags) : null,
    }))
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const value = JSON.parse(raw) as unknown
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function unknownRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

export interface LocalCatalogProductRow {
  id: string
  sku: string
  name: string
  unit: string | null
  brandName: string | null
  barcode: string | null
}

/**
 * Каталог, который уже есть на устройстве внутри immutable planogram bundles.
 * Отдельную sync-коллекцию намеренно не добавляем: форма заказа остаётся в
 * рамках замороженного mobile-протокола и работает без сети.
 */
export function listLocalCatalogProducts(): LocalCatalogProductRow[] {
  const rows = db.getAllSync<{ json: string }>("SELECT json FROM planogram_bundles")
  const products = new Map<string, LocalCatalogProductRow>()

  for (const row of rows) {
    try {
      const bundle = unknownRecord(JSON.parse(row.json) as unknown)
      const placements = Array.isArray(bundle?.placements) ? bundle.placements : []
      for (const rawPlacement of placements) {
        const product = unknownRecord(unknownRecord(rawPlacement)?.product)
        const id = stringValue(product?.id)
        const sku = stringValue(product?.sku)
        const name = stringValue(product?.name)
        if (!id || !sku || !name || products.has(id)) continue
        products.set(id, {
          id,
          sku,
          name,
          unit: stringValue(product?.unit),
          brandName: stringValue(product?.brandName),
          barcode: stringValue(product?.barcode),
        })
      }
    } catch {
      // Повреждённый/старый bundle не должен ломать офлайн-форму заказа.
    }
  }

  return [...products.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku),
  )
}

function applyOutboxResultSideEffects(
  clientOpId: string,
  kind: string,
  rawPayload: string,
  status: "pending" | "applied" | "conflict" | "rejected",
  detail: unknown,
): void {
  if (kind === "field.task.create" || kind === "field.task.update" || kind === "field.task.event") {
    try {
      const raw = JSON.parse(rawPayload) as unknown
      const operation: Parameters<typeof reconcileAgentTaskOperation>[1] = kind === "field.task.create"
        ? { kind, payload: parseFieldTaskCreatePayload(raw), clientOpId }
        : kind === "field.task.update"
          ? { kind, payload: parseFieldTaskUpdatePayload(raw), clientOpId }
          : { kind, payload: parseFieldTaskEventPayload(raw), clientOpId }
      const cached = readFieldCache<FieldAgentTasksData>(FIELD_AGENT_TASKS_CACHE_KEY)
      if (!cached || status === "pending") return
      const taskId = operation.payload.taskId
      const remaining = db.getFirstSync<{ status: "pending" | "conflict" | "rejected" }>(
        `SELECT status FROM outbox_ops
         WHERE kind IN ('field.task.create','field.task.update','field.task.event')
           AND json_extract(payload, '$.taskId')=?
           AND status IN ('pending','conflict','rejected')
         ORDER BY CASE status WHEN 'conflict' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END
         LIMIT 1`,
        [taskId],
      )
      const reconciled = reconcileAgentTaskOperation(cached.value, operation, status, detail)
      const next = remaining
        ? {
            ...reconciled,
            tasks: reconciled.tasks.map((task) => task.id === taskId
              ? { ...task, syncState: remaining.status === "pending" ? "PENDING" as const : remaining.status === "conflict" ? "CONFLICT" as const : "REJECTED" as const }
              : task),
          }
        : reconciled
      writeFieldCache(
        FIELD_AGENT_TASKS_CACHE_KEY,
        next,
      )
    } catch {
      // Corrupt legacy task cache must not block the durable queue.
    }
    return
  }

  if (kind === "field.workday.event") {
    try {
      const payload = parseFieldWorkdayEventPayload(JSON.parse(rawPayload) as unknown)
      const cached = readFieldCache<Record<string, unknown>>("field.workday.current")
      if (!cached) return
      const detailRecord = unknownRecord(detail)
      const serverWorkday = unknownRecord(detailRecord?.workday)
      const serverEvent = unknownRecord(detailRecord?.event)
      const currentWorkday = unknownRecord(cached.value.workday)
      const base = serverWorkday ?? currentWorkday
      if (!base) return
      const currentEvents = Array.isArray(currentWorkday?.events) ? currentWorkday.events : []
      const events = serverEvent && !currentEvents.some((value) => unknownRecord(value)?.id === serverEvent.id)
        ? [...currentEvents.filter((value) => unknownRecord(value)?.clientEventId !== clientOpId), serverEvent]
        : currentEvents
      const syncState = status === "conflict" ? "CONFLICT" : status === "rejected" ? "REJECTED" : null
      const nextWorkday: Record<string, unknown> = {
        ...(currentWorkday ?? {}),
        ...base,
        events,
      }
      if (syncState) nextWorkday.syncState = syncState
      else delete nextWorkday.syncState
      const workdayStatus = String(nextWorkday.status ?? "")
      nextWorkday.availableActions = workdayStatus === "STARTED"
        ? ["PAUSE", "FINISH"]
        : workdayStatus === "PAUSED"
          ? ["RESUME", "FINISH"]
          : []
      writeFieldCache("field.workday.current", {
        ...cached.value,
        workday: nextWorkday,
        availableActions: nextWorkday.availableActions,
      })
    } catch {
      // A corrupt cache must never wedge the durable outbox.
    }
    return
  }

  if (kind === "field.location") {
    try {
      const payload = parseFieldLocationPayload(JSON.parse(rawPayload) as unknown)
      const cached = readFieldCache<Record<string, unknown>>("field.locations.current")
      if (!cached || !Array.isArray(cached.value.locations)) return
      const serverLocation = unknownRecord(unknownRecord(detail)?.location)
      const syncState = status === "conflict" ? "CONFLICT" : status === "rejected" ? "REJECTED" : null
      const locations = cached.value.locations.map((value) => {
        const location = unknownRecord(value)
        if (!location || location.clientLocationId !== payload.clientLocationId) return value
        if (status === "applied" && serverLocation) return serverLocation
        const next = { ...location }
        if (syncState) next.syncState = syncState
        else delete next.syncState
        return next
      })
      writeFieldCache("field.locations.current", { ...cached.value, locations })
    } catch {
      // A corrupt cache must never wedge the durable outbox.
    }
    return
  }

  if (kind === "field.message.send") {
    try {
      const payload = parseFieldMessageCreatePayload(JSON.parse(rawPayload) as unknown)
      const server = unknownRecord(detail)
      const syncState = status === "conflict" ? "CONFLICT" : status === "rejected" ? "REJECTED" : null
      const rows = db.getAllSync<{ k: string; json: string }>(
        "SELECT k, json FROM field_cache WHERE k LIKE 'field.messages.thread.%'",
      )
      for (const row of rows) {
        const cached = unknownRecord(JSON.parse(row.json) as unknown)
        const thread = unknownRecord(cached?.thread)
        if (!cached || !thread || !Array.isArray(thread.messages)) continue
        let changed = false
        const messages = thread.messages.map((rawMessage) => {
          const message = unknownRecord(rawMessage)
          if (!message || message.clientMessageId !== payload.clientMessageId) return rawMessage
          changed = true
          const next = { ...message, ...(status === "applied" && server ? server : {}) }
          if (status === "applied") delete next.syncState
          else if (syncState) next.syncState = syncState
          return next
        })
        if (changed) writeFieldCache(row.k, { ...cached, thread: { ...thread, messages } })
      }
      const inbox = readFieldMessages()
      writeFieldCache(FIELD_MESSAGES_CACHE_KEY, {
        ...inbox,
        threads: inbox.threads.map((thread) => {
          if (thread.lastMessage?.id !== payload.clientMessageId) return thread
          const lastMessage = { ...thread.lastMessage }
          if (status === "applied") delete lastMessage.syncState
          else if (syncState) lastMessage.syncState = syncState
          const next = { ...thread, lastMessage }
          if (status === "applied") delete next.syncState
          else if (syncState) next.syncState = syncState
          return next
        }),
      })
    } catch {
      // Messaging cache is a projection; the durable operation remains authoritative.
    }
    return
  }

  if (kind === "field.document.upload") {
    try {
      const payload = parseFieldDocumentUploadPayload(JSON.parse(rawPayload) as unknown)
      const serverDocument = unknownRecord(unknownRecord(detail)?.document)
      const syncState = status === "conflict" ? "CONFLICT" : status === "rejected" ? "REJECTED" : null
      const current = readFieldDocuments()
      writeFieldCache(FIELD_DOCUMENTS_CACHE_KEY, {
        ...current,
        documents: current.documents.map((document) => {
          if (document.clientDocumentId !== payload.clientDocumentId) return document
          const next: FieldDocument = {
            ...document,
            ...(status === "applied" && serverDocument ? serverDocument : {}),
            localUri: document.localUri,
          } as FieldDocument
          if (status === "applied") delete next.syncState
          else if (syncState) next.syncState = syncState
          return next
        }),
      })
    } catch {
      // Document bytes stay on-device for retry even if the projection is corrupt.
    }
    return
  }

  if (kind === "field.document.state") {
    try {
      const payload = parseFieldDocumentStatePayload(JSON.parse(rawPayload) as unknown)
      if (status === "applied") return
      const current = readFieldDocuments()
      writeFieldCache(FIELD_DOCUMENTS_CACHE_KEY, {
        ...current,
        documents: current.documents.map((document) => document.id !== payload.documentId ? document : {
          ...document,
          syncState: status === "conflict" ? "CONFLICT" as const : "REJECTED" as const,
        }),
      })
    } catch {
      // The state event itself remains recoverable in outbox.
    }
    return
  }

  if (kind === "field.hrm.create" || kind === "field.hrm.cancel") {
    try {
      const current = readFieldHrm()
      if (!current) return
      const server = unknownRecord(detail)
      const requestId = kind === "field.hrm.create"
        ? parseFieldHrmRequestCreatePayload(JSON.parse(rawPayload) as unknown).id
        : parseFieldHrmRequestCancelPayload(JSON.parse(rawPayload) as unknown).id
      const syncState = status === "conflict" ? "CONFLICT" : status === "rejected" ? "REJECTED" : null
      writeFieldCache(FIELD_HRM_CACHE_KEY, {
        ...current,
        requests: current.requests.map((request) => {
          if (request.id !== requestId) return request
          const next: FieldHrmRequest = {
            ...request,
            ...(status === "applied" && server ? server : {}),
          } as FieldHrmRequest
          if (status === "applied") delete next.syncState
          else if (syncState) next.syncState = syncState
          return next
        }),
      })
    } catch {
      // Keep durable HRM operation visible in recovery even if cache is stale.
    }
    return
  }

  if (
    kind === "field.route.create" ||
    kind === "field.route.update" ||
    kind === "field.route.publish" ||
    kind === "field.route.change-request"
  ) {
    try {
      const raw = JSON.parse(rawPayload) as unknown
      const routeId = kind === "field.route.create"
        ? parseFieldRouteCreatePayload(raw).localRouteId
        : kind === "field.route.update"
          ? parseFieldRouteUpdatePayload(raw).routeId
          : kind === "field.route.publish"
            ? parseFieldRoutePublishPayload(raw).routeId
            : parseFieldRouteChangeRequestPayload(raw).routeId
      const serverRouteId = stringValue(unknownRecord(detail)?.routeId)
      const rows = db.getAllSync<{ k: string; json: string }>("SELECT k, json FROM field_cache")
      for (const row of rows) {
        const cached = unknownRecord(JSON.parse(row.json) as unknown)
        if (!cached || !Array.isArray(cached.days)) continue
        let changed = false
        const days = cached.days.map((rawDay) => {
          const day = unknownRecord(rawDay)
          if (!day || !Array.isArray(day.routes)) return rawDay
          const routes = day.routes.map((rawRoute) => {
            const route = unknownRecord(rawRoute)
            if (!route || route.id !== routeId) return rawRoute
            changed = true
            const next = { ...route }
            if (status === "applied" && serverRouteId) next.id = serverRouteId
            if (status === "applied") delete next.syncState
            if (status === "applied" && kind === "field.route.publish") {
              next.persistedStatus = "PLANNED"
              next.effectiveStatus = "PLANNED"
              next.canEdit = false
              next.canPublish = false
              next.canExecute = true
            }
            if (status === "conflict") next.syncState = "CONFLICT"
            if (status === "rejected") next.syncState = "REJECTED"
            return next
          })
          return routes === day.routes ? rawDay : { ...day, routes }
        })
        if (!changed) continue
        db.runSync(
          "UPDATE field_cache SET json=?, updatedAt=? WHERE k=?",
          [JSON.stringify({ ...cached, days }), new Date().toISOString(), row.k],
        )
      }
    } catch {
      // A malformed legacy cache must not block the remaining sync queue.
    }
    return
  }
  if (
    kind === "field.visit.checkin" ||
    kind === "field.visit.action" ||
    kind === "field.visit.update" ||
    kind === "field.visit.photo"
  ) {
    try {
      const raw = JSON.parse(rawPayload) as unknown
      const visitId = kind === "field.visit.checkin"
        ? parseFieldVisitCheckInPayload(raw).visitId
        : kind === "field.visit.action"
          ? parseFieldVisitActionPayload(raw).visitId
          : kind === "field.visit.update"
            ? parseFieldVisitUpdatePayload(raw).visitId
            : parseFieldVisitPhotoPayload(raw).visitId
      const actionResultId = kind === "field.visit.action"
        ? parseFieldVisitActionPayload(raw).actionResultId
        : null
      const clientPhotoId = kind === "field.visit.photo"
        ? parseFieldVisitPhotoPayload(raw).clientPhotoId
        : null
      const serverPhoto = unknownRecord(unknownRecord(detail)?.photo)
      const syncState = status === "conflict"
        ? "CONFLICT"
        : status === "rejected"
          ? "REJECTED"
          : null
      const rows = db.getAllSync<{ k: string; json: string }>("SELECT k, json FROM field_cache")
      for (const row of rows) {
        const cached = unknownRecord(JSON.parse(row.json) as unknown)
        if (!cached) continue
        let changed = false
        let next: Record<string, unknown> = cached

        if (Array.isArray(cached.days)) {
          const days = cached.days.map((rawDay) => {
            const day = unknownRecord(rawDay)
            if (!day || !unknownRecord(day.visits) || !Array.isArray(unknownRecord(day.visits)?.items)) return rawDay
            const visits = unknownRecord(day.visits)!
            let dayChanged = false
            const items = (visits.items as unknown[]).map((rawVisit) => {
              const visit = unknownRecord(rawVisit)
              if (!visit || visit.id !== visitId) return rawVisit
              changed = true
              dayChanged = true
              const updated = { ...visit }
              if (syncState) updated.syncState = syncState
              else delete updated.syncState
              return updated
            })
            return dayChanged ? { ...day, visits: { ...visits, items } } : rawDay
          })
          if (changed) next = { ...next, days }
        }

        const workspaceVisit = unknownRecord(cached.visit)
        if (workspaceVisit?.id === visitId) {
          const updatedVisit = { ...workspaceVisit }
          if (kind !== "field.visit.photo") {
            if (syncState) updatedVisit.syncState = syncState
            else delete updatedVisit.syncState
          }
          if (actionResultId && Array.isArray(workspaceVisit.actionResults)) {
            updatedVisit.actionResults = workspaceVisit.actionResults.map((rawResult) => {
              const result = unknownRecord(rawResult)
              if (!result || result.id !== actionResultId) return rawResult
              const updatedResult = { ...result }
              if (syncState) updatedResult.syncState = syncState
              else delete updatedResult.syncState
              return updatedResult
            })
          }
          if (clientPhotoId && Array.isArray(workspaceVisit.photos)) {
            updatedVisit.photos = workspaceVisit.photos.map((rawPhoto) => {
              const photo = unknownRecord(rawPhoto)
              if (!photo || photo.id !== clientPhotoId) return rawPhoto
              if (status === "applied" && serverPhoto) return serverPhoto
              const updatedPhoto = { ...photo }
              if (syncState) updatedPhoto.syncState = syncState
              else delete updatedPhoto.syncState
              return updatedPhoto
            })
          }
          next = { ...next, visit: updatedVisit }
          changed = true
        }

        if (changed) {
          db.runSync(
            "UPDATE field_cache SET json=?, updatedAt=? WHERE k=?",
            [JSON.stringify(next), new Date().toISOString(), row.k],
          )
        }
      }
    } catch {
      // Legacy/corrupt cache must not wedge the durable execution queue.
    }
    return
  }
  if (kind !== "visit.checkin") return

  const payload = parseJsonObject(rawPayload)
  const tempVisitId = `local-${clientOpId}`
  const serverVisitId = stringValue(unknownRecord(detail)?.visitId)

  if (status === "rejected" || status === "conflict") {
    db.runSync("DELETE FROM visits WHERE id=?", [tempVisitId])
    return
  }

  if (!serverVisitId) return
  const now = new Date().toISOString()
  const anomalyFlags = unknownRecord(detail)?.anomalyFlags
  const anomalyJson = anomalyFlags == null ? null : JSON.stringify(anomalyFlags)
  const existingServerVisit = db.getFirstSync<{ id: string }>("SELECT id FROM visits WHERE id=?", [
    serverVisitId,
  ])
  if (existingServerVisit) {
    db.runSync("DELETE FROM visits WHERE id=?", [tempVisitId])
    return
  }

  const updated = db.runSync(
    `UPDATE visits
       SET id=?, anomalyFlags=COALESCE(?, anomalyFlags), updatedAt=?
     WHERE id=?`,
    [serverVisitId, anomalyJson, now, tempVisitId],
  )
  if (updated.changes > 0) return

  db.runSync(
    `INSERT INTO visits (
       id, agentId, storeId, routeStopId, status, checkInAt, checkOutAt, anomalyFlags, updatedAt
     ) VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      serverVisitId,
      stringValue(payload.agentId) ?? "",
      stringValue(payload.storeId) ?? "",
      stringValue(payload.routeStopId),
      "IN_PROGRESS",
      now,
      null,
      anomalyJson,
      now,
    ],
  )
}

/** Оптимистичное локальное обновление + постановка в outbox одной транзакцией. */
export function enqueueTaskStatus(input: {
  clientOpId: string
  taskId: string
  expectedStatus: MobileTaskStatus
  toStatus: MobileTaskStatus
}): void {
  db.withTransactionSync(() => {
    db.runSync("UPDATE tasks SET status=? WHERE id=?", [input.toStatus, input.taskId])
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [
        input.clientOpId,
        "task.status",
        JSON.stringify({
          taskId: input.taskId,
          expectedStatus: input.expectedStatus,
          toStatus: input.toStatus,
        }),
        new Date().toISOString(),
      ],
    )
  })
}

export function enqueuePhoto(input: {
  clientPhotoId: string
  clientOpId: string
  taskId: string
  fileUri: string
  expectedTaskStatus: MobileTaskStatus
  takenAt?: string
  mediaType?: "photo" | "video"
  durationMs?: number | null
  captureStepJson?: string | null
  exifJson?: string | null
  captureFlagsJson?: string | null
  captureTelemetryJson?: string | null
}): void {
  const takenAt = input.takenAt ?? new Date().toISOString()
  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO photo_queue (
         clientPhotoId, taskId, fileUri, takenAt, exifJson, mediaType, durationMs, captureStepJson,
         captureFlagsJson, captureTelemetryJson
       ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        input.clientPhotoId,
        input.taskId,
        input.fileUri,
        takenAt,
        input.exifJson ?? null,
        input.mediaType ?? "photo",
        input.durationMs ?? null,
        input.captureStepJson ?? null,
        input.captureFlagsJson ?? null,
        input.captureTelemetryJson ?? null,
      ],
    )
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [
        input.clientOpId,
        "photo.submit",
        JSON.stringify({
          clientPhotoId: input.clientPhotoId,
          taskId: input.taskId,
          expectedTaskStatus: input.expectedTaskStatus,
        }),
        takenAt,
      ],
    )
    db.runSync("UPDATE tasks SET status='PHOTO_SUBMITTED' WHERE id=?", [input.taskId])
  })
}

/** Шаг сценария невозможен: причина уходит через outbox (docs/24). */
export function enqueueProofException(
  input: MobileProofExceptionPayload & { clientOpId: string },
): void {
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [
      input.clientOpId,
      "proof.exception",
      JSON.stringify({
        taskId: input.taskId,
        stepId: input.stepId,
        stepKind: input.stepKind ?? null,
        reason: input.reason,
        note: input.note ?? undefined,
      }),
      new Date().toISOString(),
    ],
  )
}

export interface TaskCaptureExceptionRow {
  stepId: string
  reason: string
  note: string | null
  status: "pending" | "applied" | "conflict" | "rejected"
}

/** Исключения по шагам задачи — из локального outbox (переживает офлайн). */
export function listTaskCaptureExceptions(taskId: string): TaskCaptureExceptionRow[] {
  const rows = db.getAllSync<{ payload: string; status: string }>(
    `SELECT payload, status FROM outbox_ops
     WHERE kind='proof.exception' AND json_extract(payload, '$.taskId') = ?
     ORDER BY clientCreatedAt`,
    [taskId],
  )
  return rows.flatMap((row) => {
    const payload = parseJsonOrNull<Record<string, unknown>>(row.payload)
    const stepId = typeof payload?.stepId === "string" ? payload.stepId : null
    if (!stepId) return []
    return [
      {
        stepId,
        reason: typeof payload?.reason === "string" ? payload.reason : "other",
        note: typeof payload?.note === "string" ? payload.note : null,
        status: (row.status as TaskCaptureExceptionRow["status"]) ?? "pending",
      },
    ]
  })
}

export function enqueueTaskComment(input: {
  clientOpId: string
  taskId: string
  body: string
}): void {
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [
      input.clientOpId,
      "task.comment",
      JSON.stringify({ taskId: input.taskId, body: input.body.trim() }),
      new Date().toISOString(),
    ],
  )
}

export function enqueueVisitCheckIn(input: {
  clientOpId: string
  agentId: string
  storeId: string
  routeStopId?: string | null
  latitude: number
  longitude: number
}): void {
  const now = new Date().toISOString()
  db.withTransactionSync(() => {
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [
        input.clientOpId,
        "visit.checkin",
        JSON.stringify({
          agentId: input.agentId,
          storeId: input.storeId,
          routeStopId: input.routeStopId ?? null,
          latitude: input.latitude,
          longitude: input.longitude,
        }),
        now,
      ],
    )
    db.runSync(
      `INSERT INTO visits (
         id, agentId, storeId, routeStopId, status, checkInAt, checkOutAt, anomalyFlags, updatedAt
       ) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET status='IN_PROGRESS', updatedAt=excluded.updatedAt`,
      [
        `local-${input.clientOpId}`,
        input.agentId,
        input.storeId,
        input.routeStopId ?? null,
        "IN_PROGRESS",
        now,
        null,
        null,
        now,
      ],
    )
  })
}

export function enqueueVisitCheckOut(input: { clientOpId: string; visitId: string }): void {
  const now = new Date().toISOString()
  db.withTransactionSync(() => {
    db.runSync("UPDATE visits SET status='COMPLETED', checkOutAt=?, updatedAt=? WHERE id=?", [
      now,
      now,
      input.visitId,
    ])
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [input.clientOpId, "visit.checkout", JSON.stringify({ visitId: input.visitId }), now],
    )
  })
}

export interface QueuedOrderRow {
  clientOpId: string
  status: "pending" | "applied" | "conflict" | "rejected"
  clientCreatedAt: string
  storeId: string
  visitId: string | null
  lineCount: number
  unitCount: number
  lines: QueuedOrderLine[]
  detailCode: string | null
  serverOrderId: string | null
}

/** Заказы из локальной очереди (order.create) для вкладки «Заказы». */
export function listQueuedOrders(): QueuedOrderRow[] {
  const rows = db.getAllSync<{
    clientOpId: string
    status: string
    clientCreatedAt: string
    payload: string
    detail: string | null
  }>("SELECT clientOpId, status, clientCreatedAt, payload, detail FROM outbox_ops WHERE kind='order.create' ORDER BY clientCreatedAt DESC")
  return rows.map((row) => {
    const payload = parseQueuedOrderPayload(row.payload)
    return {
      clientOpId: row.clientOpId,
      status: (row.status as QueuedOrderRow["status"]) ?? "pending",
      clientCreatedAt: row.clientCreatedAt,
      storeId: payload.storeId,
      visitId: payload.visitId,
      lineCount: payload.lines.length,
      unitCount: payload.unitCount,
      lines: payload.lines,
      detailCode: parseQueuedOrderDetailCode(row.detail),
      serverOrderId: parseQueuedOrderServerId(row.detail),
    }
  })
}

export function enqueueOrderCreate(input: OrderCreateRequest & { clientOpId: string }): void {
  const payload = orderCreateRequestSchema.parse({
    storeId: input.storeId,
    visitId: input.visitId ?? null,
    lines: input.lines,
  })
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [
      input.clientOpId,
      "order.create",
      JSON.stringify(payload),
      new Date().toISOString(),
    ],
  )
}

export type CommercialOperationKind =
  | "promotion.enroll"
  | "promotion.submit"
  | "inventory.record"
  | "return.create"
  | "reward.claim"

type CommercialPushOperation = Extract<MobilePushOperation, { kind: CommercialOperationKind }>

type WithLocalOperationState<T> = T extends CommercialPushOperation
  ? Omit<T, "clientCreatedAt"> & {
  clientCreatedAt: string
  status: "pending" | "applied" | "conflict" | "rejected"
  attempts: number
  detailCode: string | null
  detail: unknown
    }
  : never

export type LocalCommercialOperation = WithLocalOperationState<CommercialPushOperation>

function detailCode(raw: string | null): { code: string | null; detail: unknown } {
  if (!raw) return { code: null, detail: null }
  try {
    const detail = JSON.parse(raw) as unknown
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) return { code: null, detail }
    const code = (detail as Record<string, unknown>).code
    return { code: typeof code === "string" ? code : null, detail }
  } catch {
    return { code: null, detail: raw }
  }
}

export function listCommercialOperations(): LocalCommercialOperation[] {
  const rows = db.getAllSync<{
    clientOpId: string
    kind: CommercialOperationKind
    payload: string
    clientCreatedAt: string
    status: LocalCommercialOperation["status"]
    attempts: number
    detail: string | null
  }>(`SELECT clientOpId, kind, payload, clientCreatedAt, status, attempts, detail
      FROM outbox_ops
      WHERE kind IN ('promotion.enroll','promotion.submit','inventory.record','return.create','reward.claim')
      ORDER BY clientCreatedAt DESC`)
  return rows.flatMap((row): LocalCommercialOperation[] => {
    const rawPayload = parseJsonOrNull<unknown>(row.payload)
    if (rawPayload == null) return []
    const result = detailCode(row.detail)
    const state = {
      clientOpId: row.clientOpId,
      clientCreatedAt: row.clientCreatedAt,
      status: row.status,
      attempts: row.attempts,
      detailCode: result.code,
      detail: result.detail,
    }
    switch (row.kind) {
      case "promotion.enroll": {
        const parsed = mobilePromotionEnrollPayloadSchema.safeParse(rawPayload)
        return parsed.success ? [{ ...state, kind: row.kind, payload: parsed.data }] : []
      }
      case "promotion.submit": {
        const parsed = mobilePromotionSubmitPayloadSchema.safeParse(rawPayload)
        return parsed.success ? [{ ...state, kind: row.kind, payload: parsed.data }] : []
      }
      case "inventory.record": {
        const parsed = mobilePromoInventoryRecordPayloadSchema.safeParse(rawPayload)
        return parsed.success ? [{ ...state, kind: row.kind, payload: parsed.data }] : []
      }
      case "return.create": {
        const parsed = mobileSalesReturnCreatePayloadSchema.safeParse(rawPayload)
        return parsed.success ? [{ ...state, kind: row.kind, payload: parsed.data }] : []
      }
      case "reward.claim": {
        const parsed = mobileRewardClaimPayloadSchema.safeParse(rawPayload)
        return parsed.success ? [{ ...state, kind: row.kind, payload: parsed.data }] : []
      }
    }
  })
}

export function readCommercialSnapshot(): { value: MobileCommercialSnapshot; updatedAt: string } | null {
  const cached = readFieldCache<unknown>(COMMERCIAL_CACHE_KEY)
  if (!cached) return null
  const parsed = mobileCommercialSnapshotSchema.safeParse(cached.value)
  if (!parsed.success) return null
  return { value: parsed.data, updatedAt: cached.updatedAt }
}

function enqueueCommercial(
  kind: CommercialOperationKind,
  payload: MobilePushOperation["payload"],
  media?: CommercialMediaAttachment,
): { clientOpId: string; clientCreatedAt: string } {
  const clientOpId = `op-${Crypto.randomUUID()}`
  const clientCreatedAt = new Date().toISOString()
  db.withTransactionSync(() => {
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [clientOpId, kind, JSON.stringify(payload), clientCreatedAt],
    )
    if (media) {
      db.runSync(
        `INSERT INTO commercial_media_queue
          (clientMediaId, clientOpId, purpose, fileUri, takenAt)
         VALUES (?,?,?,?,?)`,
        [media.clientMediaId, clientOpId, media.purpose, media.fileUri, media.takenAt],
      )
    }
  })
  return { clientOpId, clientCreatedAt }
}

export interface CommercialMediaAttachment {
  clientMediaId: string
  purpose: MobileCommercialMediaPurpose
  fileUri: string
  takenAt: string
}

export function enqueuePromotionEnroll(
  input: Omit<MobilePromotionEnrollPayload, "clientExecutionId"> & { clientExecutionId?: string },
): { clientOpId: string; clientExecutionId: string } {
  const clientExecutionId = input.clientExecutionId ?? `promotion-${Crypto.randomUUID()}`
  const payload = mobilePromotionEnrollPayloadSchema.parse({ ...input, clientExecutionId })
  return { ...enqueueCommercial("promotion.enroll", payload), clientExecutionId }
}

export function enqueuePromotionSubmit(
  input: MobilePromotionSubmitPayload,
  media?: CommercialMediaAttachment,
) {
  if (media && media.purpose !== "PROMOTION_PROOF") throw new Error("Promotion proof purpose mismatch")
  return enqueueCommercial("promotion.submit", mobilePromotionSubmitPayloadSchema.parse(input), media)
}

export function enqueuePromoInventoryRecord(input: MobilePromoInventoryRecordPayload) {
  return enqueueCommercial("inventory.record", mobilePromoInventoryRecordPayloadSchema.parse(input))
}

export function enqueueSalesReturn(
  input: MobileSalesReturnCreatePayload,
  media?: CommercialMediaAttachment,
) {
  if (media && media.purpose !== "RETURN_EVIDENCE") throw new Error("Return evidence purpose mismatch")
  return enqueueCommercial("return.create", mobileSalesReturnCreatePayloadSchema.parse(input), media)
}

export function enqueueRewardClaim(input: MobileRewardClaimPayload) {
  return enqueueCommercial("reward.claim", mobileRewardClaimPayloadSchema.parse(input))
}

export function enqueueFieldRouteCreate(
  input: Omit<FieldRouteCreatePayload, "localRouteId">,
): { clientOpId: string; localRouteId: string } {
  const clientOpId = `field-route-${Crypto.randomUUID()}`
  const localRouteId = `local-route-${Crypto.randomUUID()}`
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [
      clientOpId,
      "field.route.create",
      JSON.stringify({ ...input, localRouteId }),
      new Date().toISOString(),
    ],
  )
  return { clientOpId, localRouteId }
}

export function enqueueFieldRouteUpdate(input: FieldRouteUpdatePayload): { clientOpId: string } {
  if (input.routeId.startsWith("local-route-")) {
    const queuedCreate = db.getFirstSync<{ clientOpId: string; payload: string }>(
      `SELECT clientOpId, payload FROM outbox_ops
       WHERE kind='field.route.create'
         AND status='pending'
         AND json_extract(payload, '$.localRouteId')=?
       ORDER BY clientCreatedAt DESC LIMIT 1`,
      [input.routeId],
    )
    if (queuedCreate) {
      const createPayload = parseFieldRouteCreatePayload(JSON.parse(queuedCreate.payload) as unknown)
      db.runSync("UPDATE outbox_ops SET payload=? WHERE clientOpId=?", [
        JSON.stringify({
          ...createPayload,
          name: input.name ?? null,
          notes: input.notes ?? null,
          points: input.points,
        }),
        queuedCreate.clientOpId,
      ])
      return { clientOpId: queuedCreate.clientOpId }
    }
  }

  const clientOpId = `field-route-${Crypto.randomUUID()}`
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [clientOpId, "field.route.update", JSON.stringify(input), new Date().toISOString()],
  )
  return { clientOpId }
}

export function enqueueFieldRoutePublish(routeId: string): { clientOpId: string } {
  const clientOpId = `field-route-${Crypto.randomUUID()}`
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [clientOpId, "field.route.publish", JSON.stringify({ routeId }), new Date().toISOString()],
  )
  return { clientOpId }
}

export function enqueueFieldRouteChangeRequest(
  input: FieldRouteChangeRequestPayload,
): { clientOpId: string } {
  const clientOpId = `field-route-${Crypto.randomUUID()}`
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [clientOpId, "field.route.change-request", JSON.stringify(input), new Date().toISOString()],
  )
  return { clientOpId }
}

function agentTaskCache(): FieldAgentTasksData {
  return readFieldCache<FieldAgentTasksData>(FIELD_AGENT_TASKS_CACHE_KEY)?.value ?? {
    tasks: [],
    capabilities: { createSelfTask: true, recurringTasks: true },
  }
}

export function enqueueFieldTaskCreate(
  input: Omit<FieldTaskCreatePayload, "taskId">,
  customer?: FieldTaskCustomerPreview | null,
): { clientOpId: string; taskId: string } {
  const taskId = `field-task-${Crypto.randomUUID()}`
  const clientOpId = `field-task-op-${Crypto.randomUUID()}`
  const occurredAt = new Date().toISOString()
  const payload = parseFieldTaskCreatePayload({ ...input, taskId })
  db.withTransactionSync(() => {
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [clientOpId, "field.task.create", JSON.stringify(payload), occurredAt],
    )
    writeFieldCache(
      FIELD_AGENT_TASKS_CACHE_KEY,
      addOptimisticAgentTask(agentTaskCache(), payload, { clientOpId, occurredAt, customer }),
    )
  })
  return { clientOpId, taskId }
}

export function enqueueFieldTaskUpdate(
  input: FieldTaskUpdatePayload,
): { clientOpId: string } {
  const payload = parseFieldTaskUpdatePayload(input)
  const clientOpId = `field-task-op-${Crypto.randomUUID()}`
  const occurredAt = new Date().toISOString()
  db.withTransactionSync(() => {
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [clientOpId, "field.task.update", JSON.stringify(payload), occurredAt],
    )
    writeFieldCache(
      FIELD_AGENT_TASKS_CACHE_KEY,
      updateOptimisticAgentTask(agentTaskCache(), payload, { clientOpId, occurredAt }),
    )
  })
  return { clientOpId }
}

export function enqueueFieldTaskEvent(
  input: FieldTaskEventPayload,
): { clientOpId: string } {
  const payload = parseFieldTaskEventPayload(input)
  const clientOpId = `field-task-op-${Crypto.randomUUID()}`
  db.withTransactionSync(() => {
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [clientOpId, "field.task.event", JSON.stringify(payload), payload.occurredAt],
    )
    writeFieldCache(
      FIELD_AGENT_TASKS_CACHE_KEY,
      appendOptimisticAgentTaskEvent(agentTaskCache(), payload, clientOpId),
    )
  })
  return { clientOpId }
}

export function enqueueFieldVisitCheckIn(
  input: FieldVisitCheckInPayload,
): { clientOpId: string } {
  const clientOpId = `field-visit-${Crypto.randomUUID()}`
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [clientOpId, "field.visit.checkin", JSON.stringify(input), input.checkInAt],
  )
  return { clientOpId }
}

export function enqueueFieldVisitAction(
  input: FieldVisitActionPayload,
): { clientOpId: string } {
  const clientOpId = `field-visit-${Crypto.randomUUID()}`
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [clientOpId, "field.visit.action", JSON.stringify(input), input.completedAt],
  )
  return { clientOpId }
}

export function enqueueFieldVisitUpdate(
  input: FieldVisitUpdatePayload,
): { clientOpId: string } {
  const clientOpId = `field-visit-${Crypto.randomUUID()}`
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [clientOpId, "field.visit.update", JSON.stringify(input), input.checkOutAt ?? new Date().toISOString()],
  )
  return { clientOpId }
}

export function enqueueFieldVisitPhoto(
  input: FieldVisitPhotoPayload,
): { clientOpId: string } {
  const clientOpId = `field-photo-${Crypto.randomUUID()}`
  insertFieldVisitPhotoOutbox(input, clientOpId)
  return { clientOpId }
}

function insertFieldVisitPhotoOutbox(input: FieldVisitPhotoPayload, clientOpId: string): void {
  const payload = parseFieldVisitPhotoPayload(input)
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [clientOpId, "field.visit.photo", JSON.stringify(payload), payload.takenAt],
  )
}

function fieldCommitmentOperations(): FieldCommitmentProjectionOperation[] {
  const rows = db.getAllSync<{
    clientOpId: string
    kind: "field.commitment.create" | "field.commitment.fulfill"
    payload: string
    clientCreatedAt: string | null
    status: "pending" | "applied" | "conflict" | "rejected"
    detail: string | null
  }>(
    `SELECT clientOpId, kind, payload, clientCreatedAt, status, detail
     FROM outbox_ops
     WHERE kind IN ('field.commitment.create','field.commitment.fulfill')
     ORDER BY clientCreatedAt, rowid`,
  )
  return rows.flatMap((row): FieldCommitmentProjectionOperation[] => {
    try {
      const rawPayload = JSON.parse(row.payload) as unknown
      const base = {
        clientOpId: row.clientOpId,
        clientCreatedAt: row.clientCreatedAt ?? new Date(0).toISOString(),
        status: row.status,
        detail: row.detail ? JSON.parse(row.detail) as unknown : null,
      }
      return row.kind === "field.commitment.create"
        ? [{ ...base, kind: row.kind, payload: parseFieldCommitmentCreatePayload(rawPayload) }]
        : [{ ...base, kind: row.kind, payload: parseFieldCommitmentFulfillPayload(rawPayload) }]
    } catch {
      return []
    }
  })
}

export function readFieldCommitments(): FieldCommitmentsData {
  const cached = readFieldCache<FieldCommitmentsData>(FIELD_COMMITMENTS_CACHE_KEY)?.value ?? null
  return projectFieldCommitments(cached, fieldCommitmentOperations())
}

export function enqueueFieldCommitmentCreate(
  input: Omit<FieldCommitmentCreatePayload, "clientCommitmentId" | "evidenceClientPhotoId">,
  photo?: FieldVisitPhotoPayload | null,
): { clientOpId: string; clientCommitmentId: string; photoClientOpId: string | null } {
  if (photo && (photo.visitId !== input.visitId || photo.category !== "commitment-promise")) {
    throw new Error("Commitment promise photo must belong to the active visit")
  }
  const clientCommitmentId = `commitment-${Crypto.randomUUID()}`
  const clientOpId = `field-commitment-${Crypto.randomUUID()}`
  const photoClientOpId = photo ? `field-photo-${Crypto.randomUUID()}` : null
  const occurredAt = new Date().toISOString()
  const payload = parseFieldCommitmentCreatePayload({
    ...input,
    clientCommitmentId,
    evidenceClientPhotoId: photo?.clientPhotoId ?? null,
  })
  db.withTransactionSync(() => {
    if (photo && photoClientOpId) insertFieldVisitPhotoOutbox(photo, photoClientOpId)
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [clientOpId, "field.commitment.create", JSON.stringify(payload), occurredAt],
    )
  })
  return { clientOpId, clientCommitmentId, photoClientOpId }
}

export function enqueueFieldCommitmentFulfill(
  input: Omit<FieldCommitmentFulfillPayload, "clientFulfillmentId" | "evidenceClientPhotoId">,
  photo?: FieldVisitPhotoPayload | null,
): { clientOpId: string; clientFulfillmentId: string; photoClientOpId: string | null } {
  if (photo?.category !== "commitment-fulfillment") {
    if (photo) throw new Error("Commitment fact photo must use the fulfillment category")
  }
  const clientFulfillmentId = `fulfillment-${Crypto.randomUUID()}`
  const clientOpId = `field-commitment-${Crypto.randomUUID()}`
  const photoClientOpId = photo ? `field-photo-${Crypto.randomUUID()}` : null
  const occurredAt = new Date().toISOString()
  const payload = parseFieldCommitmentFulfillPayload({
    ...input,
    clientFulfillmentId,
    evidenceClientPhotoId: photo?.clientPhotoId ?? null,
  })
  db.withTransactionSync(() => {
    if (photo && photoClientOpId) insertFieldVisitPhotoOutbox(photo, photoClientOpId)
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [clientOpId, "field.commitment.fulfill", JSON.stringify(payload), occurredAt],
    )
  })
  return { clientOpId, clientFulfillmentId, photoClientOpId }
}

export type FieldDocumentDraft = Omit<
  FieldDocumentUploadPayload,
  "clientDocumentId" | "createdAt"
>

function agentIdentity(): { id: string | null; name: string } {
  const profile = readFieldCache<Record<string, unknown>>("field.profile")?.value
  const agent = unknownRecord(profile?.agent)
  return { id: stringValue(agent?.id), name: stringValue(agent?.name) ?? "Вы" }
}

function createDocumentUploadPayload(
  input: FieldDocumentDraft,
  createdAt = new Date().toISOString(),
): FieldDocumentUploadPayload {
  return parseFieldDocumentUploadPayload({
    ...input,
    clientDocumentId: `document-${Crypto.randomUUID()}`,
    createdAt,
  })
}

function insertDocumentUpload(payload: FieldDocumentUploadPayload, clientOpId: string): void {
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [clientOpId, "field.document.upload", JSON.stringify(payload), payload.createdAt],
  )
}

function optimisticDocument(payload: FieldDocumentUploadPayload): FieldDocument {
  const identity = agentIdentity()
  return {
    id: payload.clientDocumentId,
    clientDocumentId: payload.clientDocumentId,
    title: payload.title,
    fileName: payload.fileName,
    mimeType: payload.mimeType,
    sizeBytes: payload.sizeBytes,
    checksumSha256: null,
    uploadedByAgentId: identity.id,
    visitId: payload.visitId,
    taskId: payload.taskId,
    createdAt: payload.createdAt,
    assignment: {
      id: `local-assignment-${payload.clientDocumentId}`,
      required: false,
      assignedAt: payload.createdAt,
      expiresAt: null,
      readAt: payload.createdAt,
      downloadedAt: payload.createdAt,
    },
    expired: false,
    downloadUrl: "",
    localUri: payload.fileUri,
    syncState: "PENDING",
  }
}

function addOptimisticDocument(payload: FieldDocumentUploadPayload): void {
  const current = readFieldDocuments()
  if (current.documents.some((document) => document.clientDocumentId === payload.clientDocumentId)) return
  writeFieldCache(FIELD_DOCUMENTS_CACHE_KEY, {
    ...current,
    documents: [optimisticDocument(payload), ...current.documents],
  })
}

export function enqueueFieldDocumentUpload(input: FieldDocumentDraft): {
  clientOpId: string
  clientDocumentId: string
} {
  const payload = createDocumentUploadPayload(input)
  const clientOpId = `field-document-${Crypto.randomUUID()}`
  db.withTransactionSync(() => {
    insertDocumentUpload(payload, clientOpId)
    addOptimisticDocument(payload)
  })
  return { clientOpId, clientDocumentId: payload.clientDocumentId }
}

export function enqueueFieldMessage(
  input: {
    threadId: string | null
    recipientAgentId: string | null
    body: string | null
  },
  attachment?: FieldDocumentDraft | null,
): {
  clientOpId: string
  clientMessageId: string
  attachmentClientDocumentId: string | null
} {
  const sentAt = new Date().toISOString()
  const attachmentPayload = attachment ? createDocumentUploadPayload(attachment, sentAt) : null
  const attachmentClientOpId = attachmentPayload ? `field-document-${Crypto.randomUUID()}` : null
  const clientMessageId = `message-${Crypto.randomUUID()}`
  const clientOpId = `field-message-${Crypto.randomUUID()}`
  const payload = parseFieldMessageCreatePayload({
    ...input,
    clientMessageId,
    body: input.body?.trim() || null,
    attachmentClientDocumentId: attachmentPayload?.clientDocumentId ?? null,
    sentAt,
  })
  const identity = agentIdentity()
  const attachmentDocument = attachmentPayload ? {
    id: attachmentPayload.clientDocumentId,
    title: attachmentPayload.title,
    fileName: attachmentPayload.fileName,
    mimeType: attachmentPayload.mimeType,
    sizeBytes: attachmentPayload.sizeBytes,
    checksumSha256: null,
    downloadUrl: "",
    localUri: attachmentPayload.fileUri,
  } : null
  const optimisticMessage: FieldMessage = {
    id: clientMessageId,
    senderAgentId: identity.id,
    senderUserId: null,
    senderName: identity.name,
    clientMessageId,
    body: payload.body,
    sentAt,
    acknowledgementRequired: false,
    attachmentDocument,
    read: true,
    acknowledged: false,
    receipts: [],
    syncState: "PENDING",
  }

  db.withTransactionSync(() => {
    if (attachmentPayload && attachmentClientOpId) {
      insertDocumentUpload(attachmentPayload, attachmentClientOpId)
      addOptimisticDocument(attachmentPayload)
    }
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [clientOpId, "field.message.send", JSON.stringify(payload), sentAt],
    )

    if (payload.threadId) {
      const cachedThread = readFieldMessageThread(payload.threadId)
      if (cachedThread) {
        writeFieldCache(fieldMessageThreadCacheKey(payload.threadId), {
          ...cachedThread,
          thread: {
            ...cachedThread.thread,
            lastMessageAt: sentAt,
            messages: [...cachedThread.thread.messages, optimisticMessage],
          },
        })
      }
    }

    const inbox = readFieldMessages()
    const existing = payload.threadId
      ? inbox.threads.find((thread) => thread.id === payload.threadId)
      : null
    const recipient = payload.recipientAgentId
      ? inbox.availableRecipients.find((person) => person.id === payload.recipientAgentId)
      : null
    const { clientMessageId: _clientMessageId, read: _read, receipts: _receipts, ...summaryMessage } = optimisticMessage
    const threadId = payload.threadId ?? `local-direct-${payload.recipientAgentId}`
    const summary = {
      id: threadId,
      type: "DIRECT" as const,
      subject: existing?.subject ?? null,
      title: existing?.title ?? recipient?.name ?? "Новый диалог",
      lastMessageAt: sentAt,
      participants: existing?.participants ?? (recipient ? [recipient] : []),
      lastMessage: summaryMessage,
      unread: false,
      needsAcknowledgement: false,
      syncState: "PENDING" as const,
    }
    writeFieldCache(FIELD_MESSAGES_CACHE_KEY, {
      ...inbox,
      threads: [summary, ...inbox.threads.filter((thread) => thread.id !== threadId && thread.id !== payload.threadId)],
    })
  })
  return { clientOpId, clientMessageId, attachmentClientDocumentId: attachmentPayload?.clientDocumentId ?? null }
}

export function enqueueFieldMessageReceipt(input: {
  threadId: string
  messageId: string
  type: "READ" | "ACKNOWLEDGED"
}): { clientOpId: string; clientReceiptId: string } {
  const occurredAt = new Date().toISOString()
  const clientReceiptId = `receipt-${Crypto.randomUUID()}`
  const clientOpId = `field-receipt-${Crypto.randomUUID()}`
  const payload = parseFieldMessageReceiptPayload({ ...input, clientReceiptId, occurredAt })
  db.withTransactionSync(() => {
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [clientOpId, "field.message.receipt", JSON.stringify(payload), occurredAt],
    )
    const cachedThread = readFieldMessageThread(input.threadId)
    if (cachedThread) {
      writeFieldCache(fieldMessageThreadCacheKey(input.threadId), {
        ...cachedThread,
        thread: {
          ...cachedThread.thread,
          messages: cachedThread.thread.messages.map((message) => message.id !== input.messageId ? message : {
            ...message,
            read: input.type === "READ" ? true : message.read,
            acknowledged: input.type === "ACKNOWLEDGED" ? true : message.acknowledged,
          }),
        },
      })
    }
    const inbox = readFieldMessages()
    writeFieldCache(FIELD_MESSAGES_CACHE_KEY, {
      ...inbox,
      unread: input.type === "READ" ? Math.max(0, inbox.unread - 1) : inbox.unread,
      threads: inbox.threads.map((thread) => thread.id !== input.threadId ? thread : {
        ...thread,
        unread: input.type === "READ" ? false : thread.unread,
        needsAcknowledgement: input.type === "ACKNOWLEDGED" ? false : thread.needsAcknowledgement,
        lastMessage: thread.lastMessage?.id === input.messageId
          ? { ...thread.lastMessage, acknowledged: input.type === "ACKNOWLEDGED" ? true : thread.lastMessage.acknowledged }
          : thread.lastMessage,
      }),
    })
  })
  return { clientOpId, clientReceiptId }
}

export function enqueueFieldDocumentState(
  documentId: string,
  state: "READ" | "DOWNLOADED",
): { clientOpId: string } {
  const occurredAt = new Date().toISOString()
  const payload = parseFieldDocumentStatePayload({ documentId, state, occurredAt })
  const clientOpId = `field-document-state-${Crypto.randomUUID()}`
  db.withTransactionSync(() => {
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [clientOpId, "field.document.state", JSON.stringify(payload), occurredAt],
    )
    const current = readFieldDocuments()
    writeFieldCache(FIELD_DOCUMENTS_CACHE_KEY, {
      ...current,
      documents: current.documents.map((document) => document.id !== documentId ? document : {
        ...document,
        assignment: {
          ...document.assignment,
          ...(state === "READ" ? { readAt: occurredAt } : { downloadedAt: occurredAt }),
        },
      }),
    })
  })
  return { clientOpId }
}

export function enqueueFieldHrmRequest(
  input: Omit<FieldHrmRequestCreatePayload, "id" | "clientRequestId" | "submittedAt">,
): { clientOpId: string; requestId: string; clientRequestId: string } {
  const submittedAt = new Date().toISOString()
  const requestId = `hrm-${Crypto.randomUUID()}`
  const clientRequestId = `hrm-client-${Crypto.randomUUID()}`
  const clientOpId = `field-hrm-${Crypto.randomUUID()}`
  const payload = parseFieldHrmRequestCreatePayload({
    ...input,
    id: requestId,
    clientRequestId,
    submittedAt,
  })
  db.withTransactionSync(() => {
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [clientOpId, "field.hrm.create", JSON.stringify(payload), submittedAt],
    )
    const current = readFieldHrm()
    if (current) {
      const optimistic: FieldHrmRequest = {
        ...payload,
        status: "PENDING",
        startDate: `${payload.startDate}T00:00:00.000Z`,
        endDate: `${payload.endDate}T00:00:00.000Z`,
        decisionNote: null,
        decidedAt: null,
        cancelledAt: null,
        updatedAt: submittedAt,
        syncState: "PENDING",
      }
      writeFieldCache(FIELD_HRM_CACHE_KEY, {
        ...current,
        requests: [optimistic, ...current.requests],
        days: current.days.map((day) => (
          day.date >= payload.startDate && day.date <= payload.endDate
            ? { ...day, requests: [...day.requests, { id: requestId, type: payload.type, status: "PENDING" as const }] }
            : day
        )),
      })
    }
  })
  return { clientOpId, requestId, clientRequestId }
}

export function enqueueFieldHrmCancel(requestId: string): { clientOpId: string } {
  const cancelledAt = new Date().toISOString()
  const payload = parseFieldHrmRequestCancelPayload({ id: requestId, cancelledAt })
  const clientOpId = `field-hrm-${Crypto.randomUUID()}`
  db.withTransactionSync(() => {
    db.runSync(
      "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
      [clientOpId, "field.hrm.cancel", JSON.stringify(payload), cancelledAt],
    )
    const current = readFieldHrm()
    if (current) {
      writeFieldCache(FIELD_HRM_CACHE_KEY, {
        ...current,
        requests: current.requests.map((request) => request.id !== requestId ? request : {
          ...request,
          status: "CANCELLED" as const,
          cancelledAt,
          updatedAt: cancelledAt,
          syncState: "PENDING" as const,
        }),
        days: current.days.map((day) => ({
          ...day,
          requests: day.requests.map((request) => request.id !== requestId ? request : {
            ...request,
            status: "CANCELLED" as const,
          }),
        })),
      })
    }
  })
  return { clientOpId }
}

export function enqueueFieldWorkdayEvent(
  input: FieldWorkdayEventPayload,
): { clientOpId: string } {
  const payload = parseFieldWorkdayEventPayload(input)
  const clientOpId = `field-workday-${Crypto.randomUUID()}`
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [clientOpId, "field.workday.event", JSON.stringify(payload), payload.occurredAt],
  )
  return { clientOpId }
}

export function enqueueFieldLocation(
  input: FieldLocationPayload,
): { clientOpId: string } {
  const payload = parseFieldLocationPayload(input)
  const existing = db.getFirstSync<{ clientOpId: string }>(
    `SELECT clientOpId FROM outbox_ops
     WHERE kind='field.location'
       AND json_extract(payload, '$.clientLocationId')=?
     ORDER BY clientCreatedAt DESC LIMIT 1`,
    [payload.clientLocationId],
  )
  if (existing) return existing
  const clientOpId = `field-location-${Crypto.randomUUID()}`
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [clientOpId, "field.location", JSON.stringify(payload), payload.recordedAt],
  )
  const cached = readFieldCache<Record<string, unknown>>("field.locations.current")
  if (cached && Array.isArray(cached.value.locations)) {
    const alreadyCached = cached.value.locations.some(
      (value) => unknownRecord(value)?.clientLocationId === payload.clientLocationId,
    )
    if (!alreadyCached) {
      writeFieldCache("field.locations.current", {
        ...cached.value,
        locations: [...cached.value.locations, {
          id: payload.clientLocationId,
          ...payload,
          isMoving: (payload.speed ?? 0) > 1,
          syncState: "PENDING",
        }],
      })
    }
  }
  return { clientOpId }
}

export function fieldOutboxResult(clientOpId: string): {
  status: "pending" | "applied" | "conflict" | "rejected"
  detail: unknown
} | null {
  const row = db.getFirstSync<{ status: string; detail: string | null }>(
    "SELECT status, detail FROM outbox_ops WHERE clientOpId=?",
    [clientOpId],
  )
  if (!row) return null
  return {
    status: row.status as "pending" | "applied" | "conflict" | "rejected",
    detail: row.detail ? JSON.parse(row.detail) as unknown : null,
  }
}

export interface FieldSyncRecoveryEvidence {
  clientPhotoId: string
  fileUri: string
  status: "pending" | "applied" | "conflict" | "rejected"
  detail: unknown
}

export interface FieldSyncRecoveryRow {
  clientOpId: string
  kind: string
  payload: Record<string, unknown>
  clientCreatedAt: string
  status: "conflict" | "rejected"
  attempts: number
  detail: unknown
  evidence: FieldSyncRecoveryEvidence | null
  canContinueWithoutEvidence: boolean
  canDetachAttachment: boolean
}

type FieldRecoveryDbRow = {
  clientOpId: string
  kind: string
  payload: string
  clientCreatedAt: string | null
  status: "pending" | "applied" | "conflict" | "rejected"
  attempts: number | null
  detail: string | null
}

function parsedDetail(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

/**
 * Failed field operations remain durable until the user explicitly retries.
 * Evidence photo rows attached to a failed commitment are folded into that
 * commitment card to avoid two recovery actions for one job.
 */
export function listFieldSyncRecoveryQueue(): FieldSyncRecoveryRow[] {
  const failed = db.getAllSync<FieldRecoveryDbRow>(
    `SELECT clientOpId, kind, payload, clientCreatedAt, status, attempts, detail
     FROM outbox_ops
     WHERE kind LIKE 'field.%' AND status IN ('conflict','rejected')
     ORDER BY clientCreatedAt, rowid`,
  )
  const photos = db.getAllSync<FieldRecoveryDbRow>(
    `SELECT clientOpId, kind, payload, clientCreatedAt, status, attempts, detail
     FROM outbox_ops WHERE kind='field.visit.photo'`,
  )
  const photoById = new Map<string, FieldRecoveryDbRow>()
  for (const photo of photos) {
    try {
      const payload = parseFieldVisitPhotoPayload(JSON.parse(photo.payload) as unknown)
      photoById.set(payload.clientPhotoId, photo)
    } catch {
      // Keep malformed legacy operations visible as standalone rows below.
    }
  }
  const attachedPhotoIds = new Set<string>()
  for (const row of failed) {
    if (row.kind !== "field.commitment.create" && row.kind !== "field.commitment.fulfill") continue
    try {
      const raw = parseJsonObject(row.payload)
      const photoId = stringValue(raw.evidenceClientPhotoId)
      if (photoId) attachedPhotoIds.add(photoId)
    } catch {
      // The malformed commitment itself remains in the recovery list.
    }
  }

  return failed.flatMap((row): FieldSyncRecoveryRow[] => {
    let payload: Record<string, unknown>
    try {
      payload = parseJsonObject(row.payload)
    } catch {
      payload = {}
    }
    if (row.kind === "field.visit.photo") {
      const photoId = stringValue(payload.clientPhotoId)
      if (photoId && attachedPhotoIds.has(photoId)) return []
    }
    const evidenceClientPhotoId = stringValue(payload.evidenceClientPhotoId)
    const evidenceRow = evidenceClientPhotoId ? photoById.get(evidenceClientPhotoId) : null
    let evidence: FieldSyncRecoveryEvidence | null = null
    if (evidenceRow) {
      try {
        const photo = parseFieldVisitPhotoPayload(JSON.parse(evidenceRow.payload) as unknown)
        evidence = {
          clientPhotoId: photo.clientPhotoId,
          fileUri: photo.fileUri,
          status: evidenceRow.status,
          detail: parsedDetail(evidenceRow.detail),
        }
      } catch {
        evidence = null
      }
    }
    return [{
      clientOpId: row.clientOpId,
      kind: row.kind,
      payload,
      clientCreatedAt: row.clientCreatedAt ?? new Date(0).toISOString(),
      status: row.status === "conflict" ? "conflict" : "rejected",
      attempts: row.attempts ?? 0,
      detail: parsedDetail(row.detail),
      evidence,
      canContinueWithoutEvidence: Boolean(
        evidenceClientPhotoId &&
        (row.kind === "field.commitment.create" || row.kind === "field.commitment.fulfill"),
      ),
      canDetachAttachment: Boolean(
        row.kind === "field.message.send" &&
        stringValue(payload.attachmentClientDocumentId) &&
        stringValue(payload.body),
      ),
    }]
  })
}

function replaceOptimisticClientOpId(kind: string, previousId: string, nextId: string): void {
  if (kind.startsWith("field.task.")) {
    const cached = readFieldCache<FieldAgentTasksData>(FIELD_AGENT_TASKS_CACHE_KEY)
    if (cached) {
      writeFieldCache(FIELD_AGENT_TASKS_CACHE_KEY, {
        ...cached.value,
        tasks: cached.value.tasks.map((task) => ({
          ...task,
          events: task.events.map((event) => event.clientEventId !== previousId ? event : {
            ...event,
            id: event.id === previousId ? nextId : event.id,
            clientEventId: nextId,
          }),
        })),
      })
    }
  }
  if (kind === "field.workday.event") {
    const cached = readFieldCache<FieldWorkdayData>("field.workday.current")
    if (cached?.value.workday) {
      const events = cached.value.workday.events.map((event) => event.clientEventId !== previousId ? event : {
        ...event,
        id: event.id === previousId ? nextId : event.id,
        clientEventId: nextId,
      })
      writeFieldCache("field.workday.current", {
        ...cached.value,
        workday: { ...cached.value.workday, events },
      })
    }
  }
}

function renewFieldOutboxOperation(clientOpId: string, kind: string): string {
  const nextId = `field-retry-${Crypto.randomUUID()}`
  db.runSync(
    `UPDATE outbox_ops
     SET clientOpId=?, status='pending', attempts=0, detail=NULL
     WHERE clientOpId=?`,
    [nextId, clientOpId],
  )
  replaceOptimisticClientOpId(kind, clientOpId, nextId)
  return nextId
}

export function retryFieldSyncOperation(clientOpId: string): { clientOpId: string } | null {
  const row = db.getFirstSync<FieldRecoveryDbRow>(
    `SELECT clientOpId, kind, payload, clientCreatedAt, status, attempts, detail
     FROM outbox_ops WHERE clientOpId=? AND kind LIKE 'field.%'
       AND status IN ('conflict','rejected')`,
    [clientOpId],
  )
  if (!row) return null
  let nextId = clientOpId
  db.withTransactionSync(() => {
    if (row.kind === "field.commitment.create" || row.kind === "field.commitment.fulfill") {
      const payload = parseJsonObject(row.payload)
      const evidenceClientPhotoId = stringValue(payload.evidenceClientPhotoId)
      if (evidenceClientPhotoId) {
        const photo = db.getFirstSync<{ clientOpId: string; status: string }>(
          `SELECT clientOpId, status FROM outbox_ops
           WHERE kind='field.visit.photo'
             AND json_extract(payload, '$.clientPhotoId')=?
           ORDER BY rowid DESC LIMIT 1`,
          [evidenceClientPhotoId],
        )
        if (photo && (photo.status === "conflict" || photo.status === "rejected")) {
          renewFieldOutboxOperation(photo.clientOpId, "field.visit.photo")
        }
      }
    }
    if (row.kind === "field.message.send") {
      const payload = parseJsonObject(row.payload)
      const clientDocumentId = stringValue(payload.attachmentClientDocumentId)
      if (clientDocumentId) {
        const upload = db.getFirstSync<{ clientOpId: string; status: string }>(
          `SELECT clientOpId, status FROM outbox_ops
           WHERE kind='field.document.upload'
             AND json_extract(payload, '$.clientDocumentId')=?
           ORDER BY rowid DESC LIMIT 1`,
          [clientDocumentId],
        )
        if (upload && (upload.status === "conflict" || upload.status === "rejected")) {
          renewFieldOutboxOperation(upload.clientOpId, "field.document.upload")
        }
      }
    }
    nextId = renewFieldOutboxOperation(row.clientOpId, row.kind)
  })
  return { clientOpId: nextId }
}

export function detachFieldMessageAttachment(clientOpId: string): {
  clientOpId: string
  fileUri: string | null
} | null {
  const row = db.getFirstSync<FieldRecoveryDbRow>(
    `SELECT clientOpId, kind, payload, clientCreatedAt, status, attempts, detail
     FROM outbox_ops WHERE clientOpId=? AND kind='field.message.send'
       AND status IN ('conflict','rejected')`,
    [clientOpId],
  )
  if (!row) return null
  const payload = parseFieldMessageCreatePayload(JSON.parse(row.payload) as unknown)
  if (!payload.attachmentClientDocumentId || !payload.body?.trim()) return null
  const upload = db.getFirstSync<{ clientOpId: string; payload: string; status: string }>(
    `SELECT clientOpId, payload, status FROM outbox_ops
     WHERE kind='field.document.upload'
       AND json_extract(payload, '$.clientDocumentId')=?
     ORDER BY rowid DESC LIMIT 1`,
    [payload.attachmentClientDocumentId],
  )
  let fileUri: string | null = null
  let nextId = clientOpId
  db.withTransactionSync(() => {
    if (upload && upload.status !== "applied") {
      try {
        fileUri = parseFieldDocumentUploadPayload(JSON.parse(upload.payload) as unknown).fileUri
      } catch {
        fileUri = null
      }
      db.runSync("DELETE FROM outbox_ops WHERE clientOpId=?", [upload.clientOpId])
      const documents = readFieldDocuments()
      writeFieldCache(FIELD_DOCUMENTS_CACHE_KEY, {
        ...documents,
        documents: documents.documents.filter((document) => document.clientDocumentId !== payload.attachmentClientDocumentId),
      })
    }
    nextId = `field-retry-${Crypto.randomUUID()}`
    db.runSync(
      `UPDATE outbox_ops
       SET clientOpId=?, payload=?, status='pending', attempts=0, detail=NULL
       WHERE clientOpId=?`,
      [nextId, JSON.stringify({ ...payload, attachmentClientDocumentId: null }), row.clientOpId],
    )
    const rows = db.getAllSync<{ k: string; json: string }>(
      "SELECT k, json FROM field_cache WHERE k LIKE 'field.messages.thread.%'",
    )
    for (const cacheRow of rows) {
      const cached = unknownRecord(JSON.parse(cacheRow.json) as unknown)
      const thread = unknownRecord(cached?.thread)
      if (!cached || !thread || !Array.isArray(thread.messages)) continue
      let changed = false
      const messages = thread.messages.map((rawMessage) => {
        const message = unknownRecord(rawMessage)
        if (!message || message.clientMessageId !== payload.clientMessageId) return rawMessage
        changed = true
        return { ...message, attachmentDocument: null, syncState: "PENDING" }
      })
      if (changed) writeFieldCache(cacheRow.k, { ...cached, thread: { ...thread, messages } })
    }
  })
  return { clientOpId: nextId, fileUri }
}

export function detachFieldCommitmentEvidence(clientOpId: string): {
  clientOpId: string
  fileUri: string | null
} | null {
  const row = db.getFirstSync<FieldRecoveryDbRow>(
    `SELECT clientOpId, kind, payload, clientCreatedAt, status, attempts, detail
     FROM outbox_ops WHERE clientOpId=?
       AND kind IN ('field.commitment.create','field.commitment.fulfill')
       AND status IN ('conflict','rejected')`,
    [clientOpId],
  )
  if (!row) return null
  const payload = parseJsonObject(row.payload)
  const evidenceClientPhotoId = stringValue(payload.evidenceClientPhotoId)
  if (!evidenceClientPhotoId) return null
  const photo = db.getFirstSync<{ clientOpId: string; payload: string; status: string }>(
    `SELECT clientOpId, payload, status FROM outbox_ops
     WHERE kind='field.visit.photo'
       AND json_extract(payload, '$.clientPhotoId')=?
     ORDER BY rowid DESC LIMIT 1`,
    [evidenceClientPhotoId],
  )
  let fileUri: string | null = null
  let nextId = clientOpId
  db.withTransactionSync(() => {
    if (photo && photo.status !== "applied") {
      try {
        fileUri = parseFieldVisitPhotoPayload(JSON.parse(photo.payload) as unknown).fileUri
      } catch {
        fileUri = null
      }
      db.runSync("DELETE FROM outbox_ops WHERE clientOpId=?", [photo.clientOpId])
    }
    nextId = `field-retry-${Crypto.randomUUID()}`
    db.runSync(
      `UPDATE outbox_ops
       SET clientOpId=?, payload=?, status='pending', attempts=0, detail=NULL
       WHERE clientOpId=?`,
      [nextId, JSON.stringify({ ...payload, evidenceClientPhotoId: null }), row.clientOpId],
    )
  })
  return { clientOpId: nextId, fileUri }
}

export function fieldRouteOutboxResult(clientOpId: string): {
  status: "pending" | "applied" | "conflict" | "rejected"
  routeId: string | null
} | null {
  const result = fieldOutboxResult(clientOpId)
  if (!result) return null
  const detail = unknownRecord(result.detail)
  return {
    status: result.status,
    routeId: stringValue(detail?.routeId),
  }
}

export function fieldRouteServerId(localRouteId: string): string | null {
  const row = db.getFirstSync<{ detail: string | null }>(
    `SELECT detail FROM outbox_ops
     WHERE kind='field.route.create'
       AND status='applied'
       AND json_extract(payload, '$.localRouteId')=?
     ORDER BY clientCreatedAt DESC LIMIT 1`,
    [localRouteId],
  )
  if (!row?.detail) return null
  try {
    const detail = unknownRecord(JSON.parse(row.detail) as unknown)
    return stringValue(detail?.routeId)
  } catch {
    return null
  }
}
