import type { PrismaClient } from "@leadshelf/prisma-client"
import { describe, expect, it, vi } from "vitest"
import { decideHumanReview, ReviewRepoError } from "../repos/reviews.ts"

function prismaMock({
  review = { id: "review-1", taskId: "task-1" },
  blockers = 0,
}: {
  review?: { id: string; taskId: string | null } | null
  blockers?: number
} = {}) {
  const tx = {
    humanReview: {
      findFirst: vi.fn().mockResolvedValue(review),
      update: vi.fn().mockResolvedValue({ id: "review-1", status: "APPROVED" }),
      count: vi.fn().mockResolvedValue(blockers),
    },
    task: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    taskStatusHistory: { create: vi.fn().mockResolvedValue({ id: "history-1" }) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
  }
  const prisma = {
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  } as unknown as PrismaClient
  return { prisma, tx }
}

describe("decideHumanReview", () => {
  it("completes PHOTO_SUBMITTED when the last blocking review is approved", async () => {
    const { prisma, tx } = prismaMock()
    const result = await decideHumanReview(prisma, "org-1", {
      reviewId: "review-1",
      status: "APPROVED",
      reviewedById: "user-1",
    })

    expect(result).toMatchObject({ id: "review-1", status: "APPROVED", taskCompleted: true })
    expect(tx.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-1", organizationId: "org-1", status: "PHOTO_SUBMITTED" },
    }))
    expect(tx.taskStatusHistory.create).toHaveBeenCalledWith({
      data: {
        taskId: "task-1",
        fromStatus: "PHOTO_SUBMITTED",
        toStatus: "COMPLETED",
        byUserId: "user-1",
      },
    })
  })

  it("keeps the task open while another review is pending or rejected", async () => {
    const { prisma, tx } = prismaMock({ blockers: 1 })
    const result = await decideHumanReview(prisma, "org-1", {
      reviewId: "review-1",
      status: "APPROVED",
      reviewedById: "user-1",
    })

    expect(result.taskCompleted).toBe(false)
    expect(tx.task.updateMany).not.toHaveBeenCalled()
  })

  it("rejects a review outside the tenant boundary", async () => {
    const { prisma } = prismaMock({ review: null })
    await expect(decideHumanReview(prisma, "org-2", {
      reviewId: "review-1",
      status: "REJECTED",
      reviewedById: "user-1",
    })).rejects.toEqual(new ReviewRepoError("review_not_found"))
  })
})
