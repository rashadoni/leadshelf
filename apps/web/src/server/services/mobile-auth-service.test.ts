import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findOrganization: vi.fn(),
  findUser: vi.fn(),
}))

vi.mock("../db/client", () => ({
  authDb: {
    organization: { findFirst: mocks.findOrganization },
    user: { findFirst: mocks.findUser },
    mobileDevice: { upsert: vi.fn() },
  },
}))
vi.mock("../auth/password", () => ({ verifyPassword: vi.fn() }))
vi.mock("../auth/jwt", () => ({
  signAccessToken: vi.fn(),
  signRefreshToken: vi.fn(),
  verifyRefreshToken: vi.fn(),
}))
vi.mock("../auth/session-store", () => ({
  newSessionIds: vi.fn(),
  persistSession: vi.fn(),
  revokeSession: vi.fn(),
  rotateSession: vi.fn(),
}))

import { mobileLogin } from "./mobile-auth-service"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findOrganization.mockResolvedValue({ id: "org-1" })
  mocks.findUser.mockResolvedValue(null)
})

describe("mobile authentication tenant boundary", () => {
  it("normalizes organization and employee-code lookup case-insensitively", async () => {
    await expect(mobileLogin({
      orgSlug: " Tenant-A ",
      employeeCode: " FIELD-007 ",
      pin: "0000",
      device: { id: "device-12345678", platform: "android" },
    })).resolves.toBeNull()
    expect(mocks.findOrganization).toHaveBeenCalledWith({
      where: { slug: { equals: "Tenant-A", mode: "insensitive" } },
      select: { id: true },
    })
    expect(mocks.findUser).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        employeeCode: { equals: "FIELD-007", mode: "insensitive" },
        isActive: true,
      },
    })
  })
})
