import { describe, expect, it } from "vitest"
import { buildDemoSeedFailureLog, buildDemoSeedReadyLog } from "../demo-seed-log"

describe("demo seed structured logs", () => {
  it("reports readiness without credentials, email addresses or display names", () => {
    const line = buildDemoSeedReadyLog({
      organizationId: "org_demo_1",
      organizationSlug: "demo",
      userCount: 5,
      mobileUserCount: 1,
      removedE2eRoutes: 2,
      removedE2eTasks: 3,
    })
    expect(JSON.parse(line)).toEqual({
      level: "info",
      event: "demo_seed_ready",
      organizationId: "org_demo_1",
      organizationSlug: "demo",
      userCount: 5,
      mobileUserCount: 1,
      removedE2eRoutes: 2,
      removedE2eTasks: 3,
    })
    expect(line).not.toMatch(/password|pin|email|@/i)
  })

  it("allowlists failure metadata instead of serializing a private error", () => {
    const error = Object.assign(new Error("private infrastructure failure detail"), {
      code: "P1001",
      token: "must-not-leak",
    })
    const line = buildDemoSeedFailureLog(error)
    expect(JSON.parse(line)).toEqual({
      level: "error",
      event: "demo_seed_failed",
      errorName: "Error",
      errorCode: "P1001",
    })
    expect(line).not.toContain("private")
    expect(line).not.toContain("token")
  })
})
