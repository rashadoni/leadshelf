import { describe, expect, it } from "vitest"
import { evaluateDemoReadiness, type DemoReadinessSnapshot } from "./readiness-state"

const now = new Date("2026-07-10T10:00:00.000Z")
const ready: DemoReadinessSnapshot = {
  hasDemoStore: true,
  activeProducts: 6,
  canonicalTasks: 1,
  canonicalTaskStatus: "PHOTO_SUBMITTED",
  canonicalTaskDueAt: new Date("2026-07-12T10:00:00.000Z"),
  canonicalProofs: 1,
  pendingReviews: 2,
  fieldAgents: 5,
  activeRoutes: 5,
  visits: 1,
  e2eRoutes: 0,
  e2eTasks: 0,
}

describe("demo readiness", () => {
  it("accepts a complete and clean demo baseline", () => {
    expect(evaluateDemoReadiness(ready, now)).toBe(true)
  })

  it("rejects stale execution data and e2e artifacts", () => {
    expect(evaluateDemoReadiness({ ...ready, canonicalTaskDueAt: now }, now)).toBe(false)
    expect(evaluateDemoReadiness({ ...ready, e2eRoutes: 1 }, now)).toBe(false)
    expect(evaluateDemoReadiness({ ...ready, canonicalProofs: 0 }, now)).toBe(false)
  })
})
