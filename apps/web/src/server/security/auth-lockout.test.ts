import { describe, expect, it } from "vitest"
import {
  configuredAuthLockoutPolicy,
  mobileAccountLockoutKey,
  webAccountLockoutKey,
} from "./auth-lockout"

describe("authentication lockout policy", () => {
  const pepper = "unit-test-lockout-pepper-not-a-secret"

  it("has no developer default and requires an all-or-nothing approved policy", () => {
    expect(configuredAuthLockoutPolicy({})).toBeNull()
    expect(() => configuredAuthLockoutPolicy({ AUTH_LOCKOUT_MAX_FAILURES: "5" })).toThrow("all AUTH_LOCKOUT")
    expect(configuredAuthLockoutPolicy({
      AUTH_LOCKOUT_MAX_FAILURES: "5",
      AUTH_LOCKOUT_WINDOW_SECONDS: "900",
      AUTH_LOCKOUT_DURATION_SECONDS: "1800",
      AUTH_LOCKOUT_PEPPER: pepper,
    })).toEqual({ maxFailures: 5, windowMs: 900_000, lockoutMs: 1_800_000, pepper })
    expect(() => configuredAuthLockoutPolicy({
      AUTH_LOCKOUT_MAX_FAILURES: "1",
      AUTH_LOCKOUT_WINDOW_SECONDS: "900",
      AUTH_LOCKOUT_DURATION_SECONDS: "1800",
      AUTH_LOCKOUT_PEPPER: pepper,
    })).toThrow("between 2 and 100")
    expect(() => configuredAuthLockoutPolicy({
      AUTH_LOCKOUT_MAX_FAILURES: "5",
      AUTH_LOCKOUT_WINDOW_SECONDS: "900",
      AUTH_LOCKOUT_DURATION_SECONDS: "1800",
      AUTH_LOCKOUT_PEPPER: "too-short",
    })).toThrow("at least 32 characters")
  })

  it("uses account-wide peppered opaque keys without IP or plaintext principal", () => {
    const web = webAccountLockoutKey(" Tenant-A ", " Admin@Example.COM ", pepper)
    const mobile = mobileAccountLockoutKey(" Demo ", " M-001 ", pepper)
    expect(web).toMatch(/^[a-f\d]{64}$/)
    expect(mobile).toMatch(/^[a-f\d]{64}$/)
    expect(web).toBe(webAccountLockoutKey("tenant-a", "admin@example.com", pepper))
    expect(web).not.toBe(webAccountLockoutKey("tenant-b", "admin@example.com", pepper))
    expect(mobile).toBe(mobileAccountLockoutKey("demo", "m-001", pepper))
    expect(web).not.toBe(webAccountLockoutKey("tenant-a", "admin@example.com", `${pepper}-rotated`))
    expect(`${web}${mobile}`).not.toMatch(/admin|example|demo|m-001/i)
  })
})
