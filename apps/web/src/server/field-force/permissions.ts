export const FIELD_FORCE_ADMIN_ROLES = new Set(["OWNER", "ADMIN", "SUPERVISOR"])
export const FIELD_FORCE_ROLES = new Set(["OWNER", "ADMIN", "SUPERVISOR", "MERCHANDISER", "STORE_STAFF"])

export function canReadFieldForce(role: string) {
  return FIELD_FORCE_ROLES.has(role)
}

export function canAdminFieldForce(role: string) {
  return FIELD_FORCE_ADMIN_ROLES.has(role)
}

export function isLimitedFieldForceRole(role: string) {
  return role === "MERCHANDISER" || role === "STORE_STAFF"
}
