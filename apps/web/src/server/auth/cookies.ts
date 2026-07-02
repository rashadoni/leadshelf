export const ACCESS_COOKIE = "ls_access"
export const REFRESH_COOKIE = "ls_refresh"

export const ACCESS_MAX_AGE = 60 * 15 // 15 минут
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 30 // 30 дней

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  }
}
