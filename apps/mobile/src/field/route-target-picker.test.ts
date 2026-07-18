import { describe, expect, it } from "vitest"
import { routeTargetKey } from "./route-target"

describe("mobile route target identity", () => {
  it("allows multiple contacts at one organization while deduplicating each contact", () => {
    expect(routeTargetKey("clinic-1", "doctor-1")).toBe("contact:doctor-1")
    expect(routeTargetKey("clinic-1", "doctor-2")).toBe("contact:doctor-2")
    expect(routeTargetKey("pharmacy-1", null)).toBe("customer:pharmacy-1")
  })
})
