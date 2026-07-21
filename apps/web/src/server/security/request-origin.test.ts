import { describe, expect, it } from "vitest"
import { isTrustedMutationOrigin } from "./request-origin"

const base = {
  method: "POST",
  requestOrigin: "https://client.example.com",
  authorizationHeader: null,
}

describe("API mutation origin policy", () => {
  it("allows same-origin cookie mutations", () => {
    expect(isTrustedMutationOrigin({ ...base, originHeader: base.requestOrigin })).toBe(true)
  })

  it("rejects cross-origin and malformed origins", () => {
    expect(isTrustedMutationOrigin({ ...base, originHeader: "https://evil.example" })).toBe(false)
    expect(isTrustedMutationOrigin({ ...base, originHeader: "not a url" })).toBe(false)
  })

  it("allows bearer mobile calls independently of browser origin", () => {
    expect(isTrustedMutationOrigin({
      ...base,
      originHeader: "https://evil.example",
      authorizationHeader: "Bearer token",
    })).toBe(true)
  })

  it("allows safe methods and explicit secondary origins", () => {
    expect(isTrustedMutationOrigin({ ...base, method: "GET", originHeader: "https://evil.example" })).toBe(true)
    expect(isTrustedMutationOrigin({
      ...base,
      originHeader: "https://admin.example.com",
      allowedOrigins: ["https://admin.example.com"],
    })).toBe(true)
  })
})
