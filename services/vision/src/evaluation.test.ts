import { describe, expect, test, vi } from "vitest"
import {
  evaluateVisionDetections,
  runTwoStageShelfRecognition,
  validateVisionEvalManifest,
  visionEvalManifestSchema,
  visionEvalManifestStats,
} from "./evaluation.ts"

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

describe("manifest discipline", () => {
  const bbox = { xPct: 0, yPct: 0, widthPct: 10, heightPct: 10 }
  const annotation = { id: "slot-1", productSku: "SKU-A", bbox, facings: 1 }

  function manifestWith(samples: unknown[]) {
    return visionEvalManifestSchema.parse({
      version: 1,
      datasetId: "pilot-v1",
      createdAt: "2026-07-12T00:00:00.000Z",
      samples,
    })
  }

  const golden = {
    id: "golden",
    split: "calibration",
    photoRef: "private://pilot-v1/photos/golden.png",
    goldenReferenceRef: null,
    planogramVersionId: "version-1",
    annotations: [annotation],
  }

  test("чистый манифест проходит без issues; sourceKind/notes опциональны и аддитивны", () => {
    const manifest = manifestWith([
      golden,
      {
        id: "real-1",
        split: "validation",
        photoRef: "private://pilot-v1/photos/real-1.jpg",
        goldenReferenceRef: "private://pilot-v1/photos/golden.png",
        planogramVersionId: "version-1",
        sourceKind: "real",
        notes: "полевое фото, вечернее освещение",
        annotations: [annotation],
      },
    ])
    expect(validateVisionEvalManifest(manifest)).toEqual([])
    expect(manifest.samples[1]?.sourceKind).toBe("real")
    // Старый манифест без новых полей остаётся валидным (пилот не ломается).
    expect(manifestWith([golden]).samples[0]?.sourceKind).toBeUndefined()
  })

  test("ловит дубликаты id, leakage photoRef между сплитами и битый golden", () => {
    const manifest = manifestWith([
      golden,
      { ...golden, id: "golden" }, // дубль id + leakage того же photoRef? тот же split — не leakage
      {
        id: "leak",
        split: "test",
        photoRef: "private://pilot-v1/photos/golden.png", // то же фото в другом сплите
        goldenReferenceRef: null,
        planogramVersionId: "version-1",
        annotations: [annotation, annotation], // дубль id аннотации
      },
      {
        id: "dangling",
        split: "validation",
        photoRef: "private://pilot-v1/photos/dangling.jpg",
        goldenReferenceRef: "private://pilot-v1/photos/missing.png",
        planogramVersionId: "version-1",
        annotations: [annotation],
      },
    ])
    const issues = validateVisionEvalManifest(manifest)
    expect(issues).toContain("duplicate_sample_id:golden")
    expect(issues.some((issue) => issue.startsWith("photo_ref_split_leakage:private://pilot-v1/photos/golden.png"))).toBe(true)
    expect(issues).toContain("duplicate_annotation_id:leak:slot-1")
    expect(issues).toContain("golden_reference_not_found:dangling:private://pilot-v1/photos/missing.png")
  })

  test("требует default golden-сэмпл (goldenReferenceRef=null)", () => {
    const manifest = manifestWith([
      {
        ...golden,
        id: "no-default",
        goldenReferenceRef: "private://pilot-v1/photos/golden.png",
      },
    ])
    const issues = validateVisionEvalManifest(manifest)
    expect(issues).toContain("missing_default_golden_reference_sample")
  })

  test("stats считает покрытие по split/source/scenario/condition", () => {
    const manifest = manifestWith([
      { ...golden, scenario: "golden" },
      {
        id: "real-1",
        split: "validation",
        photoRef: "private://pilot-v1/photos/real-1.jpg",
        goldenReferenceRef: "private://pilot-v1/photos/golden.png",
        planogramVersionId: "version-1",
        scenario: "missing_sku",
        sourceKind: "real",
        annotations: [
          annotation,
          { ...annotation, id: "slot-2", recognitionCondition: "rotated_label" },
        ],
      },
      {
        id: "synth-1",
        split: "test",
        photoRef: "private://pilot-v1/photos/synth-1.png",
        goldenReferenceRef: "private://pilot-v1/photos/golden.png",
        planogramVersionId: "version-1",
        sourceKind: "synthetic",
        annotations: [annotation],
      },
    ])
    expect(visionEvalManifestStats(manifest)).toEqual({
      sampleCount: 3,
      annotationCount: 4,
      bySplit: { calibration: 1, validation: 1, test: 1 },
      bySourceKind: { real: 1, synthetic: 1, unspecified: 1 },
      byScenario: { golden: 1, missing_sku: 1, unclassified: 1 },
      byRecognitionCondition: { clear: 3, rotated_label: 1 },
    })
  })
})
