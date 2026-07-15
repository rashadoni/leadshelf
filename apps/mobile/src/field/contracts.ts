export type FieldRouteStatus =
  | "DRAFT"
  | "PLANNED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "MISSED"

export type FieldCalendarKind =
  | "WORKING_DAY"
  | "WEEKEND"
  | "PUBLIC_HOLIDAY"
  | "COMPANY_HOLIDAY"
  | "EXCEPTION_WORKDAY"
  | "MOVED_WORKDAY"
  | "MOVED_DAY_OFF"

export interface FieldAgentProfile {
  id: string
  name: string
  email: string | null
  phone: string | null
  role: string
  status: string
  avatar: string | null
  isOnline: boolean
  organizationId: string
  organizationName: string
  manager: { id: string; name: string } | null
}

export interface FieldProfileData {
  agent: FieldAgentProfile
  todaySummary: {
    date: string
    timezone: string
    visits: number
    tasksCompleted: number
    routes: number
    routePoints: number
    routeVisited: number
    routeStatus: FieldRouteStatus | "NONE"
    routeStatuses: FieldRouteStatus[]
  }
  capabilities: {
    shelfExecution: { enabled: boolean; reason: string | null }
  }
}

export interface FieldRoutePoint {
  id: string
  customerId: string
  orderIndex: number
  status: string
  effectiveStatus: "PENDING" | "VISITED" | "MISSED"
  plannedTime: string | null
  visitedAt: string | null
  notes: string | null
  customer: {
    id: string
    name: string
    code: string | null
    objectType: string
    category: string
    address: string | null
    city: string | null
    phone: string | null
    latitude: number | null
    longitude: number | null
  }
}

export interface FieldWeekRoute {
  id: string
  name: string | null
  date: string
  persistedStatus: Exclude<FieldRouteStatus, "MISSED">
  effectiveStatus: FieldRouteStatus
  agentId: string
  totalPoints: number
  visitedPoints: number
  startedAt: string | null
  completedAt: string | null
  notes: string | null
  assignmentRole: "PRIMARY" | "PARTICIPANT" | "OBSERVER" | null
  canExecute: boolean
  canEdit: boolean
  canPublish: boolean
  points: FieldRoutePoint[]
}

export interface FieldWeekTask {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  dueDate: string | null
  completedAt: string | null
  customer: { id: string; name: string } | null
}

export interface FieldWeekVisit {
  id: string
  customerId: string
  status: string
  checkInAt: string
  checkOutAt: string | null
  outcome: string | null
  customer: { id: string; name: string; objectType: string }
}

export interface FieldWeekDay {
  date: string
  isToday: boolean
  isWeekend: boolean
  isWorkingDay: boolean
  nonWorkingReason: string | null
  calendarKind: FieldCalendarKind
  calendarSource: string
  calendarOverrideId: string | null
  movedToDate: string | null
  routePlanningAllowed: boolean
  routes: FieldWeekRoute[]
  tasks: { total: number; completed: number; overdue: number; items: FieldWeekTask[] }
  visits: { total: number; completed: number; items: FieldWeekVisit[] }
}

export interface FieldWeekData {
  protocolVersion: number
  timezone: string
  weekStart: string
  weekEndExclusive: string
  today: string
  calendarSource: string
  days: FieldWeekDay[]
  summary: {
    routes: number
    draftRoutes: number
    plannedStops: number
    visitedStops: number
    missedStops: number
    tasks: number
    tasksCompleted: number
    visits: number
    visitsCompleted: number
    coverage: { plannedCustomers: number; coveredCustomers: number; percentage: number }
  }
  capabilities: {
    createOwnDraft: boolean
    editOwnDraft: boolean
    selfPublish: boolean
    requestRouteChange: boolean
    requestCustomer: boolean
  }
}

export interface FieldNotification {
  id: string
  title: string
  body: string | null
  type: string
  isRead: boolean
  metadata: unknown | null
  createdAt: string
}

export interface FieldNotificationsData {
  items: FieldNotification[]
  unread: number
}

export class FieldContractError extends Error {
  constructor(contract: string) {
    super(`Invalid ${contract} response`)
    this.name = "FieldContractError"
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function validEnvelope(value: unknown): Record<string, unknown> | null {
  const envelope = record(value)
  if (!envelope || envelope.success !== true) return null
  return record(envelope.data)
}

function string(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function boolean(value: unknown): value is boolean {
  return typeof value === "boolean"
}

function dateKey(value: unknown): value is string {
  return string(value) && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function parseFieldProfile(value: unknown): FieldProfileData {
  const data = validEnvelope(value)
  const agent = record(data?.agent)
  const summary = record(data?.todaySummary)
  const capabilities = record(data?.capabilities)
  const shelfExecution = record(capabilities?.shelfExecution)
  if (
    !data ||
    !agent ||
    !string(agent.id) ||
    !string(agent.name) ||
    !string(agent.organizationId) ||
    !string(agent.organizationName) ||
    !summary ||
    !dateKey(summary.date) ||
    !string(summary.timezone) ||
    !number(summary.visits) ||
    !number(summary.tasksCompleted) ||
    !number(summary.routePoints) ||
    !number(summary.routeVisited) ||
    !shelfExecution ||
    !boolean(shelfExecution.enabled)
  ) {
    throw new FieldContractError("mobile profile")
  }
  return data as unknown as FieldProfileData
}

function validWeekRoute(value: unknown): boolean {
  const route = record(value)
  return Boolean(
    route &&
      string(route.id) &&
      dateKey(route.date) &&
      string(route.effectiveStatus) &&
      number(route.totalPoints) &&
      number(route.visitedPoints) &&
      boolean(route.canExecute) &&
      boolean(route.canEdit) &&
      Array.isArray(route.points),
  )
}

function validWeekDay(value: unknown): boolean {
  const day = record(value)
  const tasks = record(day?.tasks)
  const visits = record(day?.visits)
  return Boolean(
    day &&
      dateKey(day.date) &&
      boolean(day.isToday) &&
      boolean(day.isWorkingDay) &&
      string(day.calendarKind) &&
      boolean(day.routePlanningAllowed) &&
      Array.isArray(day.routes) &&
      day.routes.every(validWeekRoute) &&
      tasks &&
      number(tasks.total) &&
      Array.isArray(tasks.items) &&
      visits &&
      number(visits.total) &&
      Array.isArray(visits.items),
  )
}

export function parseFieldWeek(value: unknown): FieldWeekData {
  const data = validEnvelope(value)
  const summary = record(data?.summary)
  const coverage = record(summary?.coverage)
  const capabilities = record(data?.capabilities)
  if (
    !data ||
    !number(data.protocolVersion) ||
    !string(data.timezone) ||
    !dateKey(data.weekStart) ||
    !dateKey(data.weekEndExclusive) ||
    !dateKey(data.today) ||
    !Array.isArray(data.days) ||
    data.days.length !== 7 ||
    !data.days.every(validWeekDay) ||
    !summary ||
    !number(summary.plannedStops) ||
    !number(summary.visitedStops) ||
    !number(summary.missedStops) ||
    !coverage ||
    !number(coverage.percentage) ||
    !capabilities ||
    !boolean(capabilities.editOwnDraft) ||
    !boolean(capabilities.requestRouteChange)
  ) {
    throw new FieldContractError("mobile week")
  }
  return data as unknown as FieldWeekData
}

export function parseFieldNotifications(value: unknown): FieldNotificationsData {
  const data = validEnvelope(value)
  if (!data || !Array.isArray(data.items) || !number(data.unread)) {
    throw new FieldContractError("mobile notifications")
  }
  for (const itemValue of data.items) {
    const item = record(itemValue)
    if (
      !item ||
      !string(item.id) ||
      !string(item.title) ||
      !string(item.type) ||
      !boolean(item.isRead) ||
      !string(item.createdAt)
    ) {
      throw new FieldContractError("mobile notifications")
    }
  }
  return data as unknown as FieldNotificationsData
}
