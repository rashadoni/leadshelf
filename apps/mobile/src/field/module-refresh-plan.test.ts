import { describe, expect, it } from "vitest"
import type { FieldMobileModules } from "./contracts"
import { fieldModuleRefreshPlan } from "./module-refresh-plan"

function modules(workforce: boolean, routes: boolean): FieldMobileModules {
  return {
    workforce: { enabled: workforce, capabilityId: "workforce-hrm", configVersion: null, cursor: null },
    routes: { enabled: routes, capabilityId: "route-field", configVersion: null },
  }
}

describe("field module refresh plan", () => {
  it("fails closed until bootstrap is validated", () => {
    expect(fieldModuleRefreshPlan(null)).toMatchObject({
      workforce: false,
      routes: false,
      workday: false,
      locations: false,
      sharedRouteSync: false,
    })
  })

  it("keeps HRM-only refreshes independent from route and shelf resources", () => {
    expect(fieldModuleRefreshPlan(modules(true, false))).toEqual({
      workforce: true,
      routes: false,
      workday: true,
      locations: false,
      week: false,
      agentTasks: false,
      sharedRouteSync: false,
    })
  })

  it("does not request Workforce resources for a routes-only tenant", () => {
    expect(fieldModuleRefreshPlan(modules(false, true))).toEqual({
      workforce: false,
      routes: true,
      workday: false,
      locations: true,
      week: true,
      agentTasks: true,
      sharedRouteSync: true,
    })
  })
})
