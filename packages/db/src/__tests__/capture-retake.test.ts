import type { PrismaClient } from "@prisma/client"
import { describe, expect, test, vi } from "vitest"
import {
  CaptureRepoError,
  listOpenCaptureRetakes,
  requestCaptureRetake,
  resolveCaptureRetakesForStep,
} from "../repos/capture.ts"

describe("capture retake repo", () => {
  test("upserts an open retake request for an org-scoped task", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "retake-1", stepId: "front", requestedAt: new Date() })
    const prisma = {
      task: { findFirst: vi.fn().mockResolvedValue({ id: "task-1" }) },
      captureRetakeRequest: { upsert },
    } as unknown as PrismaClient

    const result = await requestCaptureRetake(prisma, "org-a", {
      taskId: "task-1",
      stepId: "front",
      stepKind: "front",
      note: "  Логотип не фронтом  ",
      requestedById: "user-1",
    })

    expect(result.id).toBe("retake-1")
    const args = upsert.mock.calls[0][0]
    expect(args.where).toEqual({
      organizationId_taskId_stepId: { organizationId: "org-a", taskId: "task-1", stepId: "front" },
    })
    expect(args.create.note).toBe("Логотип не фронтом")
    expect(args.update.resolvedAt).toBeNull()
  })

  test("rejects a retake for a task outside the organization", async () => {
    const prisma = {
      task: { findFirst: vi.fn().mockResolvedValue(null) },
      captureRetakeRequest: { upsert: vi.fn() },
    } as unknown as PrismaClient

    await expect(
      requestCaptureRetake(prisma, "org-a", {
        taskId: "task-x",
        stepId: "front",
        requestedById: "user-1",
      }),
    ).rejects.toBeInstanceOf(CaptureRepoError)
  })

  test("resolves open retakes for the submitted step only", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const prisma = { captureRetakeRequest: { updateMany } } as unknown as PrismaClient

    const count = await resolveCaptureRetakesForStep(prisma, "org-a", "task-1", "left-depth")
    expect(count).toBe(1)
    expect(updateMany.mock.calls[0][0].where).toEqual({
      organizationId: "org-a",
      taskId: "task-1",
      stepId: "left-depth",
      resolvedAt: null,
    })
  })

  test("groups open retakes by task for sync pull", async () => {
    const prisma = {
      captureRetakeRequest: {
        findMany: vi.fn().mockResolvedValue([
          {
            taskId: "task-1",
            stepId: "front",
            stepKind: "front",
            note: "Переснять фронт",
            requestedAt: new Date("2026-07-07T10:00:00.000Z"),
          },
          {
            taskId: "task-1",
            stepId: "detail",
            stepKind: "detail",
            note: null,
            requestedAt: new Date("2026-07-07T10:05:00.000Z"),
          },
        ]),
      },
    } as unknown as PrismaClient

    const byTask = await listOpenCaptureRetakes(prisma, "org-a", ["task-1", "task-2"])
    expect(byTask.get("task-1")).toHaveLength(2)
    expect(byTask.get("task-1")?.[0]).toEqual({
      taskId: "task-1",
      stepId: "front",
      stepKind: "front",
      note: "Переснять фронт",
      requestedAt: "2026-07-07T10:00:00.000Z",
    })
    expect(byTask.has("task-2")).toBe(false)
  })

  test("returns an empty map without task ids", async () => {
    const findMany = vi.fn()
    const prisma = { captureRetakeRequest: { findMany } } as unknown as PrismaClient
    const byTask = await listOpenCaptureRetakes(prisma, "org-a", [])
    expect(byTask.size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})
