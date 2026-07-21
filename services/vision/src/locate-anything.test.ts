import { describe, expect, it, vi } from "vitest"
import {
  createConfiguredLocateAnythingLocalizer,
  DEFAULT_LOCATE_ANYTHING_MODEL,
  LocateAnythingLocalizer,
} from "./locate-anything"
import type { VisionFetch } from "./provider"

const photo = "data:image/jpeg;base64,AA=="

describe("LocateAnything evaluation localizer", () => {
  it("is fail-closed without the explicit non-commercial evaluation acknowledgement", () => {
    expect(() => createConfiguredLocateAnythingLocalizer({})).toThrow(
      "locateanything_requires_noncommercial_evaluation_ack",
    )
  })

  it("rejects an unauthenticated or plaintext remote worker", () => {
    const base = { evaluationOnlyAccepted: true }
    expect(() => new LocateAnythingLocalizer({ ...base, baseUrl: "http://gpu.example.com" })).toThrow(
      "locateanything_remote_worker_requires_https",
    )
    expect(() => new LocateAnythingLocalizer({ ...base, baseUrl: "https://gpu.example.com" })).toThrow(
      "locateanything_remote_worker_requires_token",
    )
  })

  it("calls the worker and converts 0..1000 coordinates to percentages", async () => {
    let requestBody: Record<string, unknown> | undefined
    const fetchImpl: VisionFetch = vi.fn(async (_url, init) => {
      requestBody = JSON.parse(init.body) as Record<string, unknown>
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          evaluationOnly: true,
          model: DEFAULT_LOCATE_ANYTHING_MODEL,
          boxes: [
            { label: "product", confidence: null, x1: 100, y1: 200, x2: 350, y2: 600 },
            { label: "invalid", x1: 500, y1: 500, x2: 400, y2: 700 },
          ],
        }),
      }
    })
    const localizer = new LocateAnythingLocalizer({
      evaluationOnlyAccepted: true,
      fetchImpl,
      uncalibratedConfidence: 0.4,
    })
    await expect(localizer.localize(photo)).resolves.toEqual([
      {
        id: "locateanything-1",
        confidence: 0.4,
        bbox: { xPct: 10, yPct: 20, widthPct: 25, heightPct: 40 },
      },
    ])
    expect(requestBody).toMatchObject({
      evaluationOnly: true,
      model: DEFAULT_LOCATE_ANYTHING_MODEL,
      categories: ["retail product package"],
      generationMode: "hybrid",
    })
  })

  it("does not expose a worker response body in errors", async () => {
    const fetchImpl: VisionFetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "private-worker-stack-and-image-data",
    }))
    const localizer = new LocateAnythingLocalizer({ evaluationOnlyAccepted: true, fetchImpl })
    await expect(localizer.localize(photo)).rejects.toThrow("locateanything_worker_request_failed:500")
    await expect(localizer.localize("https://example.com/photo.jpg")).rejects.toThrow(
      "locateanything_eval_requires_inline_image",
    )
  })
})
