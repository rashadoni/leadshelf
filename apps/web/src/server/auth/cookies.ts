export const ACCESS_COOKIE = "ls_access"
export const REFRESH_COOKIE = "ls_refresh"

export const ACCESS_MAX_AGE = 60 * 15 // 15 минут
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 30 // 30 дней

export function cookieOptions(maxAge: number) {
  const isLocalPlaywrightHttp =
    process.env.NODE_ENV === "production" &&
    process.env.LEADSHELF_E2E_HTTP_ORIGIN === "http://localhost:3100"
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && !isLocalPlaywrightHttp,
    path: "/",
    maxAge,
  }
}
