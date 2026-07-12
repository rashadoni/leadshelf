import { VISION_PROTOCOL_VERSION } from "@leadshelf/api-contracts/vision/v1"
import { describe, expect, it, vi } from "vitest"
import { visionEvalManifestSchema, type ShelfLocalizer } from "./evaluation"
import { runVisionEval } from "./eval-runner"
import {
  GEMINI_PROVIDER,
  ReferenceSlotStubProvider,
  StubShelfSkuRecognizer,
  type ShelfSkuRecognizerWithWarnings,
  type VisionProvider,
} from "./provider"

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

function cannedRecognizer(
  answers: Record<string, { productSku: string | null; confidence: number }>,
  provider = "deterministic-recognizer",
): ShelfSkuRecognizerWithWarnings {
  return {
    provider,
    modelVersion: "recognizer-v1",
    async recognizeDetailed(_photoRef, boxes) {
      return {
        assignments: boxes.map((box) => ({
          id: box.id,
          productSku: answers[box.id]?.productSku ?? null,
          confidence: answers[box.id]?.confidence ?? 0,
        })),
        warnings: ["canned"],
      }
    },
    async recognize(photoRef, boxes, catalogSkus) {
      return (await this.recognizeDetailed(photoRef, boxes, catalogSkus)).assignments
    },
  }
}

describe("oracle_boxes mode", () => {
  it("изолирует SKU-классификацию: localization по построению = 1.0", async () => {
    const report = await runVisionEval({
      manifest,
      mode: "oracle_boxes",
      recognizer: cannedRecognizer({
        "slot-a": { productSku: "SKU-A", confidence: 0.9 }, // верно
        "slot-b": { productSku: null, confidence: 0.2 }, // не уверен
      }),
      resolvePhotoRef: (photoRef) => photoRef,
    })

    expect(report.mode).toBe("oracle_boxes")
    expect(report.provider).toBe("deterministic-recognizer")
    expect(report.modelVersion).toBe("recognizer-v1")
    // golden-сэмпл: 2 бокса, 1 SKU верно; missing-сэмпл: 1 бокс (slot-a) верно.
    expect(report.overallMetrics).toMatchObject({
      expected: 3,
      detected: 3,
      localized: 3,
      skuCorrect: 2,
      localizationPrecision: 1,
      localizationRecall: 1,
      meanIou: 1,
    })
    expect(report.samples.every((sample) => sample.warnings.includes("canned"))).toBe(true)
  })

  it("требует recognizer и уважает privacy gate для внешнего recognizer", async () => {
    await expect(runVisionEval({
      manifest,
      mode: "oracle_boxes",
      resolvePhotoRef: (photoRef) => photoRef,
    })).rejects.toThrow("vision_eval_mode_requires_recognizer")

    await expect(runVisionEval({
      manifest,
      mode: "oracle_boxes",
      recognizer: cannedRecognizer({}, GEMINI_PROVIDER),
      resolvePhotoRef: (photoRef) => photoRef,
    })).rejects.toThrow("external_vision_provider_requires_allow_external")
  })

  it("stub-recognizer не может дать calibration и accuracy-claims", async () => {
    const report = await runVisionEval({
      manifest,
      mode: "oracle_boxes",
      recognizer: new StubShelfSkuRecognizer(),
      resolvePhotoRef: (photoRef) => photoRef,
    })
    expect(report.calibration.blockedReason).toBe("stub_provider")
    expect(report.accuracyClaims).toMatchObject({ allowed: false, blockedReason: "stub_provider" })
  })
})

describe("split discipline", () => {
  it("фильтрует сплиты и фиксирует requested/included/testIncluded в отчёте", async () => {
    const report = await runVisionEval({
      manifest, // оба сэмпла в calibration
      provider: successfulProvider(),
      splits: ["validation", "test"],
      resolvePhotoRef: (photoRef) => photoRef,
    })
    expect(report.samples).toHaveLength(0)
    expect(report.requestedSplits).toEqual(["validation", "test"])
    expect(report.includedSplits).toEqual([])
    expect(report.testIncluded).toBe(false)
    expect(report.overallMetrics).toBeNull()
    // sweep жёстко calibration-only: calibration исключён -> нет сэмплов.
    expect(report.calibration.blockedReason).toBe("no_calibration_samples")
  })
})

describe("accuracy claims gate", () => {
  const bbox = { xPct: 0, yPct: 0, widthPct: 20, heightPct: 20 }

  function manifestWithRealValidation(count: number) {
    return visionEvalManifestSchema.parse({
      version: 1,
      datasetId: "expanded-v1",
      createdAt: "2026-07-12T00:00:00.000Z",
      samples: [
        {
          id: "golden",
          split: "calibration",
          photoRef: "private://expanded-v1/photos/golden.png",
          goldenReferenceRef: null,
          planogramVersionId: "version-1",
          annotations: [{ id: "slot-a", productSku: "SKU-A", bbox, facings: 1 }],
        },
        ...Array.from({ length: count }, (_, index) => ({
          id: `real-${index}`,
          split: "validation",
          photoRef: `private://expanded-v1/photos/real-${index}.jpg`,
          goldenReferenceRef: "private://expanded-v1/photos/golden.png",
          planogramVersionId: "version-1",
          sourceKind: "real",
          annotations: [{ id: "slot-a", productSku: "SKU-A", bbox, facings: 1 }],
        })),
      ],
    })
  }

  it("блокирует claims при недостатке реальных validation-сэмплов и разрешает при достатке", async () => {
    const recognizer = cannedRecognizer({ "slot-a": { productSku: "SKU-A", confidence: 0.9 } })

    const small = await runVisionEval({
      manifest: manifestWithRealValidation(5),
      mode: "oracle_boxes",
      recognizer,
      resolvePhotoRef: (photoRef) => photoRef,
    })
    expect(small.accuracyClaims).toMatchObject({
      allowed: false,
      blockedReason: "insufficient_real_validation_samples",
      realValidationSampleCount: 5,
      minimumRequired: 20,
    })

    const enough = await runVisionEval({
      manifest: manifestWithRealValidation(20),
      mode: "oracle_boxes",
      recognizer,
      resolvePhotoRef: (photoRef) => photoRef,
    })
    expect(enough.accuracyClaims).toMatchObject({
      allowed: true,
      blockedReason: null,
      realValidationSampleCount: 20,
    })
  })

  it("synthetic-сэмплы не учитываются в accuracy-claims", async () => {
    const manifestSynthetic = visionEvalManifestSchema.parse({
      version: 1,
      datasetId: "synthetic-v1",
      createdAt: "2026-07-12T00:00:00.000Z",
      samples: [
        {
          id: "golden",
          split: "calibration",
          photoRef: "private://synthetic-v1/photos/golden.png",
          goldenReferenceRef: null,
          planogramVersionId: "version-1",
          annotations: [{ id: "slot-a", productSku: "SKU-A", bbox, facings: 1 }],
        },
        ...Array.from({ length: 25 }, (_, index) => ({
          id: `synthetic-${index}`,
          split: "validation",
          photoRef: `private://synthetic-v1/photos/synthetic-${index}.png`,
          goldenReferenceRef: "private://synthetic-v1/photos/golden.png",
          planogramVersionId: "version-1",
          sourceKind: "synthetic",
          annotations: [{ id: "slot-a", productSku: "SKU-A", bbox, facings: 1 }],
        })),
      ],
    })
    const report = await runVisionEval({
      manifest: manifestSynthetic,
      mode: "oracle_boxes",
      recognizer: cannedRecognizer({ "slot-a": { productSku: "SKU-A", confidence: 0.9 } }),
      resolvePhotoRef: (photoRef) => photoRef,
    })
    expect(report.accuracyClaims).toMatchObject({
      allowed: false,
      blockedReason: "insufficient_real_validation_samples",
      realValidationSampleCount: 0,
    })
  })
})

describe("two_stage mode", () => {
  it("прогоняет localizer -> recognizer и помечает связку в отчёте", async () => {
    const bbox = { xPct: 0, yPct: 0, widthPct: 20, heightPct: 20 }
    const localizer: ShelfLocalizer = {
      provider: "stub-localizer",
      modelVersion: "localizer-v1",
      localize: vi.fn().mockResolvedValue([{ id: "box-1", confidence: 0.9, bbox }]),
    }
    const report = await runVisionEval({
      manifest,
      mode: "two_stage",
      localizer,
      recognizer: cannedRecognizer({ "box-1": { productSku: "SKU-A", confidence: 0.8 } }),
      resolvePhotoRef: (photoRef) => photoRef,
    })
    expect(report.mode).toBe("two_stage")
    expect(report.provider).toBe("stub-localizer+deterministic-recognizer")
    expect(localizer.localize).toHaveBeenCalled()
    // golden-сэмпл: ожидается 2 бокса, локализован 1 (slot-a), SKU верно.
    const goldenSample = report.samples.find((sample) => sample.id === "golden")
    expect(goldenSample?.metrics).toMatchObject({ expected: 2, detected: 1, localized: 1, skuCorrect: 1 })
  })
})
