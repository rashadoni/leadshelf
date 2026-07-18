import { describe, expect, it } from "vitest"
import { resolveCorrelationId } from "./correlation-id"

describe("resolveCorrelationId", () => {
  it("keeps a safe caller trace", () => {
    expect(resolveCorrelationId("mobile:op_01-abc", () => "generated")).toBe("mobile:op_01-abc")
  })

  it("generates an id for missing, oversized, or injectable values", () => {
    expect(resolveCorrelationId(null, () => "generated")).toBe("generated")
    expect(resolveCorrelationId("bad trace with spaces", () => "generated")).toBe("generated")
    expect(resolveCorrelationId("x\nforged=true", () => "generated")).toBe("generated")
    expect(resolveCorrelationId("x".repeat(129), () => "generated")).toBe("generated")
  })
})
