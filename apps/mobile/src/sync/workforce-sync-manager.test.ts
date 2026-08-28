import { describe, expect, it, vi } from "vitest"
import type { LocalStore, OutboxRow, WorkforcePushOperation } from "./ports"
import { WorkforceSyncManager, combineSyncStatuses, emptyWorkforceSyncStatus } from "./workforce-sync-manager"

function workday(
  clientOpId: string,
  clientCreatedAt: string,
  action: "START" | "PAUSE" | "RESUME" | "FINISH" = "START",
): OutboxRow {
  return {
    clientOpId,
    clientCreatedAt,
    kind: "field.workday.event",
    payload: {
      action,
      workdayId: "mobile-workday-1",
      workDate: "2026-08-28",
      occurredAt: clientCreatedAt,
      latitude: null,
      longitude: null,
      accuracy: null,
      note: null,
    },
    status: "pending",
    attempts: 0,
  } as OutboxRow
}

function hrm(clientOpId: string, clientCreatedAt: string): OutboxRow {
  return {
    clientOpId,
    clientCreatedAt,
    kind: "field.hrm.create",
    payload: {
      id: "request-1",
      clientRequestId: "request-client-0001",
      type: "LEAVE",
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      correctionWorkdayId: null,
      requestedStartAt: null,
      requestedEndAt: null,
      reason: "Annual leave",
      submittedAt: "2026-08-28T09:00:00.000Z",
    },
    status: "pending",
    attempts: 0,
  } as OutboxRow
}

function makeStore(outbox: OutboxRow[]): LocalStore {
  return {
    async pendingOutboxForPipeline(pipeline) {
      expect(pipeline).toBe("workforce")
      return outbox
        .filter((row) => row.kind.startsWith("field.workday") || row.kind.startsWith("field.hrm"))
        .sort((left, right) => {
          const leftPriority = left.kind === "field.workday.event" ? 0 : 1
          const rightPriority = right.kind === "field.workday.event" ? 0 : 1
          return leftPriority - rightPriority || String(left.clientCreatedAt).localeCompare(String(right.clientCreatedAt))
        })
    },
    async outboxDiagnosticsForPipeline(pipeline) {
      expect(pipeline).toBe("workforce")
      const pending = outbox.filter((row) => row.status === "pending")
      return {
        pendingOps: pending.length,
        conflictOps: outbox.filter((row) => row.status === "conflict").length,
        rejectedOps: outbox.filter((row) => row.status === "rejected").length,
        oldestPendingAt: pending[0]?.clientCreatedAt ?? null,
      }
    },
    async markOutbox(clientOpId, status, detail) {
      const row = outbox.find((candidate) => candidate.clientOpId === clientOpId)
      if (row) {
        row.status = status
        ;(row as OutboxRow & { detail?: unknown }).detail = detail
      }
    },
    async bumpOutboxAttempts(ids) {
      for (const row of outbox) if (ids.includes(row.clientOpId)) row.attempts += 1
    },
  } as LocalStore
}

describe("WorkforceSyncManager", () => {
  it("keeps a Workforce failure visible without discarding the shared lane state", () => {
    const combined = combineSyncStatuses([
      { ...emptyWorkforceSyncStatus(), phase: "idle", pendingOps: 2, lastSyncAt: "2026-08-28T09:00:00.000Z" },
      { ...emptyWorkforceSyncStatus(), phase: "error", pendingOps: 1, error: "workforce endpoint unavailable" },
    ])

    expect(combined).toMatchObject({
      phase: "error",
      pendingOps: 3,
      error: "workforce endpoint unavailable",
      lastSyncAt: "2026-08-28T09:00:00.000Z",
    })
  })

  it("pushes the independent Workforce lane without a Shelf pull and keeps workday first", async () => {
    const queued = [
      hrm("hrm-first-in-storage", "2026-08-28T08:00:00.000Z"),
      workday("workday-priority", "2026-08-28T09:00:00.000Z"),
    ]
    const pushed: string[] = []
    const manager = new WorkforceSyncManager({
      store: makeStore(queued),
      api: {
        async push(operations: WorkforcePushOperation[]) {
          pushed.push(...operations.map((operation) => operation.clientOpId))
          return operations.map((operation) => ({ clientOpId: operation.clientOpId, status: "applied" as const }))
        },
      },
    })

    const status = await manager.runSync()

    // Storage is responsible for P0 priority. The manager never has a pull/
    // ack surface, so a Shelf failure cannot precede this delivery.
    expect(pushed).toEqual(["workday-priority", "hrm-first-in-storage"])
    expect(status.phase).toBe("idle")
    expect(queued.every((row) => row.status === "applied")).toBe(true)
  })

  it("keeps a transient delivery failure durable for the dedicated retry loop", async () => {
    const queued = [workday("workday-offline", "2026-08-28T09:00:00.000Z")]
    const manager = new WorkforceSyncManager({
      store: makeStore(queued),
      api: {
        async push() {
          throw new Error("workforce endpoint unavailable")
        },
      },
    })

    const status = await manager.runSync()

    expect(status.phase).toBe("error")
    expect(queued[0]).toMatchObject({ status: "pending", attempts: 1 })
  })

  it("does not consume or attempt durable Workforce operations while offline", async () => {
    const queued = [workday("workday-offline", "2026-08-28T09:00:00.000Z")]
    const push = vi.fn()
    const manager = new WorkforceSyncManager({
      store: makeStore(queued),
      api: { push },
      isOnline: async () => false,
    })

    const status = await manager.runSync()

    expect(status).toMatchObject({ phase: "offline", pendingOps: 1 })
    expect(push).not.toHaveBeenCalled()
    expect(queued[0]).toMatchObject({ status: "pending", attempts: 0 })
  })

  it("replays the same ordered event ids after a lost 503 response and process restart", async () => {
    const queued = [
      workday("event-finish", "2026-08-28T18:00:00.000Z", "FINISH"),
      workday("event-pause", "2026-08-28T12:00:00.000Z", "PAUSE"),
      workday("event-start", "2026-08-28T09:00:00.000Z", "START"),
      workday("event-resume", "2026-08-28T12:30:00.000Z", "RESUME"),
    ]
    const firstAttempt: string[][] = []
    const firstProcess = new WorkforceSyncManager({
      store: makeStore(queued),
      api: {
        async push(operations) {
          firstAttempt.push(operations.map((operation) => operation.clientOpId))
          throw new Error("HTTP 503 after response was lost")
        },
      },
    })

    expect(await firstProcess.runSync()).toMatchObject({ phase: "error", pendingOps: 4 })
    expect(queued.every((row) => row.status === "pending" && row.attempts === 1)).toBe(true)

    const replay: string[][] = []
    const restartedProcess = new WorkforceSyncManager({
      store: makeStore(queued),
      api: {
        async push(operations) {
          replay.push(operations.map((operation) => operation.clientOpId))
          return operations.map((operation) => ({ clientOpId: operation.clientOpId, status: "applied" as const }))
        },
      },
    })
    const status = await restartedProcess.runSync()

    const expectedOrder = ["event-start", "event-pause", "event-resume", "event-finish"]
    expect(firstAttempt).toEqual([expectedOrder])
    expect(replay).toEqual([expectedOrder])
    expect(status).toMatchObject({ phase: "idle", pendingOps: 0 })
    expect(queued.every((row) => row.status === "applied" && row.attempts === 2)).toBe(true)
  })

  it("keeps a two-device winner and conflict independently recoverable", async () => {
    const queued = [
      workday("device-a-start", "2026-08-28T09:00:00.000Z"),
      workday("device-b-start", "2026-08-28T09:00:01.000Z"),
    ]
    const manager = new WorkforceSyncManager({
      store: makeStore(queued),
      api: {
        async push() {
          return [
            { clientOpId: "device-a-start", status: "applied" as const },
            {
              clientOpId: "device-b-start",
              status: "conflict" as const,
              detail: {
                code: "WORKDAY_ALREADY_ACTIVE",
                serverState: { status: "STARTED" },
                allowedActions: ["PAUSE", "FINISH"],
              },
            },
          ]
        },
      },
    })

    const status = await manager.runSync()

    expect(status).toMatchObject({ phase: "idle", pendingOps: 0, conflictOps: 1 })
    expect(queued[0]).toMatchObject({ clientOpId: "device-a-start", status: "applied" })
    expect(queued[1]).toMatchObject({
      clientOpId: "device-b-start",
      status: "conflict",
      detail: { code: "WORKDAY_ALREADY_ACTIVE", allowedActions: ["PAUSE", "FINISH"] },
    })
  })

  it("preserves conflict outcomes for explicit recovery instead of retrying blindly", async () => {
    const queued = [workday("workday-conflict", "2026-08-28T09:00:00.000Z")]
    const manager = new WorkforceSyncManager({
      store: makeStore(queued),
      api: {
        async push(operations) {
          return operations.map((operation) => ({
            clientOpId: operation.clientOpId,
            status: "conflict" as const,
            detail: { error: "workday transition is no longer valid" },
          }))
        },
      },
    })

    const status = await manager.runSync()

    expect(status).toMatchObject({ phase: "idle", conflictOps: 1 })
    expect(queued[0]?.status).toBe("conflict")
  })

  it("moves an exhausted Workforce operation into explicit recovery", async () => {
    const exhausted = workday("workday-exhausted", "2026-08-28T09:00:00.000Z")
    exhausted.attempts = 8
    const manager = new WorkforceSyncManager({
      store: makeStore([exhausted]),
      api: {
        async push() {
          throw new Error("exhausted operations must not be retried")
        },
      },
    })

    const status = await manager.runSync()

    expect(status).toMatchObject({ phase: "idle", pendingOps: 0, rejectedOps: 1 })
    expect(exhausted).toMatchObject({
      status: "rejected",
      attempts: 8,
      detail: { code: "WORKFORCE_RETRY_EXHAUSTED", recoverable: true },
    })
  })
})
