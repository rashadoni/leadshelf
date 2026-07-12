import { describe, expect, test, vi } from "vitest"
import { evaluateVisionDetections, runTwoStageShelfRecognition, visionEvalManifestSchema } from "./evaluation.ts"

describe("vision evaluation", () => {
  test("separates localization quality from SKU recognition", () => {
    const metrics = evaluateVisionDetections(
      [
        { id: "a", productSku: "SKU-A", bbox: { xPct: 0, yPct: 0, widthPct: 20, heightPct: 20 } },
        { id: "b", productSku: "SKU-B", bbox: { xPct: 30, yPct: 0, widthPct: 20, heightPct: 20 } },
      ],
      [
        { id: "d1", productSku: "SKU-A", confidence: 0.9, bbox: { xPct: 1, yPct: 1, widthPct: 20, heightPct: 20 } },
        { id: "d2", productSku: "SKU-X", confidence: 0.8, bbox: { xPct: 31, yPct: 1, widthPct: 20, heightPct: 20 } },
      ],
    )
    expect(metrics).toMatchObject({
      expected: 2,
      detected: 2,
      localized: 2,
      skuCorrect: 1,
      localizationPrecision: 1,
      localizationRecall: 1,
      skuAccuracyOnLocalized: 0.5,
      endToEndRecall: 0.5,
    })
    expect(metrics.meanIou).toBeGreaterThan(0.8)
  })

  test("validates a privacy-safe manifest of references rather than embedding photos", () => {
    const result = visionEvalManifestSchema.parse({
      version: 1,
      datasetId: "pilot-v1",
      createdAt: "2026-07-11T00:00:00.000Z",
      samples: [{
        id: "sample-1",
        split: "calibration",
        photoRef: "s3://private-eval/sample-1.jpg",
        goldenReferenceRef: null,
        planogramVersionId: "version-1",
        scenario: "rotated_label",
        annotations: [{
          id: "annotation-1",
          productSku: "SKU-A",
          bbox: { xPct: 1, yPct: 2, widthPct: 3, heightPct: 4 },
          facings: 1,
          recognitionCondition: "rotated_label",
        }],
      }],
    })

    expect(result.samples).toHaveLength(1)
    expect(result.samples[0]).toMatchObject({
      scenario: "rotated_label",
      annotations: [{ recognitionCondition: "rotated_label" }],
    })
  })

  test("runs localization before SKU recognition and combines confidence conservatively", async () => {
    const recognize = vi.fn().mockResolvedValue([{ id: "box-1", productSku: "SKU-A", confidence: 0.7 }])
    const result = await runTwoStageShelfRecognition(
      {
        provider: "detector",
        modelVersion: "detector-v1",
        localize: vi.fn().mockResolvedValue([{ id: "box-1", confidence: 0.9, bbox: { xPct: 1, yPct: 2, widthPct: 3, heightPct: 4 } }]),
      },
      { provider: "classifier", modelVersion: "classifier-v1", recognize },
      { photoRef: "private://sample", catalogSkus: ["SKU-A"] },
    )
    expect(recognize).toHaveBeenCalledOnce()
    expect(result).toEqual([{ id: "box-1", productSku: "SKU-A", confidence: 0.7, bbox: { xPct: 1, yPct: 2, widthPct: 3, heightPct: 4 } }])
  })
})
