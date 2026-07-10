import type { PrismaClient } from "@prisma/client"

export type HumanReviewDecision = "APPROVED" | "REJECTED"

export class ReviewRepoError extends Error {
  constructor(public code: "review_not_found") {
    super(code)
  }
}

/**
 * Решение по review и завершение задачи образуют одну транзакцию.
 * Последний одобренный review завершает PHOTO_SUBMITTED только если у
 * задачи больше нет pending/rejected проверок.
 */
export async function decideHumanReview(
  prisma: PrismaClient,
  organizationId: string,
  input: {
    reviewId: string
    status: HumanReviewDecision
    reviewedById: string
    note?: string
  },
) {
  return prisma.$transaction(async (tx) => {
    const review = await tx.humanReview.findFirst({
      where: { id: input.reviewId, organizationId },
      select: { id: true, taskId: true },
    })
    if (!review) throw new ReviewRepoError("review_not_found")

    const reviewedAt = new Date()
    const updated = await tx.humanReview.update({
      where: { id: review.id },
      data: {
        status: input.status,
        note: input.note,
        reviewedById: input.reviewedById,
        reviewedAt,
      },
      select: { id: true, status: true },
    })

    let taskCompleted = false
    if (input.status === "APPROVED" && review.taskId) {
      const blockingReviews = await tx.humanReview.count({
        where: {
          taskId: review.taskId,
          id: { not: review.id },
          status: { in: ["PENDING", "REJECTED"] },
        },
      })
      if (blockingReviews === 0) {
        const completed = await tx.task.updateMany({
          where: { id: review.taskId, organizationId, status: "PHOTO_SUBMITTED" },
          data: { status: "COMPLETED", completedAt: reviewedAt },
        })
        if (completed.count === 1) {
          await tx.taskStatusHistory.create({
            data: {
              taskId: review.taskId,
              fromStatus: "PHOTO_SUBMITTED",
              toStatus: "COMPLETED",
              byUserId: input.reviewedById,
            },
          })
          taskCompleted = true
        }
      }
    }

    return { ...updated, taskCompleted }
  })
}
