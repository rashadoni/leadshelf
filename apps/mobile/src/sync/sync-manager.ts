// Sync-движок: pull -> apply -> ack -> upload photos -> push -> apply results.
// Порядок из mtm-offline-sync-spec; ack ТОЛЬКО после локального коммита pull.
// Чистый TS с инжекцией портов — юнит-тесты в CI без устройства.

import type {
  LocalStore,
  OutboxPipeline,
  PushOperation,
  SyncApi,
  SyncStatus,
} from "./ports"
import { AuthLostError, HttpError, UpgradeRequiredError } from "./ports-error"
import { isWorkforcePushOperation } from "./workforce-sync-manager"

// Реэкспорт для обратной совместимости импортов из "./sync-manager".
export { UpgradeRequiredError } from "./ports-error"

const MAX_PUSH_BATCH = 50
const MAX_ATTEMPTS = 8

// Перманентный клиентский отказ загрузки медиа: файл никогда не пройдёт
// (битый MIME, слишком большой, невалидный запрос) — в карантин, чтобы не
// клинить очередь. 408/429 — транзиентные, ретраим. docs/26 §2.
function isPermanentUploadError(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  )
}

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
    quarantinedPhotos: 0,
    conflictOps: 0,
    rejectedOps: 0,
    oldestPendingAgeMs: null,
    lastDurationMs: null,
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
      /** LeadDrive Field uses this to keep Workforce out of Shelf sync. */
      outboxPipeline?: OutboxPipeline
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
    const [outbox, photos, commercialMedia, quarantined] = await Promise.all([
      this.deps.store.outboxDiagnosticsForPipeline
        ? this.deps.store.outboxDiagnosticsForPipeline(this.deps.outboxPipeline ?? "all")
        : this.deps.store.outboxDiagnostics(),
      this.deps.store.pendingPhotos(),
      this.deps.store.pendingCommercialMedia(),
      this.deps.store.quarantinedPhotoCount(),
    ])
    const oldestPendingAt = outbox.oldestPendingAt ? new Date(outbox.oldestPendingAt).getTime() : Number.NaN
    const now = (this.deps.now?.() ?? new Date()).getTime()
    this.patch({
      pendingOps: outbox.pendingOps,
      pendingPhotos: photos.length + commercialMedia.length,
      quarantinedPhotos: quarantined,
      conflictOps: outbox.conflictOps,
      rejectedOps: outbox.rejectedOps,
      oldestPendingAgeMs: Number.isFinite(oldestPendingAt) ? Math.max(0, now - oldestPendingAt) : null,
    })
  }

  private patch(p: Partial<SyncStatus>) {
    this.status = { ...this.status, ...p }
    for (const fn of this.listeners) fn(this.status)
  }

  /** Полный цикл синхронизации. Повторный вызов во время работы — no-op. */
  async runSync(): Promise<SyncStatus> {
    if (this.running) return this.status
    this.running = true
    const startedAt = Date.now()
    try {
      if (this.deps.isOnline && !(await this.deps.isOnline())) {
        this.patch({ phase: "offline", error: null, lastDurationMs: Date.now() - startedAt })
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

      // 3. Фото: upload до push (photo.submit ссылается на загруженный файл).
      // Изоляция: один битый файл не должен валить весь sync и блокировать
      // push (docs/26 §2). Перманентный 4xx -> карантин; транзиентный ->
      // счётчик попыток и ретрай на следующем sync. auth/upgrade — наверх.
      this.patch({ phase: "uploadingPhotos" })
      for (const photo of await this.deps.store.pendingPhotos()) {
        try {
          const result = await this.deps.api.uploadPhoto(photo) // дедуп по clientPhotoId на сервере
          await this.deps.store.markPhotoUploaded(photo.clientPhotoId, result)
        } catch (e) {
          if (e instanceof UpgradeRequiredError || e instanceof AuthLostError) throw e
          if (isPermanentUploadError(e)) {
            await this.deps.store.quarantinePhoto(
              photo.clientPhotoId,
              e instanceof Error ? e.message : String(e),
            )
          } else {
            await this.deps.store.bumpPhotoAttempts(
              [photo.clientPhotoId],
              e instanceof Error ? e.message : String(e),
            )
          }
          // не прерываем цикл — остальные фото и push должны пройти
        }
      }
      for (const media of await this.deps.store.pendingCommercialMedia()) {
        try {
          const result = await this.deps.api.uploadCommercialMedia(media)
          await this.deps.store.markCommercialMediaUploaded(media.clientMediaId, result)
          await this.deps.api.cleanupCommercialMedia(media).catch(() => {})
        } catch (e) {
          if (e instanceof UpgradeRequiredError || e instanceof AuthLostError) throw e
          if (isPermanentUploadError(e)) {
            await this.deps.store.quarantineCommercialMedia(
              media.clientMediaId,
              e instanceof Error ? e.message : String(e),
            )
          } else {
            await this.deps.store.bumpCommercialMediaAttempts(
              [media.clientMediaId],
              e instanceof Error ? e.message : String(e),
            )
          }
        }
      }

      // 4. PUSH outbox
      this.patch({ phase: "pushing" })
      const rawPending = this.deps.store.pendingOutboxForPipeline
        ? await this.deps.store.pendingOutboxForPipeline(this.deps.outboxPipeline ?? "all", MAX_PUSH_BATCH)
        : await this.deps.store.pendingOutbox(MAX_PUSH_BATCH)
      const pending = this.deps.outboxPipeline === "non-workforce"
        ? rawPending.filter((operation) => !isWorkforcePushOperation(operation))
        : rawPending
      if (pending.length > 0) {
        const unuploadedPhotoIds = new Set(await this.deps.store.unuploadedPhotoIds())
        const sendable = pending.filter(
          (op) =>
            op.attempts < MAX_ATTEMPTS &&
            (op.kind !== "photo.submit" || !unuploadedPhotoIds.has(op.payload.clientPhotoId)),
        )
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

      // Удаляем локальный media-файл только после тройного подтверждения:
      // upload завершён, photo.submit applied, server submission пришёл pull-ом.
      await this.deps.store.cleanupUploadedPhotoFiles?.()

      const now = (this.deps.now?.() ?? new Date()).toISOString()
      this.patch({ phase: "idle", lastSyncAt: now, error: null, lastDurationMs: Date.now() - startedAt })
      await this.refreshCounters()
      return this.status
    } catch (e) {
      if (e instanceof UpgradeRequiredError) {
        this.patch({ phase: "upgradeRequired", error: null, lastDurationMs: Date.now() - startedAt })
      } else if (e instanceof AuthLostError) {
        this.patch({ phase: "authLost", error: null, lastDurationMs: Date.now() - startedAt })
      } else {
        this.patch({ phase: "error", error: e instanceof Error ? e.message : String(e), lastDurationMs: Date.now() - startedAt })
      }
      await this.refreshCounters().catch(() => {})
      return this.status
    } finally {
      this.running = false
    }
  }
}
