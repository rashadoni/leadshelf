// LocalStore на expo-sqlite (решение docs/19: Expo Go сегодня; миграция на
// WatermelonDB позже за этим же интерфейсом). Ack-курсоры пишутся только
// после commit-а applyPull — гарантия sync-протокола.

import * as SQLite from "expo-sqlite"
import {
  mobilePhotoSubmitPayloadSchema,
  mobileLocationUpdatePayloadSchema,
  mobileTaskCommentPayloadSchema,
  mobileTaskStatusPayloadSchema,
  mobileVisitCheckInPayloadSchema,
  mobileVisitCheckOutPayloadSchema,
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

const db = SQLite.openDatabaseSync("leadshelf.db")

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
    CREATE TABLE IF NOT EXISTS outbox_ops (
      clientOpId TEXT PRIMARY KEY, kind TEXT, payload TEXT,
      clientCreatedAt TEXT, status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0, detail TEXT
    );
    CREATE TABLE IF NOT EXISTS photo_queue (
      clientPhotoId TEXT PRIMARY KEY, taskId TEXT, fileUri TEXT,
      takenAt TEXT, uploaded INTEGER DEFAULT 0
    );
  `)
  const taskColumns = db.getAllSync<{ name: string }>("PRAGMA table_info(tasks)")
  if (!taskColumns.some((c) => c.name === "locationHint")) {
    db.execSync("ALTER TABLE tasks ADD COLUMN locationHint TEXT")
  }
  const storeColumns = db.getAllSync<{ name: string }>("PRAGMA table_info(stores)")
  if (!storeColumns.some((c) => c.name === "latitude")) {
    db.execSync("ALTER TABLE stores ADD COLUMN latitude REAL")
  }
  if (!storeColumns.some((c) => c.name === "longitude")) {
    db.execSync("ALTER TABLE stores ADD COLUMN longitude REAL")
  }
}

export const localStore: LocalStore = {
  async applyPull(data: PullResponse) {
    db.withTransactionSync(() => {
      for (const t of data.tasks) {
        db.runSync(
          `INSERT INTO tasks (id, title, status, dueAt, storeId, planogramVersionId, locationHint, updatedAt)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title, status=excluded.status,
             dueAt=excluded.dueAt, storeId=excluded.storeId,
             planogramVersionId=excluded.planogramVersionId, locationHint=excluded.locationHint,
             updatedAt=excluded.updatedAt`,
          [
            t.id,
            t.title,
            t.status,
            t.dueAt,
            t.storeId,
            t.planogramVersionId,
            t.locationHint ? JSON.stringify(t.locationHint) : null,
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
    })
  },

  async getCursors() {
    const rows = db.getAllSync<{ k: string; v: string }>("SELECT k, v FROM cursors")
    const map = Object.fromEntries(rows.map((r) => [r.k, r.v]))
    return { tasks: map.tasks ?? null, planogramBundles: map.planogramBundles ?? null }
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
      }>("SELECT * FROM outbox_ops WHERE status='pending' ORDER BY clientCreatedAt LIMIT ?", [limit])
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

  async markOutbox(clientOpId, status, detail) {
    db.runSync("UPDATE outbox_ops SET status=?, detail=? WHERE clientOpId=?", [
      status,
      detail == null ? null : JSON.stringify(detail),
      clientOpId,
    ])
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
    }>("SELECT clientPhotoId, taskId, fileUri, takenAt FROM photo_queue WHERE uploaded=0")
    return rows.map((r): PhotoQueueRow => ({ ...r, uploaded: false }))
  },

  async markPhotoUploaded(clientPhotoId) {
    db.runSync("UPDATE photo_queue SET uploaded=1 WHERE clientPhotoId=?", [clientPhotoId])
  },
}

// --- локальные чтения/записи для UI ---

type TaskDbRow = Omit<TaskRow, "locationHint"> & { locationHint?: string | null }

function mapTaskRow(row: TaskDbRow): TaskRow {
  return {
    ...row,
    locationHint: row.locationHint ? JSON.parse(row.locationHint) : null,
  }
}

export function listTasks(): TaskRow[] {
  return db
    .getAllSync<TaskDbRow>("SELECT * FROM tasks ORDER BY dueAt IS NULL, dueAt, title")
    .map(mapTaskRow)
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
}): void {
  const takenAt = new Date().toISOString()
  db.withTransactionSync(() => {
    db.runSync(
      "INSERT INTO photo_queue (clientPhotoId, taskId, fileUri, takenAt) VALUES (?,?,?,?)",
      [input.clientPhotoId, input.taskId, input.fileUri, takenAt],
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
      new Date().toISOString(),
    ],
  )
}

export function enqueueVisitCheckOut(input: { clientOpId: string; visitId: string }): void {
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [input.clientOpId, "visit.checkout", JSON.stringify({ visitId: input.visitId }), new Date().toISOString()],
  )
}

export function enqueueOrderCreate(input: OrderCreateRequest & { clientOpId: string }): void {
  db.runSync(
    "INSERT INTO outbox_ops (clientOpId, kind, payload, clientCreatedAt) VALUES (?,?,?,?)",
    [
      input.clientOpId,
      "order.create",
      JSON.stringify({
        storeId: input.storeId,
        visitId: input.visitId ?? null,
        lines: input.lines,
      }),
      new Date().toISOString(),
    ],
  )
}
