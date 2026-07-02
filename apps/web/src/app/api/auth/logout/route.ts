import { NextRequest, NextResponse } from "next/server"
import { logout } from "@/server/services/auth-service"
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/server/auth/cookies"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  await logout(req.cookies.get(REFRESH_COOKIE)?.value)
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(ACCESS_COOKIE)
  res.cookies.delete(REFRESH_COOKIE)
  return res
}
