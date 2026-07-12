import { describe, expect, it } from "vitest"
import { visionEvalManifestSchema } from "./evaluation"
import { evaluateAppleVisionOcr } from "./apple-vision-ocr-eval"

describe("Apple Vision OCR oracle-box evaluation", () => {
  it("separates clear and rotated-label text evidence without claiming localization", async () => {
    const manifest = visionEvalManifestSchema.parse({
      version: 1,
      datasetId: "local-ocr-pilot",
      createdAt: "2026-07-12T00:00:00.000Z",
      samples: [{
        id: "sample-1",
        split: "calibration",
        scenario: "rotated_label",
        photoRef: "private://local-ocr-pilot/images/sample-1.png",
        goldenReferenceRef: null,
        planogramVersionId: "planogram-1",
        annotations: [
          {
            id: "clear",
            productSku: "CLEAR",
            bbox: { xPct: 0, yPct: 0, widthPct: 40, heightPct: 40 },
            facings: 1,
          },
          {
            id: "rotated",
            productSku: "ROTATED",
            bbox: { xPct: 60, yPct: 60, widthPct: 40, heightPct: 40 },
            facings: 1,
            recognitionCondition: "rotated_label",
          },
        ],
      }],
    })
    const report = await evaluateAppleVisionOcr({
      manifest,
      loadRows: () => [{
        text: "CLEAR",
        confidence: 0.9,
        x: 0.1,
        y: 0.7,
        width: 0.1,
        height: 0.1,
      }],
      now: () => new Date("2026-07-12T01:00:00.000Z"),
    })

    expect(report).toMatchObject({
      mode: "oracle-box-text-evidence",
      oracleLocalization: true,
      overallMetrics: { expectedBoxes: 2, boxesWithText: 1, textEvidenceRecall: 0.5 },
      conditionMetrics: {
        clear: { expectedBoxes: 1, boxesWithText: 1, textEvidenceRecall: 1 },
        rotated_label: { expectedBoxes: 1, boxesWithText: 0, textEvidenceRecall: 0 },
      },
    })
  })
})
