export interface QueuedOrderLine {
  productId: string
  quantity: number
}

export interface ParsedQueuedOrderPayload {
  storeId: string
  visitId: string | null
  lines: QueuedOrderLine[]
  unitCount: number
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function parseQueuedOrderPayload(raw: string): ParsedQueuedOrderPayload {
  try {
    const payload = record(JSON.parse(raw) as unknown)
    const rawLines = Array.isArray(payload?.lines) ? payload.lines : []
    const lines = rawLines.flatMap((rawLine): QueuedOrderLine[] => {
      const line = record(rawLine)
      const productId = typeof line?.productId === "string" ? line.productId : ""
      const quantity = typeof line?.quantity === "number" ? line.quantity : 0
      return productId && Number.isFinite(quantity) && quantity > 0 ? [{ productId, quantity }] : []
    })

    return {
      storeId: typeof payload?.storeId === "string" ? payload.storeId : "",
      visitId: typeof payload?.visitId === "string" ? payload.visitId : null,
      lines,
      unitCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    }
  } catch {
    return { storeId: "", visitId: null, lines: [], unitCount: 0 }
  }
}

export function parseQueuedOrderDetailCode(raw: string | null): string | null {
  if (!raw) return null
  try {
    const detail = JSON.parse(raw) as unknown
    if (typeof detail === "string") return detail
    const code = record(detail)?.code
    return typeof code === "string" && code.length > 0 ? code : null
  } catch {
    return null
  }
}
