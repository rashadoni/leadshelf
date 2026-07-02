import "server-only"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { ACCESS_COOKIE } from "./cookies"
import { verifyAccessToken, type AccessClaims } from "./jwt"

export async function getSession(): Promise<AccessClaims | null> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value
  if (!token) return null
  try {
    return await verifyAccessToken(token)
  } catch {
    return null
  }
}

/** Серверная защита (app)-layout: middleware — грубый фильтр, это — точный. */
export async function requireSession(locale: string): Promise<AccessClaims> {
  const session = await getSession()
  if (!session) redirect(`/${locale}/login`)
  return session
}
