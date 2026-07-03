import { NextResponse } from "next/server"

// Замороженный мобильный контракт (docs/12, docs/18): protocolVersion=1.
// Несовместимый клиент получает 426 и должен обновиться.
export const MOBILE_PROTOCOL_VERSION = 1

export function protocolMismatch(received: unknown): NextResponse | null {
  if (received === MOBILE_PROTOCOL_VERSION) return null
  return NextResponse.json(
    {
      error: "upgrade_required",
      supportedProtocolVersion: MOBILE_PROTOCOL_VERSION,
      received: received ?? null,
    },
    { status: 426 },
  )
}
