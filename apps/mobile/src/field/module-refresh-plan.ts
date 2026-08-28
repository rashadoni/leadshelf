import type { FieldMobileModules } from "./contracts"

/**
 * Capability decisions are server-owned. Until a validated bootstrap is
 * available, the client fails closed and makes no domain-specific requests.
 */
export function fieldModuleRefreshPlan(modules: FieldMobileModules | null) {
  const workforce = modules?.workforce.enabled === true
  const routes = modules?.routes.enabled === true

  return {
    workforce,
    routes,
    workday: workforce,
    locations: routes,
    week: routes,
    agentTasks: routes,
    sharedRouteSync: routes,
  }
}
