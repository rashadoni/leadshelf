import { describe, expect, it } from "vitest"
import {
  addSampleToManifest,
  assignSplitDeterministically,
  DEFAULT_SPLIT_RATIOS,
  parseSplitRatios,
} from "./dataset"
import { visionEvalManifestSchema } from "./evaluation"

const box = { xPct: 0, yPct: 0, widthPct: 20, heightPct: 20 }

const baseManifest = visionEvalManifestSchema.parse({
  version: 1,
  datasetId: "pilot-v1",
  createdAt: "2026-07-12T00:00:00.000Z",
  samples: [
    {
      id: "golden",
      split: "calibration",
      scenario: "golden",
      photoRef: "private://pilot-v1/photos/golden.png",
      goldenReferenceRef: null,
      planogramVersionId: "planogram-v1",
      annotations: [{ id: "slot-a", productSku: "SKU-A", bbox: box, facings: 1 }],
    },
  ],
})

describe("split ratios", () => {
  it("парсит валидные ratio и отклоняет сумму != 100", () => {
    expect(parseSplitRatios("40,40,20")).toEqual({ calibration: 40, validation: 40, test: 20 })
    expect(() => parseSplitRatios("50,50,50")).toThrow("split_ratios_must_sum_to_100")
    expect(() => parseSplitRatios("a,b,c")).toThrow("invalid_split_ratios")
    expect(() => parseSplitRatios("100,0")).toThrow("invalid_split_ratios")
  })
})

describe("deterministic split assignment", () => {
  it("один и тот же id всегда попадает в один и тот же сплит", () => {
    for (const id of ["sample-1", "sample-2", "store-42-photo-7"]) {
      const first = assignSplitDeterministically(id)
      expect(assignSplitDeterministically(id)).toBe(first)
      expect(assignSplitDeterministically(id, DEFAULT_SPLIT_RATIOS)).toBe(first)
    }
  })

  it("уважает крайние ratio", () => {
    expect(assignSplitDeterministically("anything", { calibration: 100, validation: 0, test: 0 })).toBe("calibration")
    expect(assignSplitDeterministically("anything", { calibration: 0, validation: 0, test: 100 })).toBe("test")
  })

  it("распределение по многим id примерно следует ratio", () => {
    const counts = { calibration: 0, validation: 0, test: 0 }
    const total = 1000
    for (let index = 0; index < total; index += 1) {
      counts[assignSplitDeterministically(`sample-${index}`)] += 1
    }
    // Грубые границы: детерминированный хэш, не статистика — ±10 п.п.
    expect(counts.calibration / total).toBeGreaterThan(0.3)
    expect(counts.calibration / total).toBeLessThan(0.5)
    expect(counts.validation / total).toBeGreaterThan(0.3)
    expect(counts.validation / total).toBeLessThan(0.5)
    expect(counts.test / total).toBeGreaterThan(0.1)
    expect(counts.test / total).toBeLessThan(0.3)
  })
})

describe("addSampleToManifest", () => {
  const annotations = [{ id: "slot-a", productSku: "SKU-A", bbox: box, facings: 1, recognitionCondition: "clear" as const }]

  it("добавляет сэмпл с детерминированным сплитом и sourceKind", () => {
    const { manifest, assignedSplit } = addSampleToManifest(baseManifest, {
      id: "new-photo-1",
      photoRef: "private://pilot-v1/photos/new-photo-1.jpg",
      goldenReferenceRef: "private://pilot-v1/photos/golden.png",
      planogramVersionId: "planogram-v1",
      scenario: "missing_sku",
      sourceKind: "real",
      split: "auto",
      annotations,
    })
    expect(assignedSplit).toBe(assignSplitDeterministically("new-photo-1"))
    const added = manifest.samples.find((sample) => sample.id === "new-photo-1")
    expect(added?.sourceKind).toBe("real")
    expect(added?.split).toBe(assignedSplit)
    // Исходный манифест не мутируется.
    expect(baseManifest.samples).toHaveLength(1)
  })

  it("отклоняет дубликат id и дубликат photoRef", () => {
    expect(() =>
      addSampleToManifest(baseManifest, {
        id: "golden",
        photoRef: "private://pilot-v1/photos/other.jpg",
        goldenReferenceRef: null,
        planogramVersionId: "planogram-v1",
        sourceKind: "real",
        split: "auto",
        annotations,
      }),
    ).toThrow("sample_id_already_exists")
    expect(() =>
      addSampleToManifest(baseManifest, {
        id: "other",
        photoRef: "private://pilot-v1/photos/golden.png",
        goldenReferenceRef: null,
        planogramVersionId: "planogram-v1",
        sourceKind: "real",
        split: "auto",
        annotations,
      }),
    ).toThrow("photo_ref_already_exists")
  })

  it("отклоняет сэмпл с несуществующим golden-референсом", () => {
    expect(() =>
      addSampleToManifest(baseManifest, {
        id: "dangling",
        photoRef: "private://pilot-v1/photos/dangling.jpg",
        goldenReferenceRef: "private://pilot-v1/photos/missing-golden.png",
        planogramVersionId: "planogram-v1",
        sourceKind: "synthetic",
        split: "validation",
        annotations,
      }),
    ).toThrow("manifest_invalid_after_add")
  })
})
