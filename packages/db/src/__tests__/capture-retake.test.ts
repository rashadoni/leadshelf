import type { PrismaClient } from "@prisma/client"
import { describe, expect, test, vi } from "vitest"
import {
  CaptureRepoError,
  listOpenCaptureRetakes,
  requestCaptureRetake,
  resolveCaptureRetakesForStep,
} from "../repos/capture.ts"

describe("capture retake repo", () => {
  test("upserts an open retake request and bumps the task for delivery", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "retake-1", stepId: "front", requestedAt: new Date() })
    const taskUpdate = vi.fn().mockResolvedValue({ id: "task-1" })
    const prisma = {
      task: { findFirst: vi.fn().mockResolvedValue({ id: "task-1" }), update: taskUpdate },
      captureRetakeRequest: { upsert },
      // array-form $transaction: выполняем переданные операции
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaClient

    const result = await requestCaptureRetake(prisma, "org-a", {
      taskId: "task-1",
      stepId: "front",
      stepKind: "front",
      note: "  Логотип не фронтом  ",
      requestedById: "user-1",
    })

    expect(result.id).toBe("retake-1")
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_taskId_stepId: { organizationId: "org-a", taskId: "task-1", stepId: "front" },
        },
        create: expect.objectContaining({ note: "Логотип не фронтом" }),
        update: expect.objectContaining({ resolvedAt: null }),
      }),
    )
    // задача переотдаётся на следующем pull только если updatedAt сдвинут
    expect(taskUpdate).toHaveBeenCalledWith({ where: { id: "task-1" }, data: { updatedAt: expect.any(Date) } })
  })

  test("rejects a retake for a task outside the organization", async () => {
    const prisma = {
      task: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
      captureRetakeRequest: { upsert: vi.fn() },
      $transaction: vi.fn(),
    } as unknown as PrismaClient

    await expect(
      requestCaptureRetake(prisma, "org-a", {
        taskId: "task-x",
        stepId: "front",
        requestedById: "user-1",
      }),
    ).rejects.toBeInstanceOf(CaptureRepoError)
  })

  test("resolves open retakes for the step and re-delivers the task when something closed", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const taskUpdate = vi.fn().mockResolvedValue({ id: "task-1" })
    const tx = { captureRetakeRequest: { updateMany }, task: { update: taskUpdate } }
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<number>) => fn(tx)),
    } as unknown as PrismaClient

    const count = await resolveCaptureRetakesForStep(prisma, "org-a", "task-1", "left-depth")
    expect(count).toBe(1)
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a", taskId: "task-1", stepId: "left-depth", resolvedAt: null },
      }),
    )
    expect(taskUpdate).toHaveBeenCalledWith({ where: { id: "task-1" }, data: { updatedAt: expect.any(Date) } })
  })

  test("does not touch the task when no retake was open", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const taskUpdate = vi.fn()
    const tx = { captureRetakeRequest: { updateMany }, task: { update: taskUpdate } }
    const prisma = {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<number>) => fn(tx)),
    } as unknown as PrismaClient

    expect(await resolveCaptureRetakesForStep(prisma, "org-a", "task-1", "front")).toBe(0)
    expect(taskUpdate).not.toHaveBeenCalled()
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
