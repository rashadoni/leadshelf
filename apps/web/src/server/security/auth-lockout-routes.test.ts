import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  accountLockoutState: vi.fn(),
  clearAccountAuthenticationFailures: vi.fn(),
  configuredAuthLockoutPolicy: vi.fn(),
  recordAccountAuthenticationFailure: vi.fn(),
  webAccountLockoutKey: vi.fn(() => "a".repeat(64)),
  mobileAccountLockoutKey: vi.fn(() => "b".repeat(64)),
  consumeRateLimit: vi.fn(),
  login: vi.fn(),
  mobileLogin: vi.fn(),
  writeSecurityAudit: vi.fn(),
}))

vi.mock("@/server/security/auth-lockout", () => ({
  accountLockoutState: mocks.accountLockoutState,
  clearAccountAuthenticationFailures: mocks.clearAccountAuthenticationFailures,
  configuredAuthLockoutPolicy: mocks.configuredAuthLockoutPolicy,
  recordAccountAuthenticationFailure: mocks.recordAccountAuthenticationFailure,
  webAccountLockoutKey: mocks.webAccountLockoutKey,
  mobileAccountLockoutKey: mocks.mobileAccountLockoutKey,
}))
vi.mock("@/server/security/rate-limit", async (importOriginal) => ({
  ...await importOriginal<typeof import("./rate-limit")>(),
  consumeRateLimit: mocks.consumeRateLimit,
}))
vi.mock("@/server/services/auth-service", () => ({ login: mocks.login }))
vi.mock("@/server/services/mobile-auth-service", () => ({ mobileLogin: mocks.mobileLogin }))
vi.mock("@/server/security/audit", () => ({ writeSecurityAudit: mocks.writeSecurityAudit }))

import { POST as webLoginPost } from "@/app/api/auth/login/route"
import { POST as mobileLoginPost } from "@/app/api/v1/mobile/auth/login/route"

const policy = {
  maxFailures: 5,
  windowMs: 900_000,
  lockoutMs: 1_800_000,
  pepper: "unit-test-lockout-pepper-not-a-secret",
}

function request(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.configuredAuthLockoutPolicy.mockReturnValue(policy)
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 })
  mocks.accountLockoutState.mockResolvedValue({
    locked: false,
    failureCount: 0,
    retryAfterSeconds: 0,
    lockedUntil: null,
  })
  mocks.recordAccountAuthenticationFailure.mockResolvedValue({
    locked: false,
    failureCount: 1,
    retryAfterSeconds: 0,
    lockedUntil: null,
  })
  mocks.clearAccountAuthenticationFailures.mockResolvedValue(undefined)
})

describe("login route account lockout", () => {
  it("requires tenant-qualified web credentials before any authentication work", async () => {
    const response = await webLoginPost(request("/api/auth/login", {
      email: "agent@example.test",
      password: "not-a-real-password",
    }))
    expect(response.status).toBe(400)
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled()
    expect(mocks.login).not.toHaveBeenCalled()
  })

  it("does not share the web login rate-limit key between tenants with the same email", async () => {
    mocks.configuredAuthLockoutPolicy.mockReturnValue(null)
    mocks.login.mockResolvedValue(null)
    await webLoginPost(request("/api/auth/login", {
      organizationSlug: "tenant-a",
      email: "shared@example.test",
      password: "not-a-real-password",
    }))
    await webLoginPost(request("/api/auth/login", {
      organizationSlug: "tenant-b",
      email: "shared@example.test",
      password: "not-a-real-password",
    }))
    const keys = mocks.consumeRateLimit.mock.calls.map((call) => call[1])
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it("rejects a locked web account generically before password verification", async () => {
    mocks.accountLockoutState.mockResolvedValue({
      locked: true,
      failureCount: 5,
      retryAfterSeconds: 300,
      lockedUntil: new Date("2026-07-19T04:00:00.000Z"),
    })
    const response = await webLoginPost(request("/api/auth/login", {
      organizationSlug: "tenant-a",
      email: "agent@example.test",
      password: "not-a-real-password",
    }))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "invalid_credentials" })
    expect(response.headers.get("retry-after")).toBe("1")
    expect(mocks.login).not.toHaveBeenCalled()
    expect(mocks.webAccountLockoutKey).toHaveBeenCalledWith(
      "tenant-a",
      "agent@example.test",
      policy.pepper,
    )
    expect(mocks.writeSecurityAudit).toHaveBeenCalledWith("authentication_locked", {
      channel: "web",
      principalKey: "a".repeat(64),
    })
  })

  it("records a failed web authentication and emits a lock audit at threshold", async () => {
    mocks.login.mockResolvedValue(null)
    mocks.recordAccountAuthenticationFailure.mockResolvedValue({
      locked: true,
      failureCount: 5,
      retryAfterSeconds: 1_800,
      lockedUntil: new Date("2026-07-19T04:00:00.000Z"),
    })
    const response = await webLoginPost(request("/api/auth/login", {
      organizationSlug: "tenant-a",
      email: "agent@example.test",
      password: "not-a-real-password",
    }))
    expect(response.status).toBe(401)
    expect(response.headers.get("retry-after")).toBe("1")
    expect(mocks.recordAccountAuthenticationFailure).toHaveBeenCalledWith("web", "a".repeat(64), policy)
    expect(mocks.writeSecurityAudit).toHaveBeenCalledWith("authentication_locked", {
      channel: "web",
      principalKey: "a".repeat(64),
    })
  })

  it("clears mobile account failures only after successful PIN verification", async () => {
    mocks.mobileLogin.mockResolvedValue({
      user: { id: "user-1", name: "Agent", role: "STORE_STAFF", employeeCode: "M-001" },
      tokens: { access: "test-access", refresh: "test-refresh" },
    })
    const response = await mobileLoginPost(request("/api/v1/mobile/auth/login", {
      protocolVersion: 1,
      orgSlug: "demo",
      employeeCode: "M-001",
      pin: "0000",
      device: { id: "device-12345678", platform: "android" },
    }))
    expect(response.status).toBe(200)
    expect(mocks.clearAccountAuthenticationFailures).toHaveBeenCalledWith("mobile", "b".repeat(64))
    expect(mocks.recordAccountAuthenticationFailure).not.toHaveBeenCalled()
  })
})
