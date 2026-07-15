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
