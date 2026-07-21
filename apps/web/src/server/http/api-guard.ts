import { NextResponse, type NextRequest } from "next/server"
import { ACCESS_COOKIE } from "../auth/cookies"
import { verifyAccessToken, type AccessClaims } from "../auth/jwt"
import { writeApiContextLog } from "../observability/api-context-log"

// Guard для route handlers: middleware до /api не дотягивается (осознанно),
// каждый API-роут проверяет access-токен сам.

export async function requireApiSession(req: NextRequest): Promise<AccessClaims | null> {
  // web -> httpOnly cookie; mobile -> Authorization: Bearer <access>
  const bearer = req.headers.get("authorization")
  const token = bearer?.startsWith("Bearer ")
    ? bearer.slice(7)
    : req.cookies.get(ACCESS_COOKIE)?.value
  if (!token) return null
  try {
    const claims = await verifyAccessToken(token)
    writeApiContextLog(req, claims)
    return claims
  } catch {
    return null
  }
}

export function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}

export function forbidden() {
  return NextResponse.json({ error: "forbidden" }, { status: 403 })
}

const IMPORT_ROLES = new Set(["OWNER", "ADMIN", "CATEGORY_MANAGER"])

export function canImport(session: AccessClaims): boolean {
  return IMPORT_ROLES.has(session.role)
}
