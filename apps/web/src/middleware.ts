import createMiddleware from "next-intl/middleware"
import { NextRequest, NextResponse } from "next/server"
import { routing } from "./i18n/routing"
import { ACCESS_COOKIE } from "./server/auth/cookies"
import { verifyAccessToken } from "./server/auth/jwt"
import { isTrustedMutationOrigin } from "./server/security/request-origin"
import { resolveCorrelationId } from "./server/security/correlation-id"

// Edge runtime: только jose. Никакого Prisma/Argon2 здесь (docs/12).
const intl = createMiddleware(routing)

const LOGIN_PATH = /^\/(az|ru)\/login(\/|$)/

export default async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    const correlationId = resolveCorrelationId(req.headers.get("x-correlation-id"))
    const responseHeaders = { "x-correlation-id": correlationId }
    const allowedOrigins = (process.env.ALLOWED_WEB_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
    const trusted = isTrustedMutationOrigin({
      method: req.method,
      requestOrigin: req.nextUrl.origin,
      originHeader: req.headers.get("origin"),
      authorizationHeader: req.headers.get("authorization"),
      allowedOrigins,
    })
    if (!trusted) {
      return NextResponse.json(
        { error: "untrusted_origin", correlationId },
        { status: 403, headers: responseHeaders },
      )
    }

    const requestHeaders = new Headers(req.headers)
    requestHeaders.set("x-correlation-id", correlationId)
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    response.headers.set("x-correlation-id", correlationId)
    return response
  }

  const response = intl(req)
  // локальный redirect (добавление /az) — отдаем сразу, auth проверит след. заход
  if (response.status >= 300 && response.status < 400) return response

  const { pathname } = req.nextUrl
  if (LOGIN_PATH.test(pathname)) return response

  const token = req.cookies.get(ACCESS_COOKIE)?.value
  const session = token ? await verifyAccessToken(token).catch(() => null) : null
  if (!session) {
    const seg = pathname.split("/")[1]
    const locale = routing.locales.includes(seg as never) ? seg : routing.defaultLocale
    const loginUrl = new URL(`/${locale}/login`, req.url)
    loginUrl.searchParams.set("next", `${req.nextUrl.pathname}${req.nextUrl.search}`)
    return NextResponse.redirect(loginUrl)
  }
  return response
}

export const config = {
  matcher: ["/api/:path*", "/((?!api|_next|_vercel|.*\\..*).*)"],
}
