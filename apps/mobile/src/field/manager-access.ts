/**
 * Navigation affordance only. The mobile manager APIs remain the authority
 * and can still return 403 when a tenant's scoped permissions do not allow
 * access.
 */
const managerRoles = new Set(["ADMIN", "MANAGER", "SUPERVISOR"])

export function hasFieldManagerRole(role: string | null | undefined): boolean {
  return typeof role === "string" && managerRoles.has(role)
}
