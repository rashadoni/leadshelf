import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { hasValidFieldBffToken, parseFieldPrincipal } from "./auth"

const SECRET = "field-bff-test-secret-at-least-32-characters"

function request(headers: Record<string, string>) {
  return new NextRequest("http://localhost/api/v1/internal/field/sync/pull", { headers })
}

describe("Field BFF authentication boundary", () => {
  it("requires a configured long secret and an exact bearer token", () => {
    expect(hasValidFieldBffToken(`Bearer ${SECRET}`, SECRET)).toBe(true)
    expect(hasValidFieldBffToken("Bearer wrong", SECRET)).toBe(false)
    expect(hasValidFieldBffToken(`Bearer ${SECRET}`, "short")).toBe(false)
    expect(hasValidFieldBffToken(null, SECRET)).toBe(false)
  })

  it("parses a complete trusted principal without accepting arbitrary fields", () => {
    const principal = parseFieldPrincipal(request({
      "x-field-org-slug": "mars",
      "x-field-agent-id": "agent-42",
      "x-field-agent-email": "AGENT@EXAMPLE.COM",
      "x-field-agent-name": "Farid Mammadov",
      "x-field-device-id": "device-12345678",
      "x-field-device-platform": "android",
    }))

    expect(principal).toEqual({
      organizationSlug: "mars",
      externalAgentId: "agent-42",
      email: "agent@example.com",
      name: "Farid Mammadov",
      deviceId: "device-12345678",
      devicePlatform: "android",
    })
  })

  it("rejects incomplete, malformed, or header-injected principals", () => {
    expect(parseFieldPrincipal(request({
      "x-field-org-slug": "Mars With Spaces",
      "x-field-agent-id": "agent-42",
      "x-field-agent-name": "Farid",
      "x-field-device-id": "device-12345678",
    }))).toBeNull()

    expect(parseFieldPrincipal(request({
      "x-field-org-slug": "mars",
      "x-field-agent-id": "agent-42",
      "x-field-agent-email": "not-an-email",
      "x-field-agent-name": "Farid",
      "x-field-device-id": "device-12345678",
    }))).toBeNull()

    expect(parseFieldPrincipal(request({
      "x-field-org-slug": "mars",
      "x-field-agent-id": "agent-42",
      "x-field-agent-name": "Farid",
    }))).toBeNull()
  })
})
