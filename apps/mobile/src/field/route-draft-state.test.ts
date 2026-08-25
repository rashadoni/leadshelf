import { describe, expect, it } from "vitest"
import {
  isExistingRouteDraftDirty,
  isRouteDraftDirty,
  snapshotExistingRouteDraft,
} from "./route-draft-state"

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

describe("existing route leave guard", () => {
  const initial = snapshotExistingRouteDraft({
    name: "Monday route",
    notes: "Call before arrival",
    points: [{ id: "first" }, { id: "second" }],
    timeInputs: { first: "09:00", second: "09:30" },
  })

  it("allows an unchanged route to close", () => {
    expect(isExistingRouteDraftDirty(initial, {
      name: " Monday route ",
      notes: "Call before arrival",
      points: [{ id: "first" }, { id: "second" }],
      timeInputs: { first: "09:00", second: "09:30" },
    })).toBe(false)
  })

  it("protects text, time, order, added and removed stops", () => {
    const base = {
      name: "Monday route",
      notes: "Call before arrival",
      points: [{ id: "first" }, { id: "second" }],
      timeInputs: { first: "09:00", second: "09:30" },
    }
    expect(isExistingRouteDraftDirty(initial, { ...base, name: "New name" })).toBe(true)
    expect(isExistingRouteDraftDirty(initial, { ...base, timeInputs: { first: "09:15", second: "09:30" } })).toBe(true)
    expect(isExistingRouteDraftDirty(initial, { ...base, points: [{ id: "second" }, { id: "first" }] })).toBe(true)
    expect(isExistingRouteDraftDirty(initial, { ...base, points: [{ id: "first" }] })).toBe(true)
    expect(isExistingRouteDraftDirty(initial, { ...base, points: [{ id: "first" }, { id: "second" }, { id: "third" }] })).toBe(true)
  })
})
