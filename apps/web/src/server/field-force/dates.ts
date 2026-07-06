export interface DateFilter {
  gte: Date
  lt: Date
}

export function startOfDay(value: Date) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

export function dateRange(value: Date) {
  const start = startOfDay(value)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

export function dateFilterForDay(value: Date): DateFilter {
  const { start, end } = dateRange(value)
  return { gte: start, lt: end }
}

export function visitDateWhere(dateFilter: DateFilter | null) {
  if (!dateFilter) return {}
  return {
    OR: [
      { createdAt: dateFilter },
      { checkInAt: dateFilter },
      { checkOutAt: dateFilter },
      { routeStop: { plannedAt: dateFilter } },
    ],
  }
}
