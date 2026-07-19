import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const { handleMobilePhotoUpload, requireApiSession, unauthorized } = vi.hoisted(() => ({
  handleMobilePhotoUpload: vi.fn(),
  requireApiSession: vi.fn(),
  unauthorized: vi.fn(),
}))

vi.mock("@/server/http/api-guard", () => ({ requireApiSession, unauthorized }))
vi.mock("@/server/mobile/photo-upload-handler", () => ({ handleMobilePhotoUpload }))

import { POST } from "./route"

describe("mobile photo upload route", () => {
  beforeEach(() => {
    handleMobilePhotoUpload.mockReset()
    requireApiSession.mockReset()
    unauthorized.mockReset()
  })

  it("does not invoke the shared upload pipeline without a device session", async () => {
    const denied = NextResponse.json({ error: "unauthorized" }, { status: 401 })
    requireApiSession.mockResolvedValue(null)
    unauthorized.mockReturnValue(denied)
    const request = new NextRequest("http://localhost/api/v1/mobile/photos/upload", { method: "POST" })

    const response = await POST(request)

    expect(response).toBe(denied)
    expect(handleMobilePhotoUpload).not.toHaveBeenCalled()
  })

  it("delegates an authenticated device to the shared guarded pipeline", async () => {
    const session = { org: "org-1", sub: "user-1", did: "device-1", role: "FIELD_AGENT" }
    const stored = NextResponse.json({ photoId: "photo-1" }, { status: 201 })
    requireApiSession.mockResolvedValue(session)
    handleMobilePhotoUpload.mockResolvedValue(stored)
    const request = new NextRequest("http://localhost/api/v1/mobile/photos/upload", { method: "POST" })

    const response = await POST(request)

    expect(response).toBe(stored)
    expect(handleMobilePhotoUpload).toHaveBeenCalledWith(request, session)
  })
})
