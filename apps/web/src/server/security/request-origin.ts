const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export function isTrustedMutationOrigin(input: {
  method: string
  requestOrigin: string
  originHeader: string | null
  authorizationHeader: string | null
  allowedOrigins?: string[]
}): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return true
  if (input.authorizationHeader?.startsWith("Bearer ")) return true
  // SameSite=Lax cookie already blocks legacy clients that omit Origin on a
  // cross-site POST. Keep origin-less server-to-server operations compatible.
  if (!input.originHeader) return true
  let origin: string
  try {
    origin = new URL(input.originHeader).origin
  } catch {
    return false
  }
  return origin === input.requestOrigin
    || (input.allowedOrigins ?? []).includes(origin)
}
