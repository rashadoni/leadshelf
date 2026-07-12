import type { MobileTaskStatus } from "@leadshelf/api-contracts/mobile/v1"

/**
 * Один смысл «открытой задачи» для mobile dashboard, route badge и web:
 * работа ещё требует действия агента или проверки отправленного proof.
 */
export const OPEN_TASK_STATUSES = ["NEW", "IN_PROGRESS", "PHOTO_SUBMITTED"] as const satisfies readonly MobileTaskStatus[]

const openTaskStatusSet = new Set<MobileTaskStatus>(OPEN_TASK_STATUSES)

export function isOpenTaskStatus(status: MobileTaskStatus): boolean {
  return openTaskStatusSet.has(status)
}

export function countOpenTaskStatuses(statuses: readonly MobileTaskStatus[]): number {
  return statuses.filter(isOpenTaskStatus).length
}

