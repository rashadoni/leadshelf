import { NextRequest, NextResponse } from "next/server"
import { refresh } from "@/server/services/auth-service"
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  cookieOptions,
} from "@/server/auth/cookies"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const token = req.cookies.get(REFRESH_COOKIE)?.value
  if (!token) return NextResponse.json({ error: "no_refresh" }, { status: 401 })

  const pair = await refresh(token)
  if (!pair) {
    const res = NextResponse.json({ error: "invalid_refresh" }, { status: 401 })
    res.cookies.delete(ACCESS_COOKIE)
    res.cookies.delete(REFRESH_COOKIE)
    return res
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(ACCESS_COOKIE, pair.access, cookieOptions(ACCESS_MAX_AGE))
  res.cookies.set(REFRESH_COOKIE, pair.refresh, cookieOptions(REFRESH_MAX_AGE))
  return res
}
