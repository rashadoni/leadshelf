import { describe, expect, it } from "vitest"
import { isRouteDraftDirty } from "./route-draft-state"

describe("route draft leave guard", () => {
  const base = {
    initialDate: "2026-08-24",
    selectedDate: "2026-08-24",
    name: "",
    notes: "",
    targetCount: 0,
  }

  it("allows a fresh calendar entry to close immediately", () => {
    expect(isRouteDraftDirty(base)).toBe(false)
  })

  it("protects a changed day, selected stop, or typed review text", () => {
    expect(isRouteDraftDirty({ ...base, selectedDate: "2026-08-25" })).toBe(true)
    expect(isRouteDraftDirty({ ...base, targetCount: 1 })).toBe(true)
    expect(isRouteDraftDirty({ ...base, name: "Monday route" })).toBe(true)
    expect(isRouteDraftDirty({ ...base, notes: "  Call before arrival  " })).toBe(true)
  })
})
