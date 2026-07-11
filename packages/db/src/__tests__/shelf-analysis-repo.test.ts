import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { createSystemClient } from "../tenant-client.ts"
import {
  finishShelfAnalysisRun,
  readLatestShelfAnalysis,
  saveManualShelfAnalysis,
  ShelfAnalysisRepoError,
  startShelfAnalysisRun,
} from "../repos/shelf-analysis.ts"

const prisma = createSystemClient("shelf-analysis-repo-test")
const slug = `test-shelf-analysis-${Date.now()}`

let organizationId: string
let otherOrganizationId: string
let taskId: string
let photoSubmissionId: string
let planogramVersionId: string
let reviewId: string
let userId: string
let storeId: string

beforeAll(async () => {
  const organization = await prisma.organization.create({ data: { name: "Shelf Analysis Test", slug } })
  const other = await prisma.organization.create({ data: { name: "Shelf Analysis Other", slug: `${slug}-other` } })
  organizationId = organization.id
  otherOrganizationId = other.id

  const user = await prisma.user.create({
    data: { organizationId, name: "Reviewer", email: `${slug}@example.com`, role: "SUPERVISOR" },
  })
  userId = user.id
  const store = await prisma.store.create({
    data: { organizationId, name: "Analysis Store", code: `${slug}-store` },
  })
  storeId = store.id
  const planogram = await prisma.planogram.create({ data: { organizationId, name: "Analysis Planogram" } })
  const version = await prisma.planogramVersion.create({
    data: { planogramId: planogram.id, versionNumber: 1, state: "PUBLISHED", publishedAt: new Date() },
  })
  planogramVersionId = version.id
  const task = await prisma.task.create({
    data: {
      organizationId,
      storeId: store.id,
      assigneeId: user.id,
      planogramVersionId,
      title: "Analyze shelf",
    },
  })
  taskId = task.id
  const photo = await prisma.photoSubmission.create({
    data: {
      organizationId,
      storeId: store.id,
      taskId,
      userId: user.id,
      url: `photos/${organizationId}/analysis.jpg`,
      clientPhotoId: `${slug}-photo`,
      takenAt: new Date(),
    },
  })
  photoSubmissionId = photo.id
  const review = await prisma.humanReview.create({
    data: {
      organizationId,
      reason: "VISION_COMPLIANCE",
      taskId,
      photoSubmissionId,
      planogramVersionId,
      score: 0.42,
      findings: { vision: { provider: "legacy", status: "needs_human_review" } },
    },
  })
  reviewId = review.id
})

afterAll(async () => {
  await prisma.shelfAnalysisRun.deleteMany({ where: { organizationId } })
  await prisma.humanReview.deleteMany({ where: { organizationId } })
  await prisma.photoSubmission.deleteMany({ where: { organizationId } })
  await prisma.task.deleteMany({ where: { organizationId } })
  await prisma.planogramVersion.deleteMany({ where: { planogram: { organizationId } } })
  await prisma.planogram.deleteMany({ where: { organizationId } })
  await prisma.store.deleteMany({ where: { organizationId } })
  await prisma.user.deleteMany({ where: { organizationId } })
  await prisma.organization.delete({ where: { id: organizationId } })
  await prisma.organization.delete({ where: { id: otherOrganizationId } })
  await prisma.$disconnect()
})

describe("shelf analysis repository", () => {
  test("reads legacy HumanReview findings before a canonical run exists", async () => {
    const latest = await readLatestShelfAnalysis(prisma, organizationId, photoSubmissionId)
    expect(latest).toMatchObject({
      source: "LEGACY_REVIEW",
      reviewId,
      score: 0.42,
      findings: { vision: { provider: "legacy" } },
    })
  })

  test("persists a run idempotently and promotes its completed result", async () => {
    const input = {
      photoSubmissionId,
      taskId,
      planogramVersionId,
      humanReviewId: reviewId,
      idempotencyKey: "auto:photo:v1",
      inputHash: "hash-v1",
      provider: "test-provider",
      modelVersion: "model-v1",
      comparisonVersion: 1,
      input: { photoSubmissionId, expected: ["SKU-1"] },
      startedAt: new Date("2026-07-11T08:00:00.000Z"),
    } as const
    const first = await startShelfAnalysisRun(prisma, organizationId, input)
    const duplicate = await startShelfAnalysisRun(prisma, organizationId, input)
    expect(first.created).toBe(true)
    expect(duplicate).toMatchObject({ created: false, run: { id: first.run.id } })

    const finished = await finishShelfAnalysisRun(prisma, organizationId, {
      runId: first.run.id,
      status: "REVIEW",
      result: { status: "REVIEW", structuralScore: 72 },
      warnings: ["manual_confirmation_required"],
      finishedAt: new Date("2026-07-11T08:01:00.000Z"),
    })
    expect(finished).toMatchObject({ isCanonical: true, status: "REVIEW" })
    expect(await prisma.shelfAnalysisRun.count({ where: { organizationId } })).toBe(1)
  })

  test("keeps a manual result canonical when a later automatic run completes", async () => {
    const manual = await saveManualShelfAnalysis(prisma, organizationId, {
      reviewId,
      reviewedById: (await prisma.user.findFirstOrThrow({ where: { organizationId } })).id,
      annotations: [],
    })
    expect(manual.run).toMatchObject({ source: "MANUAL", isCanonical: true, provider: "manual" })
    expect(await prisma.auditLog.count({
      where: { organizationId, action: "shelf_analysis.manual_saved", entityId: manual.run.id },
    })).toBe(1)

    const auto = await startShelfAnalysisRun(prisma, organizationId, {
      photoSubmissionId,
      taskId,
      planogramVersionId,
      idempotencyKey: "auto:photo:v2",
      inputHash: "hash-v2",
      provider: "test-provider",
      modelVersion: "model-v2",
      comparisonVersion: 1,
      input: { photoSubmissionId, expected: ["SKU-1"] },
      startedAt: new Date("2026-07-11T08:03:00.000Z"),
    })
    const finishedAuto = await finishShelfAnalysisRun(prisma, organizationId, {
      runId: auto.run.id,
      status: "COMPLETED",
      result: { status: "FAIL", structuralScore: 0 },
    })
    expect(finishedAuto.isCanonical).toBe(false)

    const latest = await readLatestShelfAnalysis(prisma, organizationId, photoSubmissionId)
    expect(latest).toMatchObject({
      source: "RUN",
      run: { id: manual.run.id, source: "MANUAL", isCanonical: true },
    })
  })

  test("rejects cross-tenant source references", async () => {
    await expect(
      startShelfAnalysisRun(prisma, otherOrganizationId, {
        photoSubmissionId,
        idempotencyKey: "cross-tenant",
        inputHash: "cross-tenant",
        provider: "test",
        modelVersion: "test",
        comparisonVersion: 1,
        input: {},
      }),
    ).rejects.toEqual(new ShelfAnalysisRepoError("analysis_reference_not_found"))
  })

  test("serializes concurrent AUTO and MANUAL finishes so manual always wins", async () => {
    const photo = await prisma.photoSubmission.create({
      data: {
        organizationId,
        storeId,
        taskId,
        userId,
        url: `photos/${organizationId}/race.jpg`,
        clientPhotoId: `${slug}-race-photo`,
        takenAt: new Date(),
      },
    })
    const base = {
      photoSubmissionId: photo.id,
      taskId,
      planogramVersionId,
      comparisonVersion: 1,
      input: {},
      startedAt: new Date(),
    }
    const auto = await startShelfAnalysisRun(prisma, organizationId, {
      ...base,
      idempotencyKey: "race-auto",
      inputHash: "race-auto",
      provider: "auto",
      modelVersion: "auto-v1",
    })
    const manual = await startShelfAnalysisRun(prisma, organizationId, {
      ...base,
      source: "MANUAL",
      idempotencyKey: "race-manual",
      inputHash: "race-manual",
      provider: "manual",
      modelVersion: "manual-v1",
    })
    await Promise.all([
      finishShelfAnalysisRun(prisma, organizationId, { runId: auto.run.id, status: "COMPLETED", result: { status: "FAIL" } }),
      finishShelfAnalysisRun(prisma, organizationId, { runId: manual.run.id, status: "COMPLETED", result: { status: "PASS" } }),
    ])
    expect(await prisma.shelfAnalysisRun.findFirstOrThrow({ where: { id: manual.run.id } })).toMatchObject({ isCanonical: true })
    expect(await prisma.shelfAnalysisRun.findFirstOrThrow({ where: { id: auto.run.id } })).toMatchObject({ isCanonical: false })
  })
})
