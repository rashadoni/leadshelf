import { describe, expect, it } from "vitest"
import { isLegacyCommercialFieldPath } from "./legacy-field-paths"

describe("LeadDrive Field legacy-commercial paths", () => {
  it("blocks every commercial, shelf, planogram and order entry point", () => {
    expect(isLegacyCommercialFieldPath("/commercial")).toBe(true)
    expect(isLegacyCommercialFieldPath("/commercial/promotions")).toBe(true)
    expect(isLegacyCommercialFieldPath("/shelves/example/equipment")).toBe(true)
    expect(isLegacyCommercialFieldPath("/planograms/example")).toBe(true)
    expect(isLegacyCommercialFieldPath("/orders")).toBe(true)
    expect(isLegacyCommercialFieldPath("/order-create")).toBe(true)
    expect(isLegacyCommercialFieldPath("/routes/commercial")).toBe(true)
  })

  it("keeps Field operational paths available", () => {
    expect(isLegacyCommercialFieldPath("/routes")).toBe(false)
    expect(isLegacyCommercialFieldPath("/field-visits/visit-1")).toBe(false)
    expect(isLegacyCommercialFieldPath("/workday")).toBe(false)
  })
})
