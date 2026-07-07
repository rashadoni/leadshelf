// Кто может быть ИСПОЛНИТЕЛЕМ задачи выкладки (мобильный/полевой актор).
// Единый источник для API-валидации и селектора в UI, чтобы не разъезжались
// (docs/26 §6). Office-роли (OWNER/ADMIN/CATEGORY_MANAGER/ANALYST) назначают,
// но сами задачи в поле не исполняют. Значения сверяются с UserRole на месте
// использования (Prisma `role: { in: [...ASSIGNABLE_ROLES] }`); Prisma не
// импортируем здесь — route-слой ходит только через tenantDb (docs/12).
export const ASSIGNABLE_ROLES = [
  "MERCHANDISER",
  "SUPERVISOR",
  "STORE_STAFF",
  "FIELD_AGENT",
] as const

const ASSIGNABLE_ROLE_SET: ReadonlySet<string> = new Set(ASSIGNABLE_ROLES)

export function isAssignableRole(role: string): boolean {
  return ASSIGNABLE_ROLE_SET.has(role)
}
