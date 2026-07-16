import { describe, expect, test } from "vitest"
import { attachCommercialMediaToOperation, detachCommercialMediaFromOperation } from "./media-outbox"

describe("commercial media outbox", () => {
  test("attaches an uploaded promotion proof without changing its identity", () => {
    expect(attachCommercialMediaToOperation({
      kind: "promotion.submit",
      purpose: "PROMOTION_PROOF",
      key: "commercial-media/org/agent/proof.jpg",
      payload: { clientExecutionId: "execution-0001", note: "Installed" },
    })).toEqual({
      clientExecutionId: "execution-0001",
      note: "Installed",
      proofPhotoUrl: "commercial-media/org/agent/proof.jpg",
    })
  })

  test("attaches return evidence to the exact queued return", () => {
    expect(attachCommercialMediaToOperation({
      kind: "return.create",
      purpose: "RETURN_EVIDENCE",
      key: "commercial-media/org/agent/return.jpg",
      payload: {
        orderId: "order-1",
        reason: "DAMAGED",
        lines: [{ orderLineId: "line-1", quantity: 1 }],
      },
    })).toMatchObject({
      orderId: "order-1",
      evidencePhotoUrl: "commercial-media/org/agent/return.jpg",
    })
  })

  test("rejects cross-purpose attachment", () => {
    expect(() => attachCommercialMediaToOperation({
      kind: "promotion.submit",
      purpose: "RETURN_EVIDENCE",
      key: "commercial-media/org/agent/wrong.jpg",
      payload: { clientExecutionId: "execution-0001", note: "Installed" },
    })).toThrow("Commercial media operation kind mismatch")
  })

  test("removes optional promotion proof without losing the result", () => {
    expect(detachCommercialMediaFromOperation({
      kind: "promotion.submit",
      purpose: "PROMOTION_PROOF",
      payload: {
        clientExecutionId: "execution-0001",
        note: "Installed",
        proofPhotoUrl: "commercial-media/org/agent/proof.jpg",
      },
    })).toEqual({
      clientExecutionId: "execution-0001",
      note: "Installed",
    })
  })

  test("removes optional return evidence without losing selected lines", () => {
    expect(detachCommercialMediaFromOperation({
      kind: "return.create",
      purpose: "RETURN_EVIDENCE",
      payload: {
        orderId: "order-1",
        visitId: null,
        reason: "DAMAGED",
        note: null,
        lines: [{ orderLineId: "line-1", quantity: 2 }],
        evidencePhotoUrl: "commercial-media/org/agent/return.jpg",
      },
    })).toEqual({
      orderId: "order-1",
      visitId: null,
      reason: "DAMAGED",
      note: null,
      lines: [{ orderLineId: "line-1", quantity: 2 }],
    })
  })

  test("refuses to detach media from a mismatched operation", () => {
    expect(() => detachCommercialMediaFromOperation({
      kind: "promotion.submit",
      purpose: "RETURN_EVIDENCE",
      payload: { clientExecutionId: "execution-0001", note: "Installed" },
    })).toThrow("Commercial media operation kind mismatch")
  })
})
