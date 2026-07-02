import { NextResponse, type NextRequest } from "next/server"
import { ACCESS_COOKIE } from "../auth/cookies"
import { verifyAccessToken, type AccessClaims } from "../auth/jwt"

// Guard для route handlers: middleware до /api не дотягивается (осознанно),
// каждый API-роут проверяет access-токен сам.

export async function requireApiSession(req: NextRequest): Promise<AccessClaims | null> {
  const token = req.cookies.get(ACCESS_COOKIE)?.value
  if (!token) return null
  try {
    return await verifyAccessToken(token)
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
