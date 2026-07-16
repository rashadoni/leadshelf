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
  contactId: string | null
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
  contact: {
    id: string
    displayName: string
    type: string
    specialtyName: string | null
    phone: string | null
  } | null
  visitPolicy: FieldVisitPolicy | null
}

export type FieldVisitActionKey =
  | "PHOTO"
  | "PRESENTATION"
  | "STOCK_CHECK"
  | "VISIT_NOTE"
  | "CHECKLIST"
  | "FEEDBACK"
  | "NEXT_ACTION"

export interface FieldVisitRequirement {
  id?: string
  actionKey: FieldVisitActionKey
  mode: "REQUIRED" | "OPTIONAL" | "HIDDEN"
  minCount: number
  conditions: Record<string, unknown> | null
  allowWaiver: boolean
}

export interface FieldVisitPolicy {
  sourcePolicyId: string | null
  sourcePolicyName: string | null
  requirements: FieldVisitRequirement[]
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
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
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

export type FieldAgentTaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "OVERDUE"
export type FieldAgentTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT"
export type FieldAgentTaskRecurrence = "DAILY" | "WEEKLY" | "MONTHLY"
export type FieldAgentTaskEventType =
  | "CREATED"
  | "ACCEPTED"
  | "STARTED"
  | "COMPLETED"
  | "RESCHEDULED"
  | "COMMENTED"
  | "EVIDENCE_ADDED"
  | "COPIED"
  | "CANCELLED"
  | "EDITED"

export interface FieldAgentTaskEvent {
  id: string
  clientEventId: string | null
  type: FieldAgentTaskEventType
  occurredAt: string
  comment: string | null
  evidence: unknown | null
  fromStatus: FieldAgentTaskStatus | null
  toStatus: FieldAgentTaskStatus | null
  oldDueDate: string | null
  newDueDate: string | null
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
}

export interface FieldAgentTask {
  id: string
  title: string
  description: string | null
  status: FieldAgentTaskStatus
  persistedStatus: FieldAgentTaskStatus
  priority: FieldAgentTaskPriority
  dueDate: string | null
  completedAt: string | null
  acceptedAt: string | null
  startedAt: string | null
  result: string | null
  version: number
  customerId: string | null
  visitId: string | null
  sourceKey: string | null
  copiedFromId: string | null
  recurrenceRule: FieldAgentTaskRecurrence | null
  recurrenceInterval: number | null
  recurrenceUntil: string | null
  recurrenceParentId: string | null
  canEditContent: boolean
  customer: {
    id: string
    name: string
    objectType: string
    address: string | null
    city: string | null
  } | null
  events: FieldAgentTaskEvent[]
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
}

export interface FieldAgentTasksData {
  tasks: FieldAgentTask[]
  capabilities: {
    createSelfTask: boolean
    recurringTasks: boolean
  }
}

export type FieldCommitmentStatus = "OPEN" | "OVERDUE" | "FULFILLED" | "PARTIAL" | "NOT_FULFILLED"
export type FieldCommitmentOutcome = "FULFILLED" | "PARTIAL" | "NOT_FULFILLED"

export interface FieldCommitmentEvidence {
  id: string
  url: string
  thumbnailUrl: string | null
  status: string
}

export interface FieldCommitmentFulfillment {
  id: string
  clientFulfillmentId: string
  outcome: FieldCommitmentOutcome
  actualQuantity: number
  varianceQuantity: number
  note: string | null
  fulfilledAt: string
  evidencePhoto: FieldCommitmentEvidence | null
  evidenceClientPhotoId?: string | null
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
}

export interface FieldCommitment {
  id: string
  clientCommitmentId: string
  visitId: string | null
  customerId: string
  contactId: string | null
  productExternalId: string | null
  productName: string
  brandExternalId: string | null
  brandName: string | null
  promisedQuantity: number
  unit: string
  dueAt: string
  note: string | null
  submittedAt: string
  status: FieldCommitmentStatus
  customer: { id: string; name: string; objectType: string; address: string | null; city: string | null }
  contact: { id: string; displayName: string; type: string; specialtyName: string | null } | null
  evidencePhoto: FieldCommitmentEvidence | null
  evidenceClientPhotoId?: string | null
  fulfillment: FieldCommitmentFulfillment | null
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
}

export interface FieldCommitmentsData {
  commitments: FieldCommitment[]
  capabilities: { create: boolean; fulfillOwn: boolean }
}

export interface FieldKpiRatio {
  numerator: number
  denominator: number
  percentage: number
}

export interface FieldKpiUncoveredSubject {
  subjectKey: string
  customerId: string
  contactId: string | null
  name: string
  segment: "DOCTOR" | "PHARMACY" | "OTHER"
}

export interface FieldKpiCoverage extends FieldKpiRatio {
  uncovered: FieldKpiUncoveredSubject[]
}

export interface FieldCommercialKpiData {
  source: "LEADSHELF"
  generatedAt: string
  period: { kind: "week" | "month"; from: string; to: string }
  orders: {
    total: number
    placed: number
    delivered: number
    cancelled: number
    amounts: Array<{ currency: string; totalAmount: number; discountAmount: number }>
    fulfillment: FieldKpiRatio
    ids: string[]
  }
  promotions: {
    active: number
    ordersWithPromotion: number
    distinctApplied: number
    adoption: FieldKpiRatio
  }
  shelfTasks: {
    assigned: number
    completed: number
    overdue: number
    completion: FieldKpiRatio
    overdueIds: string[]
  }
}

export interface FieldPersonalKpiData {
  protocolVersion: 2
  source: "LEADDRIVE"
  generatedAt: string
  timezone: string
  period: {
    kind: "week" | "month"
    anchor: string
    start: string
    endExclusive: string
    from: string
    to: string
  }
  visits: {
    planned: number
    completedPlanned: number
    completedTotal: number
    unplannedCompleted: number
    missed: number
    fulfillment: FieldKpiRatio
  }
  coverage: {
    overall: FieldKpiCoverage
    doctors: FieldKpiCoverage
    pharmacies: FieldKpiCoverage
    other: FieldKpiCoverage
  }
  tasks: {
    assigned: number
    completed: number
    overdue: number
    completion: FieldKpiRatio
    overdueIds: string[]
  }
  gps: {
    workdays: number
    workdaysWithGps: number
    dayCoverage: FieldKpiRatio
    points: number
    distanceMeters: number | null
    workedSeconds: number
    averageAccuracyMeters: number | null
    lastRecordedAt: string | null
    truncated: boolean
    daysWithoutPoints: string[]
  }
  drilldown: {
    missedStopIds: string[]
    unplannedVisitIds: string[]
  }
  commercial:
    | { availability: "READY"; source: "LEADSHELF"; reason: null; data: FieldCommercialKpiData }
    | { availability: "UNAVAILABLE"; source: "LEADSHELF"; reason: string; data: null }
}

export interface FieldWeekVisit {
  id: string
  customerId: string
  contactId: string | null
  routeId: string | null
  routePointId: string | null
  status: string
  checkInAt: string
  checkOutAt: string | null
  outcome: string | null
  potential: string | null
  notes: string | null
  resultNotes: string | null
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
  customer: { id: string; name: string; objectType: string }
  contact: { id: string; displayName: string; type: string } | null
}

export interface FieldVisitActionResult {
  id: string
  requirementId: string | null
  actionKey: FieldVisitActionKey
  status: "COMPLETED" | "WAIVED"
  evidence: unknown | null
  completedAt: string | null
  createdAt: string
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
}

export interface FieldVisitPhoto {
  id: string
  url: string
  thumbnailUrl: string | null
  category: string | null
  status: string
  createdAt: string
  localUri?: string
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
}

export interface FieldVisitWorkspaceData {
  visit: FieldWeekVisit & {
    agentId: string
    checkInLat: number | null
    checkInLng: number | null
    checkOutLat: number | null
    checkOutLng: number | null
    duration: number | null
    nextActionDueAt: string | null
    requirementSnapshot: {
      id: string
      sourcePolicyId: string | null
      resolvedAt: string
      sourcePolicy: { id: string; name: string } | null
      requirements: FieldVisitRequirement[]
    } | null
    actionResults: FieldVisitActionResult[]
    photos: FieldVisitPhoto[]
    tasks: FieldWeekTask[]
  }
  reminders: FieldWeekTask[]
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

export type FieldWorkdayStatus = "STARTED" | "PAUSED" | "COMPLETED"
export type FieldWorkdayAction = "START" | "PAUSE" | "RESUME" | "FINISH"

export interface FieldWorkdayEvent {
  id: string
  clientEventId: string | null
  type: FieldWorkdayAction
  occurredAt: string
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  note: string | null
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
}

export interface FieldWorkday {
  id: string
  workDate: string
  status: FieldWorkdayStatus
  startedAt: string
  pausedAt: string | null
  completedAt: string | null
  totalPausedSeconds: number
  workedSeconds: number
  startLatitude: number | null
  startLongitude: number | null
  endLatitude: number | null
  endLongitude: number | null
  availableActions: FieldWorkdayAction[]
  events: FieldWorkdayEvent[]
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
}

export interface FieldWorkdayData {
  date: string
  today: string
  timezone: string
  gpsIntervalSeconds: number
  workday: FieldWorkday | null
  activeWorkday: FieldWorkday | null
  availableActions: FieldWorkdayAction[]
}

export interface FieldAgentLocation {
  id: string
  clientLocationId: string | null
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  altitude: number | null
  battery: number | null
  isMoving: boolean
  recordedAt: string
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
}

export interface FieldLocationHistoryData {
  date: string
  timezone: string
  gpsIntervalSeconds: number
  distanceMeters: number
  locations: FieldAgentLocation[]
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

export interface FieldOrganization {
  id: string
  code: string | null
  name: string
  objectType: string
  category: string
  status: string
  address: string | null
  city: string | null
  district: string | null
  phone: string | null
  contactPerson: string | null
  latitude: number | null
  longitude: number | null
  notes?: string | null
  agentAssignments?: Array<{ role: string; agent: { id: string; name: string; role: string } }>
  contactWorkplaces?: Array<{ id: string; isPrimary: boolean; contact: FieldContact }>
  fieldPotentials?: FieldPotential[]
  visits?: Array<Record<string, unknown>>
  _count?: { contactWorkplaces: number; visits: number }
}

export interface FieldOrganizationListData {
  organizations: FieldOrganization[]
  total: number
  page: number
  limit: number
  asOf: string
  timezone: string
  capabilities: { canManage: boolean; canRequestChanges: boolean }
}

export interface FieldOrganizationDetailData {
  organization: FieldOrganization
  asOf: string
  timezone: string
  capabilities: { canManage: boolean; canRequestChanges: boolean }
}

export interface FieldContact {
  id: string
  externalCode: string | null
  firstName: string
  lastName: string
  middleName: string | null
  displayName: string
  type: string
  specialtyCode: string | null
  specialtyName: string | null
  qualificationCategory: string | null
  profile: string | null
  category: string
  status: string
  birthDate: string | null
  gender: string | null
  email: string | null
  phone: string | null
  messengerPhone: string | null
  notes: string | null
  workplaces?: Array<{
    id: string
    isPrimary: boolean
    position: string | null
    department: string | null
    customer: {
      id: string
      code: string | null
      name: string
      objectType: string
      category: string
      address: string | null
      city: string | null
      district: string | null
      phone: string | null
      latitude: number | null
      longitude: number | null
    }
  }>
  agentAssignments?: Array<{ role: string; agent: { id: string; name: string; role: string } }>
  fieldPotentials?: FieldPotential[]
}

export interface FieldPotential {
  id: string
  brandExternalId: string | null
  productExternalId: string | null
  category: string | null
  potentialValue: string | number
  coverageValue: string | number
  periodStart: string | null
  periodEnd: string | null
  source: string
}

export interface FieldContactListData {
  contacts: FieldContact[]
  total: number
  page: number
  limit: number
  asOf: string
  timezone: string
  capabilities: { canManage: boolean; canRequestChanges: boolean }
}

export interface FieldContactDetailData {
  contact: FieldContact
  activeAssignments: Array<Record<string, unknown>>
  asOf: string
  timezone: string
  capabilities: { canManage: boolean; canRequestChanges: boolean }
}

export interface FieldCustomerRequest {
  id: string
  status: string
  objectType: string
  name: string
  address: string | null
  city: string | null
  phone: string | null
  potential: string
  reason: string
  agentComment: string | null
  submittedAt: string | null
  updatedAt: string
  route: { id: string; name: string | null; status: string } | null
  approvedCustomer: { id: string; code: string | null; name: string } | null
  duplicateCandidates: Array<{
    id: string
    name: string
    address?: string | null
    score: number
    reasons: string[]
    exact?: boolean
    distanceMeters?: number | null
  }>
}

export interface FieldCustomerRequestsData {
  requests: FieldCustomerRequest[]
}

export interface CreateFieldCustomerRequest {
  routeId?: string | null
  objectType: "PHARMACY" | "CLINIC" | "DOCTOR" | "STORE" | "OTHER"
  externalCode?: string | null
  name: string
  address?: string | null
  city?: string | null
  district?: string | null
  latitude?: number | null
  longitude?: number | null
  contactPerson?: string | null
  phone?: string | null
  category?: "A" | "B" | "C" | "D" | null
  potential: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"
  territoryCode?: string | null
  reason: string
  agentComment?: string | null
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

function timestamp(value: unknown): value is string {
  return string(value) && !Number.isNaN(new Date(value).getTime())
}

const visitActionKeys = new Set<FieldVisitActionKey>([
  "PHOTO",
  "PRESENTATION",
  "STOCK_CHECK",
  "VISIT_NOTE",
  "CHECKLIST",
  "FEEDBACK",
  "NEXT_ACTION",
])

const agentTaskStatuses = new Set<FieldAgentTaskStatus>([
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "OVERDUE",
])
const agentTaskPriorities = new Set<FieldAgentTaskPriority>(["LOW", "MEDIUM", "HIGH", "URGENT"])
const agentTaskRecurrence = new Set<FieldAgentTaskRecurrence>(["DAILY", "WEEKLY", "MONTHLY"])
const agentTaskEventTypes = new Set<FieldAgentTaskEventType>([
  "CREATED",
  "ACCEPTED",
  "STARTED",
  "COMPLETED",
  "RESCHEDULED",
  "COMMENTED",
  "EVIDENCE_ADDED",
  "COPIED",
  "CANCELLED",
  "EDITED",
])

function nullableTimestamp(value: unknown): boolean {
  return value == null || timestamp(value)
}

function validAgentTaskEvent(value: unknown): boolean {
  const event = record(value)
  return Boolean(
    event &&
      string(event.id) &&
      (event.clientEventId == null || string(event.clientEventId)) &&
      string(event.type) && agentTaskEventTypes.has(event.type as FieldAgentTaskEventType) &&
      timestamp(event.occurredAt) &&
      (event.comment == null || typeof event.comment === "string") &&
      (event.fromStatus == null || (string(event.fromStatus) && agentTaskStatuses.has(event.fromStatus as FieldAgentTaskStatus))) &&
      (event.toStatus == null || (string(event.toStatus) && agentTaskStatuses.has(event.toStatus as FieldAgentTaskStatus))) &&
      nullableTimestamp(event.oldDueDate) &&
      nullableTimestamp(event.newDueDate),
  )
}

function validAgentTask(value: unknown): boolean {
  const task = record(value)
  const customer = task?.customer == null ? null : record(task.customer)
  return Boolean(
    task &&
      string(task.id) &&
      string(task.title) &&
      (task.description == null || typeof task.description === "string") &&
      string(task.status) && agentTaskStatuses.has(task.status as FieldAgentTaskStatus) &&
      string(task.persistedStatus) && agentTaskStatuses.has(task.persistedStatus as FieldAgentTaskStatus) &&
      string(task.priority) && agentTaskPriorities.has(task.priority as FieldAgentTaskPriority) &&
      nullableTimestamp(task.dueDate) &&
      nullableTimestamp(task.completedAt) &&
      nullableTimestamp(task.acceptedAt) &&
      nullableTimestamp(task.startedAt) &&
      (task.result == null || typeof task.result === "string") &&
      number(task.version) && task.version >= 1 &&
      (task.customerId == null || string(task.customerId)) &&
      (task.visitId == null || string(task.visitId)) &&
      (task.sourceKey == null || string(task.sourceKey)) &&
      (task.copiedFromId == null || string(task.copiedFromId)) &&
      (task.recurrenceRule == null || (string(task.recurrenceRule) && agentTaskRecurrence.has(task.recurrenceRule as FieldAgentTaskRecurrence))) &&
      (task.recurrenceInterval == null || (number(task.recurrenceInterval) && task.recurrenceInterval >= 1)) &&
      nullableTimestamp(task.recurrenceUntil) &&
      (task.recurrenceParentId == null || string(task.recurrenceParentId)) &&
      boolean(task.canEditContent) &&
      (!customer || (string(customer.id) && string(customer.name) && string(customer.objectType))) &&
      Array.isArray(task.events) && task.events.every(validAgentTaskEvent),
  )
}

function validVisitRequirement(value: unknown): boolean {
  const requirement = record(value)
  return Boolean(
    requirement &&
      (requirement.id == null || string(requirement.id)) &&
      string(requirement.actionKey) &&
      visitActionKeys.has(requirement.actionKey as FieldVisitActionKey) &&
      ["REQUIRED", "OPTIONAL", "HIDDEN"].includes(String(requirement.mode)) &&
      number(requirement.minCount) &&
      requirement.minCount >= 0 &&
      (requirement.conditions == null || Boolean(record(requirement.conditions))) &&
      boolean(requirement.allowWaiver),
  )
}

function validVisitPolicy(value: unknown): boolean {
  if (value == null) return true
  const policy = record(value)
  return Boolean(
    policy &&
      (policy.sourcePolicyId == null || string(policy.sourcePolicyId)) &&
      (policy.sourcePolicyName == null || string(policy.sourcePolicyName)) &&
      Array.isArray(policy.requirements) &&
      policy.requirements.every(validVisitRequirement),
  )
}

function validRoutePoint(value: unknown): boolean {
  const point = record(value)
  const customer = record(point?.customer)
  const contact = point?.contact == null ? null : record(point.contact)
  return Boolean(
    point &&
      string(point.id) &&
      string(point.customerId) &&
      (point.contactId == null || string(point.contactId)) &&
      number(point.orderIndex) &&
      string(point.effectiveStatus) &&
      customer &&
      string(customer.id) &&
      string(customer.name) &&
      string(customer.objectType) &&
      (!contact || (string(contact.id) && string(contact.displayName) && string(contact.type))) &&
      validVisitPolicy(point.visitPolicy),
  )
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
      Array.isArray(route.points) &&
      route.points.every(validRoutePoint),
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

export function parseFieldAgentTasks(value: unknown): FieldAgentTasksData {
  const data = validEnvelope(value)
  const capabilities = record(data?.capabilities)
  if (
    !data ||
    !Array.isArray(data.tasks) ||
    !data.tasks.every(validAgentTask) ||
    !capabilities ||
    !boolean(capabilities.createSelfTask) ||
    !boolean(capabilities.recurringTasks)
  ) {
    throw new FieldContractError("mobile agent tasks")
  }
  return data as unknown as FieldAgentTasksData
}

function validCommitmentEvidence(value: unknown): boolean {
  const evidence = value == null ? null : record(value)
  return evidence == null || Boolean(
    string(evidence.id) &&
    string(evidence.url) &&
    (evidence.thumbnailUrl == null || string(evidence.thumbnailUrl)) &&
    string(evidence.status),
  )
}

function validCommitment(value: unknown): boolean {
  const item = record(value)
  const customer = record(item?.customer)
  const contact = item?.contact == null ? null : record(item.contact)
  const fulfillment = item?.fulfillment == null ? null : record(item.fulfillment)
  return Boolean(
    item &&
      string(item.id) &&
      string(item.clientCommitmentId) &&
      (item.visitId == null || string(item.visitId)) &&
      string(item.customerId) &&
      (item.contactId == null || string(item.contactId)) &&
      (item.productExternalId == null || string(item.productExternalId)) &&
      string(item.productName) &&
      (item.brandExternalId == null || string(item.brandExternalId)) &&
      (item.brandName == null || string(item.brandName)) &&
      number(item.promisedQuantity) && item.promisedQuantity > 0 &&
      string(item.unit) &&
      timestamp(item.dueAt) &&
      (item.note == null || typeof item.note === "string") &&
      timestamp(item.submittedAt) &&
      ["OPEN", "OVERDUE", "FULFILLED", "PARTIAL", "NOT_FULFILLED"].includes(String(item.status)) &&
      customer && string(customer.id) && string(customer.name) && string(customer.objectType) &&
      (!contact || (string(contact.id) && string(contact.displayName) && string(contact.type))) &&
      validCommitmentEvidence(item.evidencePhoto) &&
      (!fulfillment || (
        string(fulfillment.id) &&
        string(fulfillment.clientFulfillmentId) &&
        ["FULFILLED", "PARTIAL", "NOT_FULFILLED"].includes(String(fulfillment.outcome)) &&
        number(fulfillment.actualQuantity) && fulfillment.actualQuantity >= 0 &&
        number(fulfillment.varianceQuantity) &&
        (fulfillment.note == null || typeof fulfillment.note === "string") &&
        timestamp(fulfillment.fulfilledAt) &&
        validCommitmentEvidence(fulfillment.evidencePhoto)
      )),
  )
}

export function parseFieldCommitments(value: unknown): FieldCommitmentsData {
  const data = validEnvelope(value)
  const capabilities = record(data?.capabilities)
  if (
    !data ||
    !Array.isArray(data.commitments) ||
    !data.commitments.every(validCommitment) ||
    !capabilities ||
    !boolean(capabilities.create) ||
    !boolean(capabilities.fulfillOwn)
  ) {
    throw new FieldContractError("mobile commitments")
  }
  return data as unknown as FieldCommitmentsData
}

function validKpiRatio(value: unknown): boolean {
  const metric = record(value)
  return Boolean(
    metric &&
      number(metric.numerator) && metric.numerator >= 0 &&
      number(metric.denominator) && metric.denominator >= 0 &&
      number(metric.percentage) && metric.percentage >= 0,
  )
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(string)
}

function validKpiCoverage(value: unknown): boolean {
  const metric = record(value)
  return Boolean(
    metric &&
      validKpiRatio(metric) &&
      Array.isArray(metric.uncovered) &&
      metric.uncovered.every((raw) => {
        const subject = record(raw)
        return Boolean(
          subject &&
            string(subject.subjectKey) &&
            string(subject.customerId) &&
            (subject.contactId == null || string(subject.contactId)) &&
            string(subject.name) &&
            ["DOCTOR", "PHARMACY", "OTHER"].includes(String(subject.segment)),
        )
      }),
  )
}

function validCommercialKpi(value: unknown): boolean {
  const commercial = record(value)
  if (!commercial || commercial.source !== "LEADSHELF") return false
  if (commercial.availability === "UNAVAILABLE") {
    return string(commercial.reason) && commercial.data == null
  }
  if (commercial.availability !== "READY" || commercial.reason != null) return false
  const data = record(commercial.data)
  const period = record(data?.period)
  const orders = record(data?.orders)
  const promotions = record(data?.promotions)
  const shelfTasks = record(data?.shelfTasks)
  return Boolean(
    data &&
      data.source === "LEADSHELF" &&
      timestamp(data.generatedAt) &&
      period &&
      ["week", "month"].includes(String(period.kind)) &&
      timestamp(period.from) && timestamp(period.to) &&
      orders &&
      number(orders.total) && number(orders.placed) && number(orders.delivered) && number(orders.cancelled) &&
      Array.isArray(orders.amounts) && orders.amounts.every((raw) => {
        const amount = record(raw)
        return Boolean(amount && string(amount.currency) && number(amount.totalAmount) && number(amount.discountAmount))
      }) &&
      validKpiRatio(orders.fulfillment) &&
      validStringArray(orders.ids) &&
      promotions &&
      number(promotions.active) && number(promotions.ordersWithPromotion) && number(promotions.distinctApplied) &&
      validKpiRatio(promotions.adoption) &&
      shelfTasks &&
      number(shelfTasks.assigned) && number(shelfTasks.completed) && number(shelfTasks.overdue) &&
      validKpiRatio(shelfTasks.completion) &&
      validStringArray(shelfTasks.overdueIds),
  )
}

export function parseFieldPersonalKpi(value: unknown): FieldPersonalKpiData {
  const data = validEnvelope(value)
  const period = record(data?.period)
  const visits = record(data?.visits)
  const coverage = record(data?.coverage)
  const tasks = record(data?.tasks)
  const gps = record(data?.gps)
  const drilldown = record(data?.drilldown)
  if (
    !data ||
    data.protocolVersion !== 2 ||
    data.source !== "LEADDRIVE" ||
    !timestamp(data.generatedAt) ||
    !string(data.timezone) ||
    !period ||
    !["week", "month"].includes(String(period.kind)) ||
    !dateKey(period.anchor) || !dateKey(period.start) || !dateKey(period.endExclusive) ||
    !timestamp(period.from) || !timestamp(period.to) ||
    !visits ||
    !number(visits.planned) || !number(visits.completedPlanned) || !number(visits.completedTotal) ||
    !number(visits.unplannedCompleted) || !number(visits.missed) || !validKpiRatio(visits.fulfillment) ||
    !coverage ||
    !validKpiCoverage(coverage.overall) || !validKpiCoverage(coverage.doctors) ||
    !validKpiCoverage(coverage.pharmacies) || !validKpiCoverage(coverage.other) ||
    !tasks ||
    !number(tasks.assigned) || !number(tasks.completed) || !number(tasks.overdue) ||
    !validKpiRatio(tasks.completion) || !validStringArray(tasks.overdueIds) ||
    !gps ||
    !number(gps.workdays) || !number(gps.workdaysWithGps) || !validKpiRatio(gps.dayCoverage) ||
    !number(gps.points) || (gps.distanceMeters != null && !number(gps.distanceMeters)) ||
    !number(gps.workedSeconds) || (gps.averageAccuracyMeters != null && !number(gps.averageAccuracyMeters)) ||
    !nullableTimestamp(gps.lastRecordedAt) || !boolean(gps.truncated) || !Array.isArray(gps.daysWithoutPoints) ||
    !gps.daysWithoutPoints.every(dateKey) ||
    !drilldown || !validStringArray(drilldown.missedStopIds) || !validStringArray(drilldown.unplannedVisitIds) ||
    !validCommercialKpi(data.commercial)
  ) {
    throw new FieldContractError("mobile personal KPI")
  }
  return data as unknown as FieldPersonalKpiData
}

const workdayActions = new Set<FieldWorkdayAction>(["START", "PAUSE", "RESUME", "FINISH"])
const workdayStatuses = new Set<FieldWorkdayStatus>(["STARTED", "PAUSED", "COMPLETED"])

function validWorkday(value: unknown): boolean {
  if (value == null) return true
  const workday = record(value)
  return Boolean(
    workday &&
      string(workday.id) &&
      timestamp(workday.workDate) &&
      string(workday.status) &&
      workdayStatuses.has(workday.status as FieldWorkdayStatus) &&
      timestamp(workday.startedAt) &&
      (workday.pausedAt == null || timestamp(workday.pausedAt)) &&
      (workday.completedAt == null || timestamp(workday.completedAt)) &&
      number(workday.totalPausedSeconds) &&
      number(workday.workedSeconds) &&
      Array.isArray(workday.availableActions) &&
      workday.availableActions.every((action) => string(action) && workdayActions.has(action as FieldWorkdayAction)) &&
      Array.isArray(workday.events) &&
      workday.events.every((rawEvent) => {
        const event = record(rawEvent)
        return Boolean(
          event &&
            string(event.id) &&
            string(event.type) &&
            workdayActions.has(event.type as FieldWorkdayAction) &&
            timestamp(event.occurredAt),
        )
      }),
  )
}

export function parseFieldWorkday(value: unknown): FieldWorkdayData {
  const data = validEnvelope(value)
  if (
    !data ||
    !dateKey(data.date) ||
    !dateKey(data.today) ||
    !string(data.timezone) ||
    !number(data.gpsIntervalSeconds) ||
    !validWorkday(data.workday) ||
    !validWorkday(data.activeWorkday) ||
    !Array.isArray(data.availableActions) ||
    !data.availableActions.every((action) => string(action) && workdayActions.has(action as FieldWorkdayAction))
  ) {
    throw new FieldContractError("mobile workday")
  }
  return data as unknown as FieldWorkdayData
}

export function parseFieldLocationHistory(value: unknown): FieldLocationHistoryData {
  const data = validEnvelope(value)
  if (
    !data ||
    !dateKey(data.date) ||
    !string(data.timezone) ||
    !number(data.gpsIntervalSeconds) ||
    !number(data.distanceMeters) ||
    !Array.isArray(data.locations)
  ) {
    throw new FieldContractError("mobile location history")
  }
  for (const rawLocation of data.locations) {
    const location = record(rawLocation)
    if (
      !location ||
      !string(location.id) ||
      !number(location.latitude) ||
      !number(location.longitude) ||
      !boolean(location.isMoving) ||
      !timestamp(location.recordedAt)
    ) {
      throw new FieldContractError("mobile location history")
    }
  }
  return data as unknown as FieldLocationHistoryData
}

export function parseFieldVisitWorkspace(value: unknown): FieldVisitWorkspaceData {
  const data = validEnvelope(value)
  const visit = record(data?.visit)
  const customer = record(visit?.customer)
  const contact = visit?.contact == null ? null : record(visit.contact)
  const snapshot = visit?.requirementSnapshot == null ? null : record(visit.requirementSnapshot)
  const snapshotRequirements = snapshot?.requirements
  if (
    !data ||
    !visit ||
    !string(visit.id) ||
    !string(visit.customerId) ||
    !(visit.contactId == null || string(visit.contactId)) ||
    !(visit.routeId == null || string(visit.routeId)) ||
    !(visit.routePointId == null || string(visit.routePointId)) ||
    !string(visit.status) ||
    !timestamp(visit.checkInAt) ||
    !customer ||
    !string(customer.id) ||
    !string(customer.name) ||
    !string(customer.objectType) ||
    (contact != null && (!string(contact.id) || !string(contact.displayName) || !string(contact.type))) ||
    (snapshot != null && (
      !string(snapshot.id) ||
      !timestamp(snapshot.resolvedAt) ||
      !Array.isArray(snapshotRequirements) ||
      !snapshotRequirements.every(validVisitRequirement)
    )) ||
    !Array.isArray(visit.actionResults) ||
    !visit.actionResults.every((value) => {
      const result = record(value)
      return Boolean(
        result &&
          string(result.id) &&
          string(result.actionKey) &&
          visitActionKeys.has(result.actionKey as FieldVisitActionKey) &&
          ["COMPLETED", "WAIVED"].includes(String(result.status)) &&
          timestamp(result.createdAt),
      )
    }) ||
    !Array.isArray(visit.photos) ||
    !Array.isArray(visit.tasks) ||
    !Array.isArray(data.reminders)
  ) {
    throw new FieldContractError("mobile visit workspace")
  }
  return data as unknown as FieldVisitWorkspaceData
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

function validOrganization(value: unknown): boolean {
  const organization = record(value)
  return Boolean(
    organization &&
      string(organization.id) &&
      string(organization.name) &&
      string(organization.objectType) &&
      string(organization.category) &&
      string(organization.status),
  )
}

export function parseFieldOrganizations(value: unknown): FieldOrganizationListData {
  const data = validEnvelope(value)
  if (
    !data ||
    !Array.isArray(data.organizations) ||
    !data.organizations.every(validOrganization) ||
    !number(data.total) ||
    !number(data.page) ||
    !number(data.limit) ||
    !dateKey(data.asOf)
  ) {
    throw new FieldContractError("organizations")
  }
  return data as unknown as FieldOrganizationListData
}

export function parseFieldOrganizationDetail(value: unknown): FieldOrganizationDetailData {
  const data = validEnvelope(value)
  if (!data || !validOrganization(data.organization) || !dateKey(data.asOf)) {
    throw new FieldContractError("organization detail")
  }
  return data as unknown as FieldOrganizationDetailData
}

function validContact(value: unknown): boolean {
  const contact = record(value)
  return Boolean(
    contact &&
      string(contact.id) &&
      string(contact.displayName) &&
      string(contact.firstName) &&
      string(contact.lastName) &&
      string(contact.type) &&
      string(contact.status),
  )
}

export function parseFieldContacts(value: unknown): FieldContactListData {
  const data = validEnvelope(value)
  if (
    !data ||
    !Array.isArray(data.contacts) ||
    !data.contacts.every(validContact) ||
    !number(data.total) ||
    !number(data.page) ||
    !number(data.limit) ||
    !dateKey(data.asOf)
  ) {
    throw new FieldContractError("contacts")
  }
  return data as unknown as FieldContactListData
}

export function parseFieldContactDetail(value: unknown): FieldContactDetailData {
  const data = validEnvelope(value)
  if (!data || !validContact(data.contact) || !dateKey(data.asOf)) {
    throw new FieldContractError("contact detail")
  }
  return data as unknown as FieldContactDetailData
}

export function parseFieldCustomerRequests(value: unknown): FieldCustomerRequestsData {
  const data = validEnvelope(value)
  if (!data || !Array.isArray(data.requests)) throw new FieldContractError("customer requests")
  for (const requestValue of data.requests) {
    if (!validCustomerRequest(requestValue)) {
      throw new FieldContractError("customer requests")
    }
  }
  return data as unknown as FieldCustomerRequestsData
}

function validCustomerRequest(value: unknown): boolean {
  const request = record(value)
  return Boolean(request && string(request.id) && string(request.status) && string(request.name))
}

export function parseFieldCustomerRequest(value: unknown): FieldCustomerRequest {
  const data = validEnvelope(value)
  if (!data || !validCustomerRequest(data)) throw new FieldContractError("customer request")
  return data as unknown as FieldCustomerRequest
}
