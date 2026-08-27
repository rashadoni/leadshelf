import type { FieldWeekData, FieldWeekVisit } from "./contracts"

export type FieldTaskVisitOptionState = "ACTIVE" | "COMPLETED" | "SYNCING"

export type FieldTaskVisitOption = {
  id: string
  date: string
  checkInAt: string
  customer: FieldWeekVisit["customer"]
  contact: FieldWeekVisit["contact"]
  state: FieldTaskVisitOptionState
}

type FieldTaskVisitOptionContext = {
  canCreateTask: boolean
  selectedCustomerId?: string | null
  selectedDate?: string | null
}

function optionState(visit: FieldWeekVisit): FieldTaskVisitOptionState {
  if (visit.syncState === "PENDING") return "SYNCING"
  if (visit.checkOutAt || visit.status === "CHECKED_OUT") return "COMPLETED"
  return "ACTIVE"
}

/**
 * Builds the visit picker only from the already authorized current-week data.
 * Conflict/rejected optimistic visits are omitted because the server cannot
 * safely bind a new task to them. Ownership and tenant checks still remain on
 * the server when the queued task is synchronized.
 */
export function fieldTaskVisitOptions(
  week: Pick<FieldWeekData, "days"> | null,
  context: FieldTaskVisitOptionContext,
): FieldTaskVisitOption[] {
  if (!week || !context.canCreateTask) return []

  const options = new Map<string, FieldTaskVisitOption>()
  for (const day of week.days) {
    for (const visit of day.visits.items) {
      if (visit.syncState === "CONFLICT" || visit.syncState === "REJECTED" || options.has(visit.id)) continue
      options.set(visit.id, {
        id: visit.id,
        date: day.date,
        checkInAt: visit.checkInAt,
        customer: visit.customer,
        contact: visit.contact,
        state: optionState(visit),
      })
    }
  }

  const selectedCustomerId = context.selectedCustomerId ?? null
  const selectedDate = context.selectedDate ?? null
  return [...options.values()].sort((left, right) => {
    const customerRank = Number(right.customer.id === selectedCustomerId) - Number(left.customer.id === selectedCustomerId)
    if (customerRank) return customerRank
    const dateRank = Number(right.date === selectedDate) - Number(left.date === selectedDate)
    if (dateRank) return dateRank
    const stateRank = Number(right.state === "ACTIVE") - Number(left.state === "ACTIVE")
    if (stateRank) return stateRank
    return right.checkInAt.localeCompare(left.checkInAt) || left.customer.name.localeCompare(right.customer.name)
  })
}
