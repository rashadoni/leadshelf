import createMiddleware from "next-intl/middleware"
import { NextRequest, NextResponse } from "next/server"
import { routing } from "./i18n/routing"
import { ACCESS_COOKIE } from "./server/auth/cookies"
import { verifyAccessToken } from "./server/auth/jwt"

// Edge runtime: только jose. Никакого Prisma/Argon2 здесь (docs/12).
const intl = createMiddleware(routing)

const LOGIN_PATH = /^\/(az|ru)\/login(\/|$)/

export default async function middleware(req: NextRequest) {
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
  // всё, кроме api (защищается само), статики и файлов с расширением
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
}
