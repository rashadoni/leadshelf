import { describe, expect, it } from "vitest"
import { buildInvoiceNumber, generateInvoice, renderInvoiceHtml } from "./invoice-generator.ts"

describe("invoice generator", () => {
  it("builds deterministic invoice numbers", () => {
    expect(buildInvoiceNumber({ issuedAt: new Date("2026-07-04T08:00:00.000Z"), sequence: 17 })).toBe(
      "LS-20260704-00017",
    )
  })

  it("calculates line totals, discounts, and tax in cents", () => {
    const invoice = generateInvoice({
      invoiceNumber: "LS-20260704-00017",
      orderId: "order-1",
      issuedAt: new Date("2026-07-04T08:00:00.000Z"),
      seller: { name: "LeadShelf" },
      buyer: { name: "Pilot Pharmacy" },
      lines: [
        {
          lineId: "line-1",
          sku: "SKU-1",
          name: "Vitamin",
          quantity: 3,
          unitPriceCents: 1_000,
          discountCents: 300,
          taxRateBps: 1800,
        },
        {
          lineId: "line-2",
          sku: "SKU-2",
          name: "Bandage",
          quantity: 2.5,
          unitPriceCents: 400,
        },
      ],
    })

    expect(invoice).toMatchObject({
      subtotalCents: 4_000,
      discountCents: 300,
      taxableCents: 3_700,
      taxCents: 486,
      totalCents: 4_186,
      currency: "AZN",
    })
    expect(invoice.lines[0]).toMatchObject({
      grossCents: 3_000,
      taxableCents: 2_700,
      taxCents: 486,
      totalCents: 3_186,
    })
  })

  it("escapes invoice HTML fields for safe PDF rendering", () => {
    const invoice = generateInvoice({
      invoiceNumber: "INV-1",
      orderId: "order-1",
      issuedAt: new Date("2026-07-04T08:00:00.000Z"),
      seller: { name: "Seller <script>" },
      buyer: { name: "Buyer & Co" },
      note: "Use <unsafe> note",
      lines: [{ lineId: "line-1", sku: "SKU<1>", name: "A&B", quantity: 1, unitPriceCents: 100 }],
    })

    const html = renderInvoiceHtml(invoice)
    expect(html).toContain("Seller &lt;script&gt;")
    expect(html).toContain("Buyer &amp; Co")
    expect(html).toContain("SKU&lt;1&gt;")
    expect(html).toContain("A&amp;B")
    expect(html).toContain("Use &lt;unsafe&gt; note")
  })

  it("rejects empty invoices and invalid money", () => {
    expect(() =>
      generateInvoice({
        invoiceNumber: "INV-1",
        orderId: "order-1",
        issuedAt: new Date("2026-07-04T08:00:00.000Z"),
        seller: { name: "Seller" },
        buyer: { name: "Buyer" },
        lines: [],
      }),
    ).toThrow("invoice must have at least one line")

    expect(() =>
      generateInvoice({
        invoiceNumber: "INV-1",
        orderId: "order-1",
        issuedAt: new Date("2026-07-04T08:00:00.000Z"),
        seller: { name: "Seller" },
        buyer: { name: "Buyer" },
        lines: [{ lineId: "line-1", sku: "SKU", name: "Bad", quantity: 1, unitPriceCents: 10.5 }],
      }),
    ).toThrow("unitPriceCents")
  })
})
