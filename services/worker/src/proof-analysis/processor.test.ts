import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { VISION_PROTOCOL_VERSION, type VisionScanRequest } from "@leadshelf/api-contracts/vision/v1"
import { createSystemClient } from "@leadshelf/db"
import { processNextProofVideoAnalysisJob, type ProofAnalysisStorage } from "./processor"
import type { ExtractedProofFrame, ProofFrameExtractor } from "./frame-extractor"

const prisma = createSystemClient("proof-analysis-worker-test")
const slug = `test-proof-analysis-${Date.now()}`

let orgId: string
let photoSubmissionId: string

class FakeStorage implements ProofAnalysisStorage {
  uploaded: Array<{ key: string; contentType: string; size: number }> = []

  async getObjectBuffer() {
    return { body: Buffer.from("fake-video"), contentType: "video/mp4" }
  }

  async putObjectBuffer(key: string, body: Buffer, contentType: string) {
    this.uploaded.push({ key, contentType, size: body.byteLength })
  }
}

class FakeExtractor implements ProofFrameExtractor {
  async extract(input: { timestampsMs: number[] }): Promise<ExtractedProofFrame[]> {
    return input.timestampsMs.map((timestampMs) => ({
      timestampMs,
      buffer: Buffer.from(`frame-${timestampMs}`),
      contentType: "image/jpeg",
    }))
  }
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: "Proof Analysis Test", slug } })
  orgId = org.id
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "Agent", employeeCode: `${slug}-agent`, role: "FIELD_AGENT" },
  })
  const store = await prisma.store.create({ data: { organizationId: orgId, name: "Store", code: `${slug}-S1` } })
  const planogram = await prisma.planogram.create({ data: { organizationId: orgId, name: "Planogram" } })
  const version = await prisma.planogramVersion.create({
    data: { planogramId: planogram.id, versionNumber: 1, state: "PUBLISHED", publishedAt: new Date() },
  })
  const task = await prisma.task.create({
    data: {
      organizationId: orgId,
      storeId: store.id,
      assigneeId: user.id,
      planogramVersionId: version.id,
      title: "Video proof task",
    },
  })
  const photo = await prisma.photoSubmission.create({
    data: {
      organizationId: orgId,
      storeId: store.id,
      taskId: task.id,
      userId: user.id,
      url: `videos/${orgId}/${task.id}/proof.mp4`,
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      durationMs: 6000,
      clientPhotoId: `${slug}-proof`,
      takenAt: new Date(),
      exif: { qualityCheck: { framePlan: { timestampsMs: [900, 3000, 5100], strategy: "test" } } },
      analysisStatus: "PENDING",
    },
  })
  photoSubmissionId = photo.id
  const reference = await prisma.goldenReference.create({
    data: {
      organizationId: orgId,
      planogramVersionId: version.id,
      imageUrl: `photos/${orgId}/${task.id}/reference.jpg`,
      status: "ACTIVE",
    },
  })
  await prisma.goldenReferenceSlot.create({
    data: {
      goldenReferenceId: reference.id,
      xPct: 10,
      yPct: 20,
      widthPct: 15,
      heightPct: 25,
      label: "SKU-A",
      sortOrder: 1,
    },
  })
})

afterAll(async () => {
  await prisma.humanReview.deleteMany({ where: { organizationId: orgId } })
  await prisma.goldenReferenceSlot.deleteMany({ where: { goldenReference: { organizationId: orgId } } })
  await prisma.goldenReference.deleteMany({ where: { organizationId: orgId } })
  await prisma.photoSubmission.deleteMany({ where: { organizationId: orgId } })
  await prisma.task.deleteMany({ where: { organizationId: orgId } })
  await prisma.planogramVersion.deleteMany({ where: { planogram: { organizationId: orgId } } })
  await prisma.planogram.deleteMany({ where: { organizationId: orgId } })
  await prisma.store.deleteMany({ where: { organizationId: orgId } })
  await prisma.user.deleteMany({ where: { organizationId: orgId } })
  await prisma.organization.delete({ where: { id: orgId } })
  await prisma.$disconnect()
})

describe("proof video analysis worker", () => {
  test("claims video proof, stores selected frames and updates vision review", async () => {
    const storage = new FakeStorage()
    const result = await processNextProofVideoAnalysisJob(prisma, {
      storage,
      extractor: new FakeExtractor(),
      now: () => new Date("2026-07-06T20:30:00.000Z"),
      analyze: async (request: VisionScanRequest, frames: ExtractedProofFrame[]) => ({
        response: {
          protocolVersion: VISION_PROTOCOL_VERSION,
          provider: "fake-ai",
          modelVersion: "fake-model-v1",
          status: "completed",
          detections: [
            {
              slotId: request.slots[0]!.id,
              productId: null,
              productSku: null,
              label: "SKU-A",
              confidence: 0.91,
              bbox: { xPct: 10, yPct: 20, widthPct: 15, heightPct: 25 },
            },
          ],
          embedding: null,
          compliance: {
            score: 0.91,
            status: "PASS",
            totalSlots: 1,
            matchedSlots: 1,
            missingSlots: 0,
            wrongProducts: 0,
            extraDetections: 0,
          },
          findings: { missing: [], wrong: [], extra: [] },
          warnings: [],
        },
        aiFindings: [],
        rawSummary: `frames=${frames.length}`,
      }),
    })

    expect(result).toMatchObject({
      status: "completed",
      photoSubmissionId,
      provider: "fake-ai",
      modelVersion: "fake-model-v1",
    })
    expect(storage.uploaded.map((item) => item.key)).toEqual([
      `frames/${orgId}/${photoSubmissionId}/000900.jpg`,
      `frames/${orgId}/${photoSubmissionId}/003000.jpg`,
      `frames/${orgId}/${photoSubmissionId}/005100.jpg`,
    ])

    const photo = await prisma.photoSubmission.findUniqueOrThrow({ where: { id: photoSubmissionId } })
    expect(photo.analysisStatus).toBe("COMPLETED")
    expect(photo.analysisProvider).toBe("fake-ai")

    const review = await prisma.humanReview.findFirstOrThrow({
      where: { organizationId: orgId, photoSubmissionId, reason: "VISION_COMPLIANCE" },
    })
    expect(review.score).toBe(0.91)
    expect(review.findings).toMatchObject({
      vision: {
        workerStatus: "completed",
        provider: "fake-ai",
        modelVersion: "fake-model-v1",
        selectedFrames: [
          { key: `frames/${orgId}/${photoSubmissionId}/000900.jpg`, timestampMs: 900 },
          { key: `frames/${orgId}/${photoSubmissionId}/003000.jpg`, timestampMs: 3000 },
          { key: `frames/${orgId}/${photoSubmissionId}/005100.jpg`, timestampMs: 5100 },
        ],
      },
    })
  })
})
