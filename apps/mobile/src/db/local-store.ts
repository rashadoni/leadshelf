// LocalStore на expo-sqlite (решение docs/19: Expo Go сегодня; миграция на
// WatermelonDB позже за этим же интерфейсом). Ack-курсоры пишутся только
// после commit-а applyPull — гарантия sync-протокола.

import * as SQLite from "expo-sqlite"
import * as Crypto from "expo-crypto"
import {
  mobilePhotoSubmitPayloadSchema,
  mobileLocationUpdatePayloadSchema,
  mobileProofExceptionPayloadSchema,
  mobileTaskCommentPayloadSchema,
  mobileTaskStatusPayloadSchema,
  mobileVisitCheckInPayloadSchema,
  mobileVisitCheckOutPayloadSchema,
  type MobileProofExceptionPayload,
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
  parseQueuedOrderDetailCode,
  parseQueuedOrderPayload,
  type QueuedOrderLine,
} from "../orders/queued-order"
import {
  parseLocalPlanogramLibrary,
  type LocalPlanogramBundleRow,
  type LocalPlanogramLibrary,
} from "../planogram/local-library"
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
  type FieldLocationPayload,
  type FieldVisitActionPayload,
  type FieldVisitCheckInPayload,
  type FieldVisitPhotoPayload,
  type FieldVisitUpdatePayload,
  type FieldWorkdayEventPayload,
} from "../field/execution-outbox"

const db = SQLite.openDatabaseSync("leadshelf.db")

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

export function initDb(): void {
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
    "SELECT COUNT(*) AS n FROM photo_queue WHERE uploaded=0",
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

export const localStore: LocalStore = {
  async applyPull(data: PullResponse) {
    db.withTransactionSync(() => {
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
         WHERE status='pending'
            OR (status='rejected' AND kind='photo.submit' AND detail='"photo_not_uploaded_yet"')
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
      "SELECT COUNT(*) AS n FROM photo_queue WHERE uploaded=0 AND status='quarantined'",
    )
    return row?.n ?? 0
  },
}

// --- локальные чтения/записи для UI ---

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
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [clientOpId, "field.visit.photo", JSON.stringify(input), input.takenAt],
  )
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
