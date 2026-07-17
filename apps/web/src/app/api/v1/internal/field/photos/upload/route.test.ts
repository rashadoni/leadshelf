import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const { requireFieldBffSession, handleMobilePhotoUpload } = vi.hoisted(() => ({
  requireFieldBffSession: vi.fn(),
  handleMobilePhotoUpload: vi.fn(),
}))

vi.mock("@/server/field-bff/auth", () => ({ requireFieldBffSession }))
vi.mock("@/server/mobile/photo-upload-handler", () => ({ handleMobilePhotoUpload }))

import { POST } from "./route"

describe("trusted Field BFF photo upload route", () => {
  beforeEach(() => {
    requireFieldBffSession.mockReset()
    handleMobilePhotoUpload.mockReset()
  })

  it("does not parse or store an upload when the federation boundary rejects it", async () => {
    const denied = NextResponse.json({ error: "field_bff_unauthorized" }, { status: 401 })
    requireFieldBffSession.mockResolvedValue({ ok: false, response: denied })
    const request = new NextRequest("http://localhost/api/v1/internal/field/photos/upload", {
      method: "POST",
    })

    const response = await POST(request)

    expect(response).toBe(denied)
    expect(handleMobilePhotoUpload).not.toHaveBeenCalled()
  })

  it("reuses the legacy upload handler with the server-mapped mobile session", async () => {
    const session = { org: "org-1", sub: "user-1", did: "device-1", role: "FIELD_AGENT" }
    const stored = NextResponse.json({ photoId: "photo-1" }, { status: 201 })
    requireFieldBffSession.mockResolvedValue({ ok: true, session })
    handleMobilePhotoUpload.mockResolvedValue(stored)
    const request = new NextRequest("http://localhost/api/v1/internal/field/photos/upload", {
      method: "POST",
    })

    const response = await POST(request)

    expect(response).toBe(stored)
    expect(handleMobilePhotoUpload).toHaveBeenCalledWith(request, session)
  })
})
