export interface InvoiceParty {
  name: string
  taxId?: string | null
  address?: string | null
  phone?: string | null
}

export interface InvoiceLineInput {
  lineId: string
  sku: string
  name: string
  quantity: number
  unitPriceCents: number
  discountCents?: number
  taxRateBps?: number
}

export interface InvoiceInput {
  invoiceNumber: string
  orderId: string
  issuedAt: Date
  dueAt?: Date | null
  seller: InvoiceParty
  buyer: InvoiceParty
  currency?: string
  lines: InvoiceLineInput[]
  note?: string | null
}

export interface InvoiceLine {
  lineId: string
  sku: string
  name: string
  quantity: number
  unitPriceCents: number
  grossCents: number
  discountCents: number
  taxableCents: number
  taxRateBps: number
  taxCents: number
  totalCents: number
}

export interface InvoiceDocument {
  invoiceNumber: string
  orderId: string
  issuedAtIso: string
  dueAtIso: string | null
  seller: InvoiceParty
  buyer: InvoiceParty
  currency: string
  lines: InvoiceLine[]
  subtotalCents: number
  discountCents: number
  taxableCents: number
  taxCents: number
  totalCents: number
  note: string | null
}

function assertMoney(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer amount in cents`)
  }
}

function assertRate(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${field} must be an integer basis-point rate between 0 and 10000`)
  }
}

function roundCents(value: number): number {
  return Math.max(0, Math.round(value))
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function buildInvoiceNumber({
  prefix = "LS",
  issuedAt,
  sequence,
}: {
  prefix?: string
  issuedAt: Date
  sequence: number
}): string {
  if (!Number.isInteger(sequence) || sequence <= 0) {
    throw new Error("sequence must be a positive integer")
  }
  const datePart = issuedAt.toISOString().slice(0, 10).replaceAll("-", "")
  return `${prefix}-${datePart}-${String(sequence).padStart(5, "0")}`
}

export function generateInvoice(input: InvoiceInput): InvoiceDocument {
  if (input.lines.length === 0) {
    throw new Error("invoice must have at least one line")
  }

  const lines = input.lines.map((line) => {
    if (line.quantity <= 0 || !Number.isFinite(line.quantity)) {
      throw new Error(`line ${line.lineId} quantity must be greater than zero`)
    }
    assertMoney(line.unitPriceCents, `line ${line.lineId} unitPriceCents`)
    assertMoney(line.discountCents ?? 0, `line ${line.lineId} discountCents`)
    assertRate(line.taxRateBps ?? 0, `line ${line.lineId} taxRateBps`)

    const grossCents = roundCents(line.quantity * line.unitPriceCents)
    const discountCents = Math.min(line.discountCents ?? 0, grossCents)
    const taxableCents = grossCents - discountCents
    const taxRateBps = line.taxRateBps ?? 0
    const taxCents = roundCents((taxableCents * taxRateBps) / 10_000)

    return {
      ...line,
      grossCents,
      discountCents,
      taxableCents,
      taxRateBps,
      taxCents,
      totalCents: taxableCents + taxCents,
    }
  })

  return {
    invoiceNumber: input.invoiceNumber,
    orderId: input.orderId,
    issuedAtIso: input.issuedAt.toISOString(),
    dueAtIso: input.dueAt?.toISOString() ?? null,
    seller: input.seller,
    buyer: input.buyer,
    currency: input.currency ?? "AZN",
    lines,
    subtotalCents: lines.reduce((sum, line) => sum + line.grossCents, 0),
    discountCents: lines.reduce((sum, line) => sum + line.discountCents, 0),
    taxableCents: lines.reduce((sum, line) => sum + line.taxableCents, 0),
    taxCents: lines.reduce((sum, line) => sum + line.taxCents, 0),
    totalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
    note: input.note ?? null,
  }
}

function escapeHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`
}

function partyHtml(title: string, party: InvoiceParty): string {
  const rows = [party.name, party.taxId, party.address, party.phone].filter(Boolean)
  return `<section><h2>${escapeHtml(title)}</h2>${rows.map((row) => `<p>${escapeHtml(row)}</p>`).join("")}</section>`
}

export function renderInvoiceHtml(invoice: InvoiceDocument): string {
  const rows = invoice.lines
    .map(
      (line) => `<tr>
<td>${escapeHtml(line.sku)}</td>
<td>${escapeHtml(line.name)}</td>
<td>${line.quantity}</td>
<td>${formatMoney(line.unitPriceCents, invoice.currency)}</td>
<td>${formatMoney(line.discountCents, invoice.currency)}</td>
<td>${line.taxRateBps / 100}%</td>
<td>${formatMoney(line.totalCents, invoice.currency)}</td>
</tr>`,
    )
    .join("")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
<style>
body{font-family:Arial,sans-serif;color:#111827;margin:32px}
h1{font-size:24px;margin:0 0 8px}
h2{font-size:14px;margin:0 0 6px}
p{margin:2px 0}
table{border-collapse:collapse;width:100%;margin-top:24px}
th,td{border:1px solid #d1d5db;padding:8px;text-align:left;font-size:12px}
th{background:#f3f4f6}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:20px}
.totals{margin-left:auto;margin-top:20px;width:280px}
.totals div{display:flex;justify-content:space-between;padding:4px 0}
</style>
</head>
<body>
<h1>Invoice ${escapeHtml(invoice.invoiceNumber)}</h1>
<p>Order: ${escapeHtml(invoice.orderId)}</p>
<p>Issued: ${formatDate(new Date(invoice.issuedAtIso))}${invoice.dueAtIso ? ` · Due: ${formatDate(new Date(invoice.dueAtIso))}` : ""}</p>
<div class="parties">
${partyHtml("Seller", invoice.seller)}
${partyHtml("Buyer", invoice.buyer)}
</div>
<table>
<thead><tr><th>SKU</th><th>Product</th><th>Qty</th><th>Unit</th><th>Discount</th><th>Tax</th><th>Total</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<section class="totals">
<div><span>Subtotal</span><strong>${formatMoney(invoice.subtotalCents, invoice.currency)}</strong></div>
<div><span>Discount</span><strong>${formatMoney(invoice.discountCents, invoice.currency)}</strong></div>
<div><span>Tax</span><strong>${formatMoney(invoice.taxCents, invoice.currency)}</strong></div>
<div><span>Total</span><strong>${formatMoney(invoice.totalCents, invoice.currency)}</strong></div>
</section>
${invoice.note ? `<p>${escapeHtml(invoice.note)}</p>` : ""}
</body>
</html>`
}
