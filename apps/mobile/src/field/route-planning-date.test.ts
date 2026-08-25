import { describe, expect, it } from "vitest"
import { isRouteDraftDateAllowed, resolveRouteDraftDate } from "./route-planning-date"

const days = [
  { date: "2026-08-24", isToday: true, routePlanningAllowed: true },
  { date: "2026-08-25", isToday: false, routePlanningAllowed: false },
  { date: "2026-08-26", isToday: false, routePlanningAllowed: true },
] as const

describe("route draft calendar date", () => {
  it("does not silently replace an explicit unavailable calendar date", () => {
    expect(resolveRouteDraftDate("2026-08-25", "2026-08-25", days, null)).toBe("2026-08-25")
    expect(isRouteDraftDateAllowed("2026-08-25", days, null)).toBe(false)
  })

  it("keeps an intentional allowed selection and otherwise chooses today", () => {
    expect(resolveRouteDraftDate("2026-08-26", "2026-08-25", days, null)).toBe("2026-08-26")
    expect(resolveRouteDraftDate(null, "2026-08-25", days, null)).toBe("2026-08-24")
  })
})
