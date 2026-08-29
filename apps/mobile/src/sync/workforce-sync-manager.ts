// Independent Workforce delivery lane.  Unlike SyncManager it deliberately
// does not pull Shelf data, upload Shelf media, or ack Shelf cursors.  A Shelf
// outage therefore cannot delay durable work-time and HRM request operations.

import type {
  LocalStore,
  OutboxRow,
  PushOperation,
  SyncStatus,
  WorkforcePushOperation,
  WorkforceSyncApi,
} from "./ports"
import { AuthLostError, UpgradeRequiredError } from "./ports-error"

const MAX_PUSH_BATCH = 50
const MAX_ATTEMPTS = 8

export const WORKFORCE_OUTBOX_KINDS = [
  "field.workday.event",
  "field.hrm.create",
  "field.hrm.cancel",
] as const

type WorkforceOutboxRow = OutboxRow & WorkforcePushOperation

export function isWorkforcePushOperation(
  operation: PushOperation,
): operation is WorkforcePushOperation {
  return WORKFORCE_OUTBOX_KINDS.includes(
    operation.kind as typeof WORKFORCE_OUTBOX_KINDS[number],
  )
}

function isWorkforceOutboxRow(operation: OutboxRow): operation is WorkforceOutboxRow {
  return isWorkforcePushOperation(operation)
}

export function emptyWorkforceSyncStatus(): SyncStatus {
  return {
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
}

const phasePriority: Record<SyncStatus["phase"], number> = {
  authLost: 100,
  upgradeRequired: 90,
  error: 80,
  offline: 70,
  pushing: 60,
  uploadingPhotos: 50,
  acking: 40,
  pulling: 30,
  idle: 0,
}

/** Keeps the existing common status surface while retaining per-lane details. */
export function combineSyncStatuses(statuses: SyncStatus[]): SyncStatus {
  if (statuses.length === 0) return emptyWorkforceSyncStatus()
  const highest = statuses.reduce((current, candidate) => (
    phasePriority[candidate.phase] > phasePriority[current.phase] ? candidate : current
  ))
  const latest = statuses
    .map((status) => status.lastSyncAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null
  const duration = statuses
    .map((status) => status.lastDurationMs)
    .filter((value): value is number => value != null)
  const oldest = statuses
    .map((status) => status.oldestPendingAgeMs)
    .filter((value): value is number => value != null)
  return {
    phase: highest.phase,
    lastSyncAt: latest,
    pendingOps: statuses.reduce((sum, status) => sum + status.pendingOps, 0),
    pendingPhotos: statuses.reduce((sum, status) => sum + status.pendingPhotos, 0),
    quarantinedPhotos: statuses.reduce((sum, status) => sum + status.quarantinedPhotos, 0),
    conflictOps: statuses.reduce((sum, status) => sum + status.conflictOps, 0),
    rejectedOps: statuses.reduce((sum, status) => sum + status.rejectedOps, 0),
    oldestPendingAgeMs: oldest.length > 0 ? Math.max(...oldest) : null,
    lastDurationMs: duration.length > 0 ? Math.max(...duration) : null,
    error: highest.error ?? statuses.map((status) => status.error).find(Boolean) ?? null,
  }
}

/**
 * Sends only Workforce operations. Work-time events are selected first by the
 * store, and Hrm requests follow in the same bounded batch. The server keeps
 * `operationId` idempotency, while failed operations remain durable locally.
 */
export class WorkforceSyncManager {
  private status = emptyWorkforceSyncStatus()
  private listeners = new Set<(status: SyncStatus) => void>()
  private running = false

  constructor(
    private deps: {
      api: WorkforceSyncApi
      store: LocalStore
      now?: () => Date
      isOnline?: () => Promise<boolean>
    },
  ) {}

  getStatus(): SyncStatus {
    return this.status
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener)
    listener(this.status)
    return () => this.listeners.delete(listener)
  }

  private patch(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch }
    for (const listener of this.listeners) listener(this.status)
  }

  private async refreshCounters(): Promise<void> {
    const outbox = this.deps.store.outboxDiagnosticsForPipeline
      ? await this.deps.store.outboxDiagnosticsForPipeline("workforce")
      : await this.deps.store.outboxDiagnostics()
    const oldest = outbox.oldestPendingAt ? new Date(outbox.oldestPendingAt).getTime() : Number.NaN
    const now = (this.deps.now?.() ?? new Date()).getTime()
    this.patch({
      pendingOps: outbox.pendingOps,
      pendingPhotos: 0,
      quarantinedPhotos: 0,
      conflictOps: outbox.conflictOps,
      rejectedOps: outbox.rejectedOps,
      oldestPendingAgeMs: Number.isFinite(oldest) ? Math.max(0, now - oldest) : null,
    })
  }

  private async pending(): Promise<WorkforceOutboxRow[]> {
    const queued = this.deps.store.pendingOutboxForPipeline
      ? await this.deps.store.pendingOutboxForPipeline("workforce", MAX_PUSH_BATCH)
      : await this.deps.store.pendingOutbox(MAX_PUSH_BATCH)
    return queued.filter(isWorkforceOutboxRow)
  }

  /** Repeated invocation while a delivery is in flight is intentionally a no-op. */
  async runSync(): Promise<SyncStatus> {
    if (this.running) return this.status
    this.running = true
    const startedAt = Date.now()
    const attemptedAt = (this.deps.now?.() ?? new Date()).toISOString()
    try {
      if (this.deps.isOnline && !(await this.deps.isOnline())) {
        this.patch({ phase: "offline", error: null, lastDurationMs: Date.now() - startedAt })
        await this.refreshCounters()
        return this.status
      }

      await this.deps.store.recordWorkforceSyncAttempt?.(attemptedAt)
      this.patch({ phase: "pushing", error: null })
      const pending = await this.pending()
      const exhausted = pending.filter((operation) => operation.attempts >= MAX_ATTEMPTS)
      for (const operation of exhausted) {
        await this.deps.store.markOutbox(operation.clientOpId, "rejected", {
          code: "WORKFORCE_RETRY_EXHAUSTED",
          error: `Workforce delivery failed after ${MAX_ATTEMPTS} attempts`,
          recoverable: true,
        })
      }
      const sendable = pending.filter((operation) => operation.attempts < MAX_ATTEMPTS)
      if (sendable.length > 0) {
        await this.deps.store.bumpOutboxAttempts(sendable.map((operation) => operation.clientOpId))
        const results = await this.deps.api.push(sendable)
        for (const result of results) {
          await this.deps.store.markOutbox(result.clientOpId, result.status, result.detail)
        }
      }

      const finishedAt = (this.deps.now?.() ?? new Date()).toISOString()
      await this.deps.store.recordWorkforceSyncSuccess?.(finishedAt)
      this.patch({
        phase: "idle",
        lastSyncAt: finishedAt,
        error: null,
        lastDurationMs: Date.now() - startedAt,
      })
      await this.refreshCounters()
      return this.status
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const recordFailure = this.deps.store.recordWorkforceSyncFailure
      if (recordFailure) {
        await recordFailure(
          (this.deps.now?.() ?? new Date()).toISOString(),
          message,
        ).catch(() => {})
      }
      if (error instanceof UpgradeRequiredError) {
        this.patch({ phase: "upgradeRequired", error: null, lastDurationMs: Date.now() - startedAt })
      } else if (error instanceof AuthLostError) {
        this.patch({ phase: "authLost", error: null, lastDurationMs: Date.now() - startedAt })
      } else {
        this.patch({ phase: "error", error: message, lastDurationMs: Date.now() - startedAt })
      }
      await this.refreshCounters().catch(() => {})
      return this.status
    } finally {
      this.running = false
    }
  }
}
