import { afterEach, describe, expect, it, vi } from "vitest"
import { cookieOptions } from "./cookies"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("cookieOptions", () => {
  it("keeps auth cookies secure in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("LEADSHELF_E2E_HTTP_ORIGIN", "")
    expect(cookieOptions(60).secure).toBe(true)
  })

  it("allows plain HTTP only for the exact local Playwright origin", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("LEADSHELF_E2E_HTTP_ORIGIN", "http://localhost:3100")
    expect(cookieOptions(60).secure).toBe(false)

    vi.stubEnv("LEADSHELF_E2E_HTTP_ORIGIN", "http://example.com")
    expect(cookieOptions(60).secure).toBe(true)
  })
})
