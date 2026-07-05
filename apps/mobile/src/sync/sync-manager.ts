// Sync-движок: pull -> apply -> ack -> upload photos -> push -> apply results.
// Порядок из mtm-offline-sync-spec; ack ТОЛЬКО после локального коммита pull.
// Чистый TS с инжекцией портов — юнит-тесты в CI без устройства.

import type {
  LocalStore,
  PushOperation,
  SyncApi,
  SyncStatus,
} from "./ports"

export class UpgradeRequiredError extends Error {
  constructor() {
    super("protocol upgrade required")
  }
}

const MAX_PUSH_BATCH = 50
const MAX_ATTEMPTS = 8

function toPushOperation(op: PushOperation): PushOperation {
  if (op.kind === "task.status") {
    return {
      clientOpId: op.clientOpId,
      kind: "task.status",
      payload: op.payload,
      clientCreatedAt: op.clientCreatedAt,
    }
  }
  if (op.kind === "photo.submit") {
    return {
      clientOpId: op.clientOpId,
      kind: "photo.submit",
      payload: op.payload,
      clientCreatedAt: op.clientCreatedAt,
    }
  }
  return op
}

export class SyncManager {
  private status: SyncStatus = {
    phase: "idle",
    lastSyncAt: null,
    pendingOps: 0,
    pendingPhotos: 0,
    error: null,
  }
  private listeners = new Set<(s: SyncStatus) => void>()
  private running = false

  constructor(
    private deps: {
      api: SyncApi
      store: LocalStore
      now?: () => Date
      isOnline?: () => Promise<boolean>
    },
  ) {}

  getStatus(): SyncStatus {
    return this.status
  }

  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn)
    fn(this.status)
    return () => this.listeners.delete(fn)
  }

  private async refreshCounters() {
    const [ops, photos] = await Promise.all([
      this.deps.store.pendingOutbox(),
      this.deps.store.pendingPhotos(),
    ])
    this.patch({ pendingOps: ops.length, pendingPhotos: photos.length })
  }

  private patch(p: Partial<SyncStatus>) {
    this.status = { ...this.status, ...p }
    for (const fn of this.listeners) fn(this.status)
  }

  /** Полный цикл синхронизации. Повторный вызов во время работы — no-op. */
  async runSync(): Promise<SyncStatus> {
    if (this.running) return this.status
    this.running = true
    try {
      if (this.deps.isOnline && !(await this.deps.isOnline())) {
        this.patch({ phase: "offline", error: null })
        await this.refreshCounters()
        return this.status
      }

      // 1. PULL
      this.patch({ phase: "pulling", error: null })
      const cursors = await this.deps.store.getCursors()
      const pulled = await this.deps.api.pull(cursors)
      await this.deps.store.applyPull(pulled) // локальная транзакция

      // 2. ACK — только после успешного apply
      this.patch({ phase: "acking" })
      await this.deps.api.ack(pulled.cursors)
      await this.deps.store.setCursors(pulled.cursors)

      // 3. Фото: upload до push (photo.submit ссылается на загруженный файл)
      this.patch({ phase: "uploadingPhotos" })
      for (const photo of await this.deps.store.pendingPhotos()) {
        const result = await this.deps.api.uploadPhoto(photo) // дедуп по clientPhotoId на сервере
        await this.deps.store.markPhotoUploaded(photo.clientPhotoId, result)
      }

      // 4. PUSH outbox
      this.patch({ phase: "pushing" })
      const pending = await this.deps.store.pendingOutbox(MAX_PUSH_BATCH)
      if (pending.length > 0) {
        const sendable = pending.filter((op) => op.attempts < MAX_ATTEMPTS)
        if (sendable.length > 0) {
          await this.deps.store.bumpOutboxAttempts(sendable.map((o) => o.clientOpId))
          const ops = sendable.map(toPushOperation)
          const { results } = await this.deps.api.push(ops)
          for (const r of results) {
            const status =
              r.status === "applied" || r.status === "already_applied"
                ? "applied"
                : r.status === "conflict"
                  ? "conflict"
                  : "rejected"
            await this.deps.store.markOutbox(r.clientOpId, status, r.detail)
          }
        }
      }

      const now = (this.deps.now?.() ?? new Date()).toISOString()
      this.patch({ phase: "idle", lastSyncAt: now, error: null })
      await this.refreshCounters()
      return this.status
    } catch (e) {
      if (e instanceof UpgradeRequiredError) {
        this.patch({ phase: "upgradeRequired", error: null })
      } else {
        this.patch({ phase: "error", error: e instanceof Error ? e.message : String(e) })
      }
      await this.refreshCounters().catch(() => {})
      return this.status
    } finally {
      this.running = false
    }
  }
}
