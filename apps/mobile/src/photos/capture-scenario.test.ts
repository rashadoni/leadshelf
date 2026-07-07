import { describe, expect, it } from "vitest"
import type { MobileCaptureTemplate } from "@leadshelf/api-contracts/mobile/v1"
import {
  GUIDED_SHELF_PROOF_SCENARIO_ID,
  activeRetakeStepIds,
  extractCaptureStepFromExifJson,
  getCompletedCaptureStepIds,
  getNextRequiredCaptureStep,
  isRequiredScenarioComplete,
  resolveCaptureScenario,
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

  it("falls back to the built-in photo-first scenario without a template", () => {
    const scenario = resolveCaptureScenario(null, "ru")
    expect(scenario.scenarioId).toBe(GUIDED_SHELF_PROOF_SCENARIO_ID)
    expect(scenario.steps.map((step) => step.id)).toEqual([
      "front",
      "left-depth",
      "right-depth",
      "detail",
    ])
    // photo-first: обязательные шаги — burst-фото, не видео
    for (const step of scenario.steps.filter((s) => s.required)) {
      expect(step.mediaKind).toBe("photo")
      expect(step.burstCount).toBeGreaterThan(1)
    }
  })

  it("builds the scenario from a server capture template with overrides", () => {
    const template: MobileCaptureTemplate = {
      id: "tpl-1",
      scenarioId: "capture-template:tpl-1:v2",
      name: "Холодильник",
      equipmentKind: "fridge",
      version: 2,
      updatedAt: "2026-07-07T09:00:00.000Z",
      steps: [
        {
          id: "top-down",
          kind: "top_down",
          required: true,
          sequence: 2,
          mediaKind: "photo",
          burstCount: 2,
          doorPolicy: "open_allowed",
          instructionOverrides: { ru: "Откройте дверь и снимите сверху" },
        },
        {
          id: "front",
          kind: "front",
          required: true,
          sequence: 1,
          mediaKind: "photo",
          tiltToleranceDeg: 6,
        },
      ],
    }
    const scenario = resolveCaptureScenario(template, "ru")
    expect(scenario.scenarioId).toBe("capture-template:tpl-1:v2")
    // сортировка по sequence
    expect(scenario.steps.map((step) => step.id)).toEqual(["front", "top-down"])
    expect(scenario.steps[0]!.tiltToleranceDeg).toBe(6)
    expect(scenario.steps[1]!.instructionText).toBe("Откройте дверь и снимите сверху")
    expect(scenario.steps[1]!.titleKey).toBe("proofStepTopDownTitle")
  })

  it("falls back to built-in steps for an empty or broken template", () => {
    const broken = {
      id: "tpl-x",
      scenarioId: "capture-template:tpl-x:v1",
      name: "X",
      version: 1,
      updatedAt: "2026-07-07T09:00:00.000Z",
      steps: [],
    } as unknown as MobileCaptureTemplate
    expect(resolveCaptureScenario(broken, "ru").scenarioId).toBe(GUIDED_SHELF_PROOF_SCENARIO_ID)
  })

  it("treats excepted steps as closing the required scenario", () => {
    const scenario = resolveCaptureScenario(null, "ru")
    const completed = new Set(["front", "right-depth"])
    expect(isRequiredScenarioComplete(scenario.steps, completed)).toBe(false)
    expect(isRequiredScenarioComplete(scenario.steps, completed, new Set(["left-depth"]))).toBe(true)
  })

  it("marks a step as active retake only until a newer proof exists", () => {
    const retakes = [{ stepId: "front", stepKind: "front", note: null, requestedAt: "2026-07-07T10:00:00.000Z" }]
    // старое фото до запроса -> retake активен
    expect(
      activeRetakeStepIds(retakes, [
        {
          takenAt: "2026-07-07T09:00:00.000Z",
          captureStepJson: JSON.stringify({ stepId: "front", stepKind: "front" }),
        },
      ]).has("front"),
    ).toBe(true)
    // фото после запроса -> retake закрыт локально
    expect(
      activeRetakeStepIds(retakes, [
        {
          takenAt: "2026-07-07T10:05:00.000Z",
          captureStepJson: JSON.stringify({ stepId: "front", stepKind: "front" }),
        },
      ]).has("front"),
    ).toBe(false)
    // без фото шага -> активен
    expect(activeRetakeStepIds(retakes, []).has("front")).toBe(true)
    expect(activeRetakeStepIds(null, []).size).toBe(0)
  })

  it("keeps the required scenario open while a retake is active", () => {
    const scenario = resolveCaptureScenario(null, "ru")
    const completed = new Set(["front", "left-depth", "right-depth"])
    expect(isRequiredScenarioComplete(scenario.steps, completed)).toBe(true)
    expect(
      isRequiredScenarioComplete(scenario.steps, completed, new Set(), new Set(["front"])),
    ).toBe(false)
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
