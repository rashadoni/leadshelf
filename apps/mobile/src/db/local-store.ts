// LocalStore на expo-sqlite (решение docs/19: Expo Go сегодня; миграция на
// WatermelonDB позже за этим же интерфейсом). Ack-курсоры пишутся только
// после commit-а applyPull — гарантия sync-протокола.

import * as SQLite from "expo-sqlite"
import {
  mobilePhotoSubmitPayloadSchema,
  mobileTaskCommentPayloadSchema,
  mobileTaskStatusPayloadSchema,
  type MobileTaskStatus,
} from "@leadshelf/api-contracts/mobile/v1"
import type {
  LocalStore,
  OutboxRow,
  PhotoQueueRow,
  PullResponse,
  StoreRow,
  TaskRow,
} from "../sync/ports"

const db = SQLite.openDatabaseSync("leadshelf.db")

export function initDb(): void {
  db.execSync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, title TEXT, status TEXT, dueAt TEXT,
      storeId TEXT, planogramVersionId TEXT, updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY, name TEXT, code TEXT, address TEXT
    );
    CREATE TABLE IF NOT EXISTS planogram_bundles (
      versionId TEXT PRIMARY KEY, json TEXT
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
}

export const localStore: LocalStore = {
  async applyPull(data: PullResponse) {
    db.withTransactionSync(() => {
      for (const t of data.tasks) {
        db.runSync(
          `INSERT INTO tasks (id, title, status, dueAt, storeId, planogramVersionId, updatedAt)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title, status=excluded.status,
             dueAt=excluded.dueAt, storeId=excluded.storeId,
             planogramVersionId=excluded.planogramVersionId, updatedAt=excluded.updatedAt`,
          [t.id, t.title, t.status, t.dueAt, t.storeId, t.planogramVersionId, t.updatedAt],
        )
      }
      for (const s of data.stores) {
        db.runSync(
          `INSERT INTO stores (id, name, code, address) VALUES (?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code, address=excluded.address`,
          [s.id, s.name, s.code, s.address],
        )
      }
      for (const b of data.planogramBundles) {
        db.runSync(
          `INSERT INTO planogram_bundles (versionId, json) VALUES (?,?)
           ON CONFLICT(versionId) DO UPDATE SET json=excluded.json`,
          [b.versionId, JSON.stringify(b)],
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

export function listTasks(): TaskRow[] {
  return db.getAllSync<TaskRow>("SELECT * FROM tasks ORDER BY dueAt IS NULL, dueAt, title")
}

export function getTask(id: string): TaskRow | null {
  return db.getFirstSync<TaskRow>("SELECT * FROM tasks WHERE id=?", [id])
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
