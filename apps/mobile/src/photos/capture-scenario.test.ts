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
          mediaKind: "video",
          minDurationSeconds: 3,
          maxDurationSeconds: 6,
        },
      }),
    })

    expect(extractCaptureStepFromExifJson(exifJson)).toEqual({
      scenarioId: GUIDED_SHELF_PROOF_SCENARIO_ID,
      stepId: "left-depth",
      stepKind: "left_depth",
      required: true,
      sequence: 2,
      mediaKind: "video",
      minDurationSeconds: 3,
      maxDurationSeconds: 6,
    })
  })

  it("finds the next required missing proof step", () => {
    const completed = getCompletedCaptureStepIds([
      {
        exifJson: JSON.stringify({
          ImageDescription: JSON.stringify({
            captureScenario: { id: GUIDED_SHELF_PROOF_SCENARIO_ID },
            captureStep: { id: "front", kind: "front", required: true, sequence: 1, mediaKind: "video" },
          }),
        }),
      },
    ])

    expect(getNextRequiredCaptureStep(completed)?.id).toBe("left-depth")
  })

  it("counts completed steps from synced captureStepJson when EXIF is absent", () => {
    const completed = getCompletedCaptureStepIds([
      {
        captureStepJson: JSON.stringify({
          scenarioId: GUIDED_SHELF_PROOF_SCENARIO_ID,
          stepId: "front",
          stepKind: "front",
          required: true,
          sequence: 1,
          mediaKind: "video",
          minDurationSeconds: 5,
          maxDurationSeconds: 8,
        }),
      },
    ])

    expect(completed.has("front")).toBe(true)
  })
})
