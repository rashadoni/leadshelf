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

/**
 * LeadShelf's direct protocol predates the capability manifest. Its existing
 * combined Field UI must therefore remain visible while its local bootstrap
 * fallback is resolved. LeadDrive Field has the opposite rule: without a
 * validated manifest it exposes neither independent module.
 */
export function fieldModuleUiPlan(
  isLeadDriveField: boolean,
  modules: FieldMobileModules | null,
) {
  const plan = fieldModuleRefreshPlan(modules)
  return {
    workforce: !isLeadDriveField || plan.workforce,
    routes: !isLeadDriveField || plan.routes,
  }
}
