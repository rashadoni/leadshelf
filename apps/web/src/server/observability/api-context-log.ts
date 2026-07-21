import type { AccessClaims } from "../auth/jwt"

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/
const TASK_PATH = /\/tasks\/([^/?#]+)/

interface ApiRequestContext {
  method: string
  nextUrl: { pathname: string }
  headers: { get(name: string): string | null }
}

export interface ApiContextLog {
  timestamp: string
  level: "info"
  event: "api_authenticated"
  method: string
  pathname: string
  correlationId?: string
  organizationId: string
  userId: string
  deviceId?: string
  taskId?: string
}

function safeId(value: string | undefined | null): string | undefined {
  const normalized = value?.trim()
  return normalized && SAFE_ID.test(normalized) ? normalized : undefined
}

export function buildApiContextLog(
  request: ApiRequestContext,
  claims: AccessClaims,
  now = new Date(),
): ApiContextLog {
  const taskId = safeId(request.nextUrl.pathname.match(TASK_PATH)?.[1])
  return {
    timestamp: now.toISOString(),
    level: "info",
    event: "api_authenticated",
    method: request.method,
    // Query parameters are deliberately excluded: they may contain search
    // terms, export filters or accidental personal data.
    pathname: request.nextUrl.pathname,
    correlationId: safeId(request.headers.get("x-correlation-id")),
    organizationId: claims.org,
    userId: claims.sub,
    deviceId: safeId(claims.did),
    taskId,
  }
}

export function writeApiContextLog(
  request: ApiRequestContext,
  claims: AccessClaims,
  sink: (line: string) => void = console.info,
): void {
  sink(JSON.stringify(buildApiContextLog(request, claims)))
}
