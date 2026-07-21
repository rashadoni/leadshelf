import { describe, expect, it } from "vitest"
import { demoMediaFallbackAllowed, resolveRuntimeProfile } from "./runtime-profile"

describe("client/demo runtime boundary", () => {
  it("requires an explicit valid profile in production and defaults development to client", () => {
    expect(resolveRuntimeProfile(undefined, "test")).toBe("client")
    expect(resolveRuntimeProfile("client", "production")).toBe("client")
    expect(resolveRuntimeProfile("demo", "production")).toBe("demo")
    expect(() => resolveRuntimeProfile(undefined, "production")).toThrow("runtime profile")
    expect(() => resolveRuntimeProfile("true", "production")).toThrow("runtime profile")
  })

  it("never serves synthetic demo media in the client profile or across tenants", () => {
    const product = "products/org-a/product-1/demo-pack.svg"
    const proof = "photos/org-a/task-1/demo-proof-001.svg"
    expect(demoMediaFallbackAllowed("client", product, "org-a")).toBe(false)
    expect(demoMediaFallbackAllowed("client", proof, "org-a")).toBe(false)
    expect(demoMediaFallbackAllowed("demo", product, "org-b")).toBe(false)
    expect(demoMediaFallbackAllowed("demo", proof, "org-b")).toBe(false)
    expect(demoMediaFallbackAllowed("demo", product, "org-a")).toBe(true)
    expect(demoMediaFallbackAllowed("demo", proof, "org-a")).toBe(true)
  })
})
