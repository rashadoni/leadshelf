import { describe, expect, it } from "vitest"
import {
  GUIDED_SHELF_PROOF_SCENARIO_ID,
  extractCaptureStepFromExifJson,
  getCompletedCaptureStepIds,
  getNextRequiredCaptureStep,
} from "./capture-scenario"

describe("guided shelf proof capture scenario", () => {
  it("extracts capture step metadata from EXIF-like JSON", () => {
    const exifJson = JSON.stringify({
      DateTimeOriginal: "2026-07-06T09:00:00.000Z",
      Software: "LeadShelf Mobile",
      ImageDescription: JSON.stringify({
        captureScenario: { id: GUIDED_SHELF_PROOF_SCENARIO_ID },
        captureStep: {
          id: "left-depth",
          kind: "left_depth",
          required: true,
          sequence: 2,
          mediaKind: "photo",
        },
      }),
    })

    expect(extractCaptureStepFromExifJson(exifJson)).toEqual({
      scenarioId: GUIDED_SHELF_PROOF_SCENARIO_ID,
      stepId: "left-depth",
      stepKind: "left_depth",
      required: true,
      sequence: 2,
      mediaKind: "photo",
    })
  })

  it("finds the next required missing proof step", () => {
    const completed = getCompletedCaptureStepIds([
      {
        exifJson: JSON.stringify({
          ImageDescription: JSON.stringify({
            captureScenario: { id: GUIDED_SHELF_PROOF_SCENARIO_ID },
            captureStep: { id: "front", kind: "front", required: true, sequence: 1, mediaKind: "photo" },
          }),
        }),
      },
    ])

    expect(getNextRequiredCaptureStep(completed)?.id).toBe("left-depth")
  })
})
