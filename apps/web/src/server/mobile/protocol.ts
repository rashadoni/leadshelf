import { NextResponse } from "next/server"

// Замороженный мобильный контракт (docs/12, docs/18): protocolVersion=1.
// Несовместимый клиент получает 426 и должен обновиться.
export const MOBILE_PROTOCOL_VERSION = 1

const PROTOCOL_HEADER = "x-leadshelf-protocol"

export function isSupportedProtocol(received: unknown): boolean {
  return received === MOBILE_PROTOCOL_VERSION
}

export function protocolMismatch(received: unknown): NextResponse | null {
  if (isSupportedProtocol(received)) return null
  return NextResponse.json(
    {
      error: "upgrade_required",
      supportedProtocolVersion: MOBILE_PROTOCOL_VERSION,
      received: received ?? null,
    },
    { status: 426 },
  )
}

// Для не-JSON запросов (multipart upload, GET media) протокол едет заголовком
// `x-leadshelf-protocol`. required=true — заголовок обязателен (write-путь);
// required=false — валидируем только если прислан (GET-медиа, чтобы не ломать
// клиентов, которые физически не могут выставить заголовок).
export function protocolMismatchFromHeader(
  req: { headers: Headers },
  { required = true }: { required?: boolean } = {},
): NextResponse | null {
  const raw = req.headers.get(PROTOCOL_HEADER)
  if (raw == null) return required ? protocolMismatch(null) : null
  return protocolMismatch(Number(raw))
}
