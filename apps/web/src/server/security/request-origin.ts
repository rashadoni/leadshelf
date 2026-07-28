const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Canonical public origin of the request. Behind a reverse proxy (Caddy, and
 * Cloudflare in front of it) the socket Next.js terminates is plain http to an
 * internal host, so `req.nextUrl.origin` is NOT what the browser sees. The
 * browser's `Origin` header carries the real public origin, so the same-origin
 * mutation check must compare against the proxy-forwarded host/proto, not the
 * internal one. Caddy overwrites these headers, so client spoofing is blocked.
 */
export function forwardedRequestOrigin(input: {
  fallbackOrigin: string
  forwardedProto: string | null
  forwardedHost: string | null
}): string {
  const host = input.forwardedHost?.split(",")[0]?.trim()
  if (!host) return input.fallbackOrigin
  let fallbackProto: string
  try {
    fallbackProto = new URL(input.fallbackOrigin).protocol.replace(":", "")
  } catch {
    fallbackProto = "https"
  }
  const proto = input.forwardedProto?.split(",")[0]?.trim() || fallbackProto
  try {
    return new URL(`${proto}://${host}`).origin
  } catch {
    return input.fallbackOrigin
  }
}

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
