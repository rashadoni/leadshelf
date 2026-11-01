import type { PrismaClient } from "@leadshelf/prisma-client"
import { describe, expect, test, vi } from "vitest"
import { pushOperations } from "../repos/mobile-sync.ts"

function buildPrismaMock(overrides: Record<string, unknown> = {}) {
  return {
    outboxOperation: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    task: {
      findFirst: vi.fn().mockResolvedValue({ id: "task-1", storeId: "store-1", title: "Выкладка OTC" }),
    },
    captureStepException: {
      create: vi.fn().mockResolvedValue({ id: "exception-1" }),
    },
    productEvent: {
      // dedupe hit -> emitProductEvent возвращает существующее событие
      findFirst: vi.fn().mockResolvedValue({ id: "event-1", alert: { id: "alert-1" } }),
    },
    ...overrides,
  } as unknown as PrismaClient
}

describe("proof.exception push operation", () => {
  test("stores the exception and reports applied for an assigned task", async () => {
    const prisma = buildPrismaMock()
    const results = await pushOperations(prisma, "org-a", "user-1", "device-1", [
      {
        clientOpId: "op-exception-1",
        kind: "proof.exception",
        payload: {
          taskId: "task-1",
          stepId: "left-depth",
          stepKind: "left_depth",
          reason: "obstruction",
          note: "Паллета перекрывает проход",
        },
      },
    ])

    expect(results).toEqual([
      { clientOpId: "op-exception-1", status: "applied", detail: { exceptionId: "exception-1" } },
    ])
    const mocked = prisma as unknown as {
      captureStepException: { create: ReturnType<typeof vi.fn> }
      outboxOperation: { create: ReturnType<typeof vi.fn> }
    }
    expect(mocked.captureStepException.create).toHaveBeenCalledWith({
      data: {
        organizationId: "org-a",
        taskId: "task-1",
        userId: "user-1",
        stepId: "left-depth",
        stepKind: "left_depth",
        reason: "obstruction",
        note: "Паллета перекрывает проход",
      },
      select: { id: true },
    })
    expect(mocked.outboxOperation.create).toHaveBeenCalled()
  })

  test("rejects when the task is not assigned to the pushing user", async () => {
    const prisma = buildPrismaMock({
      task: { findFirst: vi.fn().mockResolvedValue(null) },
    })
    const results = await pushOperations(prisma, "org-a", "user-2", "device-1", [
      {
        clientOpId: "op-exception-2",
        kind: "proof.exception",
        payload: { taskId: "task-9", stepId: "front", reason: "no_access" },
      },
    ])
    expect(results[0]).toMatchObject({ status: "rejected", detail: "task_not_found_or_not_assigned" })
  })
})
