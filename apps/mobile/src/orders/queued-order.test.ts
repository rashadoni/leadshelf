import { describe, expect, it } from "vitest"
import { parseQueuedOrderDetailCode, parseQueuedOrderPayload } from "./queued-order"

describe("queued order presentation data", () => {
  it("parses valid lines and totals units", () => {
    expect(parseQueuedOrderPayload(JSON.stringify({
      storeId: "store-1",
      visitId: "visit-1",
      lines: [
        { productId: "product-1", quantity: 2 },
        { productId: "product-2", quantity: 3.5 },
      ],
    }))).toEqual({
      storeId: "store-1",
      visitId: "visit-1",
      lines: [
        { productId: "product-1", quantity: 2 },
        { productId: "product-2", quantity: 3.5 },
      ],
      unitCount: 5.5,
    })
  })

  it("keeps a damaged outbox row safe for rendering", () => {
    expect(parseQueuedOrderPayload("not-json")).toEqual({
      storeId: "",
      visitId: null,
      lines: [],
      unitCount: 0,
    })
  })

  it("extracts a stable server reason without exposing arbitrary detail", () => {
    expect(parseQueuedOrderDetailCode('{"code":"product_price_missing","detail":{"private":"value"}}'))
      .toBe("product_price_missing")
    expect(parseQueuedOrderDetailCode('{"other":"value"}')).toBeNull()
  })
})
