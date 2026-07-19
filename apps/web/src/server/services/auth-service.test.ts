import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}))

vi.mock("../db/client", () => ({
  authDb: { user: { findFirst: mocks.findFirst } },
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

import { login } from "./auth-service"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findFirst.mockResolvedValue(null)
})

describe("office authentication tenant boundary", () => {
  it("qualifies email lookup by the normalized organization slug", async () => {
    await expect(login(" Tenant-B ", " Same@Example.test ", "password")).resolves.toBeNull()
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        organization: { slug: { equals: "Tenant-B", mode: "insensitive" } },
        email: { equals: "Same@Example.test", mode: "insensitive" },
        isActive: true,
      },
    })
  })
})
