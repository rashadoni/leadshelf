import { describe, expect, it } from "vitest"
import { forwardedRequestOrigin, isTrustedMutationOrigin } from "./request-origin"

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

  it("treats a browser POST as same-origin once the proxy origin is reconstructed", () => {
    // Reproduces the hermescrm.xyz 403: internal socket is http://web:3000,
    // browser Origin is the public https host. Without reconstruction the
    // check compares against the internal origin and rejects every login.
    const requestOrigin = forwardedRequestOrigin({
      fallbackOrigin: "http://web:3000",
      forwardedProto: "https",
      forwardedHost: "hermescrm.xyz",
    })
    expect(requestOrigin).toBe("https://hermescrm.xyz")
    expect(isTrustedMutationOrigin({
      method: "POST",
      requestOrigin,
      originHeader: "https://hermescrm.xyz",
      authorizationHeader: null,
    })).toBe(true)
  })
})

describe("forwardedRequestOrigin", () => {
  const fallbackOrigin = "http://web:3000"

  it("rebuilds the public origin from proxy forwarded headers", () => {
    expect(forwardedRequestOrigin({
      fallbackOrigin,
      forwardedProto: "https",
      forwardedHost: "hermescrm.xyz",
    })).toBe("https://hermescrm.xyz")
  })

  it("uses the first hop when headers carry a proxy chain", () => {
    expect(forwardedRequestOrigin({
      fallbackOrigin,
      forwardedProto: "https, http",
      forwardedHost: "hermescrm.xyz, web:3000",
    })).toBe("https://hermescrm.xyz")
  })

  it("falls back to the request origin proto when only the host is forwarded", () => {
    expect(forwardedRequestOrigin({
      fallbackOrigin: "https://web:3000",
      forwardedProto: null,
      forwardedHost: "hermescrm.xyz",
    })).toBe("https://hermescrm.xyz")
  })

  it("falls back to the internal origin when no host is forwarded", () => {
    expect(forwardedRequestOrigin({
      fallbackOrigin,
      forwardedProto: "https",
      forwardedHost: null,
    })).toBe(fallbackOrigin)
  })

  it("falls back to the internal origin on a malformed forwarded host", () => {
    expect(forwardedRequestOrigin({
      fallbackOrigin,
      forwardedProto: "https",
      forwardedHost: "not a host",
    })).toBe(fallbackOrigin)
  })
})
