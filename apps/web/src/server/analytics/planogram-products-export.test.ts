import { describe, expect, it } from "vitest"
import { createPlanogramProductsXmlStream } from "./planogram-products-export"
import type { ProductRow } from "./planogram-products"

function row(index: number): ProductRow {
  return {
    key: `key-${index}`, productId: `product-${index}`, planogramId: "planogram",
    versionId: "version", planogramName: "A & B", versionNumber: 1,
    state: "PUBLISHED", sku: `SKU-${index}`, productName: "<Product>",
    brand: null, category: "Category", supplier: "Supplier", placements: 1,
    units: 2, linearMm: 1250,
  }
}

describe("planogram product XML stream", () => {
  it("streams every row and escapes XML", async () => {
    const text = await new Response(createPlanogramProductsXmlStream([row(1), row(2)])).text()
    expect(text.match(/<Row>/g)).toHaveLength(3)
    expect(text).toContain("A &amp; B")
    expect(text).toContain("&lt;Product&gt;")
    expect(text).toContain(">1.25<")
    expect(text).toContain("SKU-2")
    expect(text.endsWith("</Workbook>")).toBe(true)
  })

  it("pulls rows from an async DB-like source", async () => {
    async function* source() {
      yield row(1)
      yield row(2)
    }
    const text = await new Response(createPlanogramProductsXmlStream(source())).text()
    expect(text.match(/<Row>/g)).toHaveLength(3)
    expect(text).toContain("SKU-2")
  })
})
