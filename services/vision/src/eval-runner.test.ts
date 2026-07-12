import { VISION_PROTOCOL_VERSION } from "@leadshelf/api-contracts/vision/v1"
import { describe, expect, it, vi } from "vitest"
import { visionEvalManifestSchema } from "./evaluation"
import { runVisionEval } from "./eval-runner"
import { GEMINI_PROVIDER, ReferenceSlotStubProvider, type VisionProvider } from "./provider"

const boxA = { xPct: 0, yPct: 0, widthPct: 20, heightPct: 20 }
const boxB = { xPct: 30, yPct: 0, widthPct: 20, heightPct: 20 }

const manifest = visionEvalManifestSchema.parse({
  version: 1,
  datasetId: "pilot-v1",
  createdAt: "2026-07-12T00:00:00.000Z",
  samples: [
    {
      id: "golden",
      split: "calibration",
      scenario: "golden",
      photoRef: "private://pilot-v1/images/golden.png",
      goldenReferenceRef: null,
      planogramVersionId: "planogram-v1",
      annotations: [
        { id: "slot-a", productSku: "SKU-A", bbox: boxA, facings: 1 },
        { id: "slot-b", productSku: "SKU-B", bbox: boxB, facings: 1 },
      ],
    },
    {
      id: "missing",
      split: "calibration",
      scenario: "missing_sku",
      photoRef: "private://pilot-v1/images/missing.png",
      goldenReferenceRef: "private://pilot-v1/images/golden.png",
      planogramVersionId: "planogram-v1",
      annotations: [{ id: "slot-a", productSku: "SKU-A", bbox: boxA, facings: 1 }],
    },
  ],
})

function successfulProvider(): VisionProvider {
  return {
    metadata: { provider: "deterministic-test", modelVersion: "test-v1" },
    async scan(request) {
      const slots = request.photoSubmissionId === "missing" ? request.slots.slice(0, 1) : request.slots
      return {
        protocolVersion: VISION_PROTOCOL_VERSION,
        provider: "deterministic-test",
        modelVersion: "test-v1",
        status: "completed",
        detections: slots.map((slot) => ({
          slotId: slot.id,
          productId: slot.productId,
          productSku: slot.productSku,
          label: slot.label,
          confidence: 0.9,
          bbox: {
            xPct: slot.xPct,
            yPct: slot.yPct,
            widthPct: slot.widthPct,
            heightPct: slot.heightPct,
          },
        })),
        embedding: null,
        compliance: {
          score: 1,
          status: "PASS",
          totalSlots: slots.length,
          matchedSlots: slots.length,
          missingSlots: 0,
          wrongProducts: 0,
          extraDetections: 0,
        },
        findings: { missing: [], wrong: [], extra: [] },
        warnings: [],
      }
    },
  }
}

describe("vision eval runner", () => {
  it("runs every private manifest sample and aggregates reproducible metrics", async () => {
    const report = await runVisionEval({
      manifest,
      provider: successfulProvider(),
      resolvePhotoRef: (photoRef) => `data:image/png;base64,${Buffer.from(photoRef).toString("base64")}`,
      now: () => new Date("2026-07-12T01:00:00.000Z"),
      clockMs: (() => {
        let value = 0
        return () => value += 10
      })(),
    })

    expect(report).toMatchObject({
      datasetId: "pilot-v1",
      provider: "deterministic-test",
      modelVersion: "test-v1",
      generatedAt: "2026-07-12T01:00:00.000Z",
      costUsd: null,
      overallMetrics: { expected: 3, detected: 3, localized: 3, skuCorrect: 3 },
      calibration: {
        eligible: true,
        blockedReason: null,
        sampleCount: 2,
        recommendedMinConfidence: 0.9,
        validationRequired: true,
      },
    })
    expect(report.samples).toHaveLength(2)
    expect(report.samples.every((sample) => sample.durationMs === 10)).toBe(true)
    expect(report.scenarioMetrics.missing_sku).toMatchObject({ expected: 1, skuCorrect: 1 })
  })

  it("requires an explicit privacy gate before calling an external provider", async () => {
    const scan = vi.fn()
    const provider: VisionProvider = {
      metadata: { provider: GEMINI_PROVIDER, modelVersion: "gemini-test" },
      scan,
    }

    await expect(runVisionEval({
      manifest,
      provider,
      resolvePhotoRef: (photoRef) => photoRef,
    })).rejects.toThrow("external_vision_provider_requires_allow_external")
    expect(scan).not.toHaveBeenCalled()
  })

  it("does not recommend a threshold from the no-inference stub", async () => {
    const report = await runVisionEval({
      manifest,
      provider: new ReferenceSlotStubProvider(),
      resolvePhotoRef: (photoRef) => photoRef,
    })

    expect(report.calibration).toMatchObject({
      eligible: false,
      blockedReason: "stub_provider",
      recommendedMinConfidence: null,
      thresholdSweep: [],
    })
  })
})
