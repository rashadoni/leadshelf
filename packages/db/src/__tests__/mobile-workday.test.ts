import type { PrismaClient } from "@leadshelf/prisma-client"
import { describe, expect, test, vi } from "vitest"
import { pushOperations } from "../repos/mobile-sync.ts"

function basePrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    fieldAgent: {
      findFirst: vi.fn().mockResolvedValue({ id: "agent-1", userId: "user-1" }),
    },
    agentWorkdayEvent: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    agentWorkday: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "mobile-workday-1" }),
      update: vi.fn().mockResolvedValue({ id: "mobile-workday-1" }),
    },
    outboxOperation: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  } as Record<string, unknown>
  prisma.$transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma))
  return prisma as unknown as PrismaClient
}

describe("mobile workday push operation", () => {
  test("starts a workday and records an idempotent event", async () => {
    const prisma = basePrisma()
    const result = await pushOperations(prisma, "org-1", "user-1", "device-1", [{
      clientOpId: "workday-op-start-1",
      kind: "workday.event",
      clientCreatedAt: "2026-08-12T08:00:00.000Z",
      payload: {
        workdayId: "mobile-workday-1",
        action: "START",
        workDate: "2026-08-12",
        occurredAt: "2026-08-12T08:00:00.000Z",
        latitude: 40.4093,
        longitude: 49.8671,
      },
    }])

    expect(result).toEqual([{
      clientOpId: "workday-op-start-1",
      status: "applied",
      detail: { workdayId: "mobile-workday-1", serverStatus: "STARTED" },
    }])
    const mocked = prisma as unknown as {
      agentWorkday: { create: ReturnType<typeof vi.fn> }
      outboxOperation: { create: ReturnType<typeof vi.fn> }
    }
    expect(mocked.agentWorkday.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: "mobile-workday-1",
        status: "STARTED",
        events: { create: expect.objectContaining({ clientEventId: "workday-op-start-1", type: "START" }) },
      }),
    }))
    expect(mocked.outboxOperation.create).toHaveBeenCalledOnce()
  })

  test("returns an existing event without changing the aggregate", async () => {
    const prisma = basePrisma({
      agentWorkdayEvent: {
        findUnique: vi.fn().mockResolvedValue({ workdayId: "mobile-workday-1", type: "START" }),
      },
    })
    const result = await pushOperations(prisma, "org-1", "user-1", "device-1", [{
      clientOpId: "workday-op-replay-1",
      kind: "workday.event",
      payload: {
        workdayId: "mobile-workday-1",
        action: "START",
        workDate: "2026-08-12",
        occurredAt: "2026-08-12T08:00:00.000Z",
      },
    }])

    expect(result[0]).toMatchObject({
      status: "already_applied",
      detail: { workdayId: "mobile-workday-1", action: "START" },
    })
    const mocked = prisma as unknown as { agentWorkday: { create: ReturnType<typeof vi.fn> } }
    expect(mocked.agentWorkday.create).not.toHaveBeenCalled()
  })

  test("pauses a started workday", async () => {
    const current = {
      id: "mobile-workday-1",
      status: "STARTED",
      startedAt: new Date("2026-08-12T08:00:00.000Z"),
      pausedAt: null,
      completedAt: null,
      totalPausedSeconds: 0,
      endLatitude: null,
      endLongitude: null,
      events: [{ occurredAt: new Date("2026-08-12T08:00:00.000Z") }],
    }
    const prisma = basePrisma({
      agentWorkday: {
        findFirst: vi.fn().mockResolvedValue(current),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: current.id }),
      },
    })
    const result = await pushOperations(prisma, "org-1", "user-1", "device-1", [{
      clientOpId: "workday-op-pause-1",
      kind: "workday.event",
      payload: {
        workdayId: current.id,
        action: "PAUSE",
        workDate: "2026-08-12",
        occurredAt: "2026-08-12T10:00:00.000Z",
      },
    }])

    expect(result[0]).toMatchObject({ status: "applied", detail: { serverStatus: "PAUSED" } })
    const mocked = prisma as unknown as { agentWorkday: { update: ReturnType<typeof vi.fn> } }
    expect(mocked.agentWorkday.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PAUSED", pausedAt: new Date("2026-08-12T10:00:00.000Z") }),
    }))
  })
})
