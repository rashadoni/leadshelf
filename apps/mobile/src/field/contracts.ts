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

/** Tenant-configured filter for the route-stop picker. The server, not the
 * APK, resolves its direction and assignment scope. */
export interface FieldRouteTargetType {
  id: string
  labels: { az: string; ru: string; en: string }
  direction: "DOCTOR" | "PHARMACY" | "ORGANIZATION"
  objectType: string | null
  organizationKind: string | null
}

export interface FieldRouteTargetAvailability {
  source: "CUSTOMER_ASSIGNMENT" | "DIRECT_CONTACT_ASSIGNMENT" | "WORKPLACE_ASSIGNMENT"
  validFrom: string | null
  validThrough: string | null
}

/** One actionable customer/contact pairing, already scoped to an employee and route day. */
export interface FieldRouteTargetCatalogItem {
  targetKey: string
  subjectType: "ORGANIZATION" | "CONTACT"
  customer: FieldRoutePoint["customer"]
  contact: FieldRoutePoint["contact"]
  availability: FieldRouteTargetAvailability
}

export interface FieldRouteTargetCatalogData {
  targetAgent: { id: string; name: string }
  date: string
  targetTypes: FieldRouteTargetType[]
  targetType: FieldRouteTargetType
  selectionScope: {
    mode: "EFFECTIVE_ASSIGNMENTS"
    assignmentRequired: true
    agentId: string
    effectiveOn: string
  }
  items: FieldRouteTargetCatalogItem[]
  page: { number: number; limit: number; hasMore: boolean }
  emptyReason: "NO_EFFECTIVE_ASSIGNMENTS" | null
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
  version: number
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
    customer: FieldWeekVisit["customer"] & {
      address?: string | null
      city?: string | null
      phone?: string | null
      latitude?: number | null
      longitude?: number | null
    }
    contact: (NonNullable<FieldWeekVisit["contact"]> & {
      specialtyName?: string | null
      phone?: string | null
    }) | null
    route?: { id: string; name: string | null; date: string; status: string } | null
    routePoint?: {
      id: string
      orderIndex: number
      plannedTime: string | null
      status: string
    } | null
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
export type FieldAttendanceClockEvidence = "NONE" | "GPS" | "QR"
export type FieldAttendanceContinuousTracking = "OFF" | "ACTIVE_WORKDAY"

/**
 * The old server has no attendance-policy field. Absence must therefore be
 * interpreted as the least invasive behaviour: no event location and no
 * continuous tracking. This keeps a newer APK safe with a not-yet-upgraded
 * tenant response.
 */
export const FIELD_ATTENDANCE_POLICY_DEFAULT = {
  clockEvidence: "NONE",
  continuousTracking: "OFF",
  allowDifferentStartEndSites: true,
} as const

export interface FieldAttendancePolicy {
  clockEvidence: FieldAttendanceClockEvidence
  continuousTracking: FieldAttendanceContinuousTracking
  allowDifferentStartEndSites: boolean
}

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
  attendancePolicy: FieldAttendancePolicy
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

export type FieldManagerScope = "ORGANIZATION" | "TEAM_OR_REGION"
export type FieldManagerGpsFreshness = "ONLINE" | "DELAYED" | "STALE" | "NO_LOCATION"

export interface FieldManagerWorkday {
  id: string
  status: Extract<FieldWorkdayStatus, "STARTED" | "PAUSED">
  startedAt: string
  pausedAt: string | null
}

/**
 * A same-day workday row intentionally differs from the legacy open-workday
 * field above. It lets a manager distinguish a completed day from an active
 * shift that was left open on an earlier date, without inventing lateness or
 * attendance discipline from incomplete data.
 */
export interface FieldManagerTodayWorkday {
  id: string
  workDate: string
  status: FieldWorkdayStatus
  startedAt: string
  pausedAt: string | null
  completedAt: string | null
  totalPausedSeconds: number
  workedSeconds: number
  durationAnomalous: boolean
  durationReason: string | null
}

export interface FieldManagerToday {
  date: string
  timezone: string
  generatedAt: string
}

export interface FieldManagerTeamAgent {
  id: string
  name: string
  role: string
  status: string
  teamId: string | null
  isOnline: boolean
  lastSeenAt: string | null
  workday: FieldManagerWorkday | null
  todayWorkday: FieldManagerTodayWorkday | null
}

/**
 * Additive metadata for manager lists. Older servers did not send it, so the
 * parsers below intentionally derive a one-page fallback when it is absent.
 */
export interface FieldManagerListPage {
  number: number
  limit: number
  total: number
  hasMore: boolean
}

export interface FieldManagerTeamData {
  scope: FieldManagerScope
  /**
   * Null keeps a new APK safe against a server that has not shipped the
   * additive manager-Today contract yet.
   */
  today: FieldManagerToday | null
  agents: FieldManagerTeamAgent[]
  page: FieldManagerListPage
}

export interface FieldManagerLocationPoint {
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  battery: number | null
  isMoving: boolean
  recordedAt: string
}

export interface FieldManagerLocationAgent {
  id: string
  name: string
  role: string
  isOnline: boolean
  lastSeenAt: string | null
  freshness: FieldManagerGpsFreshness
  hasLiveLocation: boolean
  /**
   * A point is live only when freshness is ONLINE. Delayed/stale evidence is
   * intentionally represented only by lastKnownLocation.
   */
  liveLocation: FieldManagerLocationPoint | null
  lastKnownLocation: FieldManagerLocationPoint | null
}

export interface FieldManagerLocationsData {
  scope: FieldManagerScope
  generatedAt: string
  locations: FieldManagerLocationAgent[]
  page: FieldManagerListPage
}

export interface FieldManagerPlanningAgent {
  id: string
  name: string
  role: string
  status: string
  teamId: string | null
}

export interface FieldManagerPlanningRoute {
  id: string
  agentId: string
  date: string
  name: string | null
  status: string
  totalPoints: number
  visitedPoints: number
  startedAt: string | null
  completedAt: string | null
  agent: { id: string; name: string }
}

export interface FieldManagerPlanningData {
  scope: FieldManagerScope
  date: string | null
  from: string
  to: string
  days: number
  maxRangeDays: number
  agents: FieldManagerPlanningAgent[]
  routes: FieldManagerPlanningRoute[]
  truncated: boolean
}

export interface FieldManagerHrmApproval {
  id: string
  agentId: string
  type: string
  startDate: string
  endDate: string
  reason: string
  submittedAt: string
  agent: { name: string }
}

export interface FieldManagerRouteChangeApproval {
  id: string
  requestedByAgentId: string
  routeId: string
  changeType: string
  reason: string
  status: string
  submittedAt: string
  requestedByAgent: { name: string }
}

export interface FieldManagerCustomerApproval {
  id: string
  requestedByAgentId: string
  name: string
  objectType: string
  reason: string
  status: string
  submittedAt: string
  requestedByAgent: { name: string }
}

export interface FieldManagerContactChangeApproval {
  id: string
  contactId: string
  requestedByAgentId: string
  kind: string
  reason: string
  status: string
  submittedAt: string
  /**
   * Legacy manager endpoints may omit it. In that case the APK leaves the
   * decision disabled instead of asking a manager to approve blind.
   */
  payload: Record<string, unknown> | null
  contact: { displayName: string }
  requestedByAgent: { name: string }
}

export interface FieldManagerApprovalsData {
  scope: FieldManagerScope
  /**
   * Counts are the records returned by the current bounded response, not an
   * assertion about every pending request in the organization.
   */
  counts: { hrm: number; routeChanges: number; customers: number; contactChanges: number }
  hrm: FieldManagerHrmApproval[]
  routeChanges: FieldManagerRouteChangeApproval[]
  customers: FieldManagerCustomerApproval[]
  contactChanges: FieldManagerContactChangeApproval[]
}

/**
 * Deliberately mirrors the narrow mobile manager-decision endpoint. The
 * server remains authoritative and delegates each decision to its established
 * domain handler; this type only prevents the app from mixing fields across
 * approval kinds.
 */
export type FieldManagerApprovalDecisionInput =
  | {
    kind: "HRM"
    id: string
    decision: "APPROVED" | "REJECTED"
    note?: string
    acknowledgeRouteConflicts?: boolean
  }
  | {
    kind: "ROUTE_CHANGE"
    id: string
    decision: "APPROVED" | "REJECTED" | "NEEDS_INFO" | "RESCHEDULE"
    note?: string
    rescheduleDate?: string
  }
  | {
    kind: "CUSTOMER_CREATE"
    id: string
    decision: "APPROVED" | "REJECTED" | "NEEDS_INFO"
    note?: string
  }
  | {
    kind: "CONTACT_CHANGE"
    id: string
    decision: "APPROVED" | "REJECTED" | "NEEDS_INFO"
    note: string
  }

export interface FieldNotification {
  id: string
  title: string
  body: string | null
  type: string
  isRead: boolean
  metadata: unknown | null
  target?: FieldNotificationTarget | null
  createdAt: string
}

export type FieldNotificationTargetKind =
  | "ROUTE"
  | "VISIT"
  | "TASK"
  | "MESSAGE_THREAD"
  | "CUSTOMER"
  | "CONTACT"
  | "CUSTOMER_REQUEST"
  | "HRM_REQUEST"

export const fieldNotificationTargetKinds = new Set<FieldNotificationTargetKind>([
  "ROUTE",
  "VISIT",
  "TASK",
  "MESSAGE_THREAD",
  "CUSTOMER",
  "CONTACT",
  "CUSTOMER_REQUEST",
  "HRM_REQUEST",
])

export interface FieldNotificationTarget {
  kind: FieldNotificationTargetKind
  id: string
}

export interface FieldNotificationsData {
  items: FieldNotification[]
  unread: number
}

export type FieldMessageThreadType = "DIRECT" | "BROADCAST" | "SYSTEM"
export type FieldMessageReceiptType = "READ" | "ACKNOWLEDGED"
export type FieldMessageDeliveryStatus = "SENT" | "READ"

export interface FieldMessagePerson {
  id: string
  name: string
  role: string
  avatar: string | null
  teamId?: string | null
  participantRole?: string
}

export interface FieldMessageAttachment {
  id: string
  title?: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  checksumSha256?: string | null
  downloadUrl?: string
  localUri?: string | null
}

export interface FieldMessageDelivery {
  /**
   * SENT means the server accepted the message. It deliberately does not
   * claim device or push delivery. READ is exposed only for direct messages.
   */
  status: FieldMessageDeliveryStatus
  readAt: string | null
}

export interface FieldMessage {
  id: string
  senderAgentId: string | null
  senderUserId?: string | null
  senderName: string
  clientMessageId: string | null
  body: string | null
  sentAt: string
  acknowledgementRequired: boolean
  attachmentDocument: FieldMessageAttachment | null
  read: boolean
  acknowledged: boolean
  receipts?: Array<{ id?: string; type: FieldMessageReceiptType; occurredAt: string }>
  delivery?: FieldMessageDelivery | null
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
}

export interface FieldMessageThreadSummary {
  id: string
  type: FieldMessageThreadType
  subject: string | null
  title: string
  lastMessageAt: string
  participants: FieldMessagePerson[]
  lastMessage: Omit<FieldMessage, "clientMessageId" | "read"> | null
  unread: boolean
  needsAcknowledgement: boolean
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
}

export interface FieldMessagesData {
  threads: FieldMessageThreadSummary[]
  unread: number
  availableRecipients: FieldMessagePerson[]
  capabilities: {
    startDirectConversation: boolean
    sendAttachments: boolean
    acknowledgeBroadcasts: boolean
  }
}

export interface FieldMessageThreadData {
  thread: {
    id: string
    type: FieldMessageThreadType
    subject: string | null
    lastMessageAt: string
    participants: FieldMessagePerson[]
    messages: FieldMessage[]
  }
  capabilities: { reply: boolean; sendAttachments: boolean; acknowledge: boolean }
}

export interface FieldDocument {
  id: string
  clientDocumentId: string | null
  title: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string | null
  uploadedByAgentId: string | null
  visitId: string | null
  taskId: string | null
  createdAt: string
  visit?: { id: string; customer: { id: string; name: string } } | null
  task?: { id: string; title: string } | null
  assignment: {
    id: string
    required: boolean
    assignedAt: string
    expiresAt: string | null
    readAt: string | null
    downloadedAt: string | null
  }
  expired: boolean
  downloadUrl: string
  localUri?: string | null
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
}

export interface FieldDocumentsData {
  documents: FieldDocument[]
  capabilities: { upload: boolean; offlineDownload: boolean; maxUploadBytes: number }
}

export type FieldHrmRequestType = "LEAVE" | "ABSENCE" | "TIME_CORRECTION"
export type FieldHrmRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"

export interface FieldHrmRequest {
  id: string
  clientRequestId: string
  type: FieldHrmRequestType
  status: FieldHrmRequestStatus
  startDate: string
  endDate: string
  correctionWorkdayId: string | null
  requestedStartAt: string | null
  requestedEndAt: string | null
  reason: string
  decisionNote: string | null
  submittedAt: string
  decidedAt: string | null
  cancelledAt: string | null
  updatedAt: string
  syncState?: "PENDING" | "CONFLICT" | "REJECTED"
}

export interface FieldHrmData {
  timezone: string
  start: string
  end: string
  days: Array<{
    date: string
    calendar: {
      isWorkingDay: boolean
      kind: string
      source: string
      name: string | null
      routePlanningAllowed: boolean
    }
    workday: {
      id: string
      workDate: string
      status: string
      startedAt: string
      pausedAt: string | null
      completedAt: string | null
      totalPausedSeconds: number
    } | null
    requests: Array<{ id: string; type: FieldHrmRequestType; status: FieldHrmRequestStatus }>
  }>
  requests: FieldHrmRequest[]
  capabilities: {
    requestLeave: boolean
    requestAbsence: boolean
    requestTimeCorrection: boolean
    cancelPending: boolean
  }
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
  /**
   * The revision token used by agent-side change requests. It remains optional
   * at the boundary so an older server response can still be displayed; the
   * correction flow deliberately refuses to submit without it.
   */
  updatedAt?: string
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

/**
 * The mobile agent may propose only a contact update. The server remains the
 * sole writer: it validates the revision token, records an immutable request,
 * and waits for a manager decision.
 */
export type FieldContactUpdatePayload = Partial<{
  firstName: string
  lastName: string
  middleName: string | null
  specialtyName: string | null
  qualificationCategory: string | null
  profile: string | null
  email: string | null
  phone: string | null
  messengerPhone: string | null
  notes: string | null
}>

export interface CreateFieldContactChangeRequest {
  idempotencyKey: string
  expectedContactUpdatedAt: string
  kind: "CONTACT_UPDATE"
  payload: FieldContactUpdatePayload
  reason: string
}

export interface FieldContactChangeRequest {
  id: string
  contactId: string
  kind: string
  status: string
  reason: string
  payload: Record<string, unknown>
  decisionComment: string | null
  submittedAt: string
  reviewedAt: string | null
}

export interface FieldContactChangeRequestsData {
  requests: FieldContactChangeRequest[]
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

function positiveInteger(value: unknown): value is number {
  return number(value) && Number.isInteger(value) && value > 0
}

function managerListPage(value: unknown, legacyTotal: number): FieldManagerListPage | null {
  if (value == null) {
    return {
      number: 1,
      limit: Math.max(legacyTotal, 1),
      total: legacyTotal,
      hasMore: false,
    }
  }
  const page = record(value)
  if (
    !page ||
    !positiveInteger(page.number) ||
    !positiveInteger(page.limit) ||
    !number(page.total) ||
    !Number.isInteger(page.total) ||
    page.total < 0 ||
    !boolean(page.hasMore)
  ) {
    return null
  }
  return {
    number: page.number,
    limit: page.limit,
    total: page.total,
    hasMore: page.hasMore,
  }
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

function validRouteTargetType(value: unknown): boolean {
  const targetType = record(value)
  const labels = record(targetType?.labels)
  const direction = targetType?.direction
  return Boolean(
    targetType &&
      string(targetType.id) &&
      labels && string(labels.az) && string(labels.ru) && string(labels.en) &&
      string(direction) && ["DOCTOR", "PHARMACY", "ORGANIZATION"].includes(direction) &&
      (targetType.objectType == null || string(targetType.objectType)) &&
      (targetType.organizationKind == null || string(targetType.organizationKind)),
  )
}

function validRouteTargetCustomer(value: unknown): boolean {
  const customer = record(value)
  return Boolean(
    customer &&
      string(customer.id) && string(customer.name) && string(customer.objectType) && string(customer.category) &&
      (customer.code == null || string(customer.code)) &&
      (customer.address == null || string(customer.address)) &&
      (customer.city == null || string(customer.city)) &&
      (customer.phone == null || string(customer.phone)) &&
      (customer.latitude == null || number(customer.latitude)) &&
      (customer.longitude == null || number(customer.longitude)),
  )
}

function validRouteTargetItem(value: unknown): boolean {
  const item = record(value)
  const contact = item?.contact == null ? null : record(item.contact)
  const availability = record(item?.availability)
  const source = availability?.source
  return Boolean(
    item &&
      string(item.targetKey) &&
      (item.subjectType === "ORGANIZATION" || item.subjectType === "CONTACT") &&
      validRouteTargetCustomer(item.customer) &&
      (item.subjectType === "CONTACT"
        ? contact && string(contact.id) && string(contact.displayName) && string(contact.type) &&
          (contact.specialtyName == null || string(contact.specialtyName)) &&
          (contact.phone == null || string(contact.phone))
        : item.contact === null) &&
      availability &&
      (source === "CUSTOMER_ASSIGNMENT" || source === "DIRECT_CONTACT_ASSIGNMENT" || source === "WORKPLACE_ASSIGNMENT") &&
      (availability.validFrom == null || dateKey(availability.validFrom)) &&
      (availability.validThrough == null || dateKey(availability.validThrough)),
  )
}

export function parseFieldRouteTargets(value: unknown): FieldRouteTargetCatalogData {
  const data = validEnvelope(value)
  const targetAgent = record(data?.targetAgent)
  const selectionScope = record(data?.selectionScope)
  const page = record(data?.page)
  if (
    !data ||
    !targetAgent || !string(targetAgent.id) || !string(targetAgent.name) ||
    !dateKey(data.date) ||
    !Array.isArray(data.targetTypes) || data.targetTypes.length < 1 || !data.targetTypes.every(validRouteTargetType) ||
    !validRouteTargetType(data.targetType) ||
    !selectionScope || selectionScope.mode !== "EFFECTIVE_ASSIGNMENTS" || selectionScope.assignmentRequired !== true ||
    !string(selectionScope.agentId) || !dateKey(selectionScope.effectiveOn) ||
    !Array.isArray(data.items) || !data.items.every(validRouteTargetItem) ||
    !page || !positiveInteger(page.number) || !positiveInteger(page.limit) || !boolean(page.hasMore) ||
    !(data.emptyReason === null || data.emptyReason === "NO_EFFECTIVE_ASSIGNMENTS")
  ) {
    throw new FieldContractError("route targets")
  }
  return data as unknown as FieldRouteTargetCatalogData
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
      positiveInteger(route.version) &&
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

function parseFieldAttendancePolicy(value: unknown): FieldAttendancePolicy {
  const policy = record(value)
  const clockEvidence: FieldAttendanceClockEvidence = policy && (
    policy.clockEvidence === "NONE" ||
    policy.clockEvidence === "GPS" ||
    policy.clockEvidence === "QR"
  )
    ? policy.clockEvidence as FieldAttendanceClockEvidence
    : FIELD_ATTENDANCE_POLICY_DEFAULT.clockEvidence
  const continuousTracking: FieldAttendanceContinuousTracking = policy && (
    policy.continuousTracking === "OFF" ||
    policy.continuousTracking === "ACTIVE_WORKDAY"
  )
    ? policy.continuousTracking as FieldAttendanceContinuousTracking
    : FIELD_ATTENDANCE_POLICY_DEFAULT.continuousTracking
  const allowDifferentStartEndSites = policy && typeof policy.allowDifferentStartEndSites === "boolean"
    ? policy.allowDifferentStartEndSites
    : FIELD_ATTENDANCE_POLICY_DEFAULT.allowDifferentStartEndSites
  return {
    clockEvidence,
    continuousTracking,
    allowDifferentStartEndSites,
  }
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
  return {
    ...data,
    attendancePolicy: parseFieldAttendancePolicy(data.attendancePolicy),
  } as unknown as FieldWorkdayData
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

const managerScopes = new Set<FieldManagerScope>(["ORGANIZATION", "TEAM_OR_REGION"])
const managerGpsFreshness = new Set<FieldManagerGpsFreshness>([
  "ONLINE",
  "DELAYED",
  "STALE",
  "NO_LOCATION",
])

function managerScope(value: unknown): value is FieldManagerScope {
  return string(value) && managerScopes.has(value as FieldManagerScope)
}

function managerLocationPoint(value: unknown): FieldManagerLocationPoint | null {
  const point = record(value)
  if (
    !point ||
    !number(point.latitude) ||
    point.latitude < -90 ||
    point.latitude > 90 ||
    !number(point.longitude) ||
    point.longitude < -180 ||
    point.longitude > 180 ||
    (point.accuracy != null && !number(point.accuracy)) ||
    (point.speed != null && !number(point.speed)) ||
    (point.heading != null && !number(point.heading)) ||
    (point.battery != null && !number(point.battery)) ||
    !boolean(point.isMoving) ||
    !timestamp(point.recordedAt)
  ) {
    return null
  }
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: point.accuracy == null ? null : point.accuracy,
    speed: point.speed == null ? null : point.speed,
    heading: point.heading == null ? null : point.heading,
    battery: point.battery == null ? null : point.battery,
    isMoving: point.isMoving,
    recordedAt: point.recordedAt,
  }
}

function managerWorkday(value: unknown): FieldManagerWorkday | null {
  if (value == null) return null
  const workday = record(value)
  if (
    !workday ||
    !string(workday.id) ||
    (workday.status !== "STARTED" && workday.status !== "PAUSED") ||
    !timestamp(workday.startedAt) ||
    !nullableTimestamp(workday.pausedAt)
  ) {
    return null
  }
  return {
    id: workday.id,
    status: workday.status,
    startedAt: workday.startedAt,
    pausedAt: workday.pausedAt == null ? null : workday.pausedAt,
  }
}

function managerTodayWorkday(value: unknown): FieldManagerTodayWorkday | null {
  if (value == null) return null
  const workday = record(value)
  if (
    !workday ||
    !string(workday.id) ||
    !timestamp(workday.workDate) ||
    !string(workday.status) ||
    !workdayStatuses.has(workday.status as FieldWorkdayStatus) ||
    !timestamp(workday.startedAt) ||
    !nullableTimestamp(workday.pausedAt) ||
    !nullableTimestamp(workday.completedAt) ||
    !number(workday.totalPausedSeconds) ||
    !number(workday.workedSeconds) ||
    !boolean(workday.durationAnomalous) ||
    !(workday.durationReason == null || string(workday.durationReason))
  ) {
    return null
  }
  return {
    id: workday.id,
    workDate: workday.workDate,
    status: workday.status as FieldWorkdayStatus,
    startedAt: workday.startedAt,
    pausedAt: workday.pausedAt == null ? null : workday.pausedAt,
    completedAt: workday.completedAt == null ? null : workday.completedAt,
    totalPausedSeconds: workday.totalPausedSeconds,
    workedSeconds: workday.workedSeconds,
    durationAnomalous: workday.durationAnomalous,
    durationReason: workday.durationReason == null ? null : workday.durationReason,
  }
}

function managerToday(value: unknown): FieldManagerToday | null {
  if (value == null) return null
  const today = record(value)
  if (!today || !dateKey(today.date) || !string(today.timezone) || !timestamp(today.generatedAt)) {
    return null
  }
  return {
    date: today.date,
    timezone: today.timezone,
    generatedAt: today.generatedAt,
  }
}

function managerTeamAgent(value: unknown): FieldManagerTeamAgent | null {
  const agent = record(value)
  const workday = managerWorkday(agent?.workday)
  const todayWorkday = managerTodayWorkday(agent?.todayWorkday)
  if (
    !agent ||
    !string(agent.id) ||
    !string(agent.name) ||
    !string(agent.role) ||
    !string(agent.status) ||
    !(agent.teamId == null || string(agent.teamId)) ||
    !boolean(agent.isOnline) ||
    !nullableTimestamp(agent.lastSeenAt) ||
    (agent.workday != null && !workday) ||
    (agent.todayWorkday != null && !todayWorkday)
  ) {
    return null
  }
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    teamId: agent.teamId == null ? null : agent.teamId,
    isOnline: agent.isOnline,
    lastSeenAt: agent.lastSeenAt == null ? null : agent.lastSeenAt,
    workday,
    todayWorkday,
  }
}

export function parseFieldManagerTeam(value: unknown): FieldManagerTeamData {
  const data = validEnvelope(value)
  if (!data || !managerScope(data.scope) || !Array.isArray(data.agents)) {
    throw new FieldContractError("mobile manager team")
  }
  const today = managerToday(data.today)
  if (data.today != null && !today) {
    throw new FieldContractError("mobile manager team")
  }
  const agents = data.agents.map(managerTeamAgent)
  if (agents.some((agent) => agent == null)) {
    throw new FieldContractError("mobile manager team")
  }
  const parsedAgents = agents as FieldManagerTeamAgent[]
  const page = managerListPage(data.page, parsedAgents.length)
  if (!page) {
    throw new FieldContractError("mobile manager team")
  }
  return { scope: data.scope, today, agents: parsedAgents, page }
}

function managerLocationAgent(value: unknown): FieldManagerLocationAgent | null {
  const agent = record(value)
  if (
    !agent ||
    !string(agent.id) ||
    !string(agent.name) ||
    !string(agent.role) ||
    !boolean(agent.isOnline) ||
    !nullableTimestamp(agent.lastSeenAt) ||
    !string(agent.freshness) ||
    !managerGpsFreshness.has(agent.freshness as FieldManagerGpsFreshness) ||
    !boolean(agent.hasLiveLocation)
  ) {
    return null
  }
  const liveLocation = managerLocationPoint(agent.liveLocation)
  const lastKnownLocation = managerLocationPoint(agent.lastKnownLocation)
  const freshness = agent.freshness as FieldManagerGpsFreshness
  // Never upgrade a delayed or stale point to live client-side, including
  // through the legacy location property that may be present in the API.
  if (
    (agent.liveLocation != null && !liveLocation) ||
    (agent.lastKnownLocation != null && !lastKnownLocation) ||
    (freshness === "ONLINE" && (!agent.hasLiveLocation || !liveLocation)) ||
    (freshness !== "ONLINE" && (agent.hasLiveLocation || liveLocation))
  ) {
    return null
  }
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    isOnline: agent.isOnline,
    lastSeenAt: agent.lastSeenAt == null ? null : agent.lastSeenAt,
    freshness,
    hasLiveLocation: agent.hasLiveLocation,
    liveLocation,
    lastKnownLocation,
  }
}

export function parseFieldManagerLocations(value: unknown): FieldManagerLocationsData {
  const data = validEnvelope(value)
  const contract = record(data?.contract)
  if (
    !data ||
    !managerScope(data.scope) ||
    !contract ||
    !timestamp(contract.generatedAt) ||
    !Array.isArray(data.locations)
  ) {
    throw new FieldContractError("mobile manager locations")
  }
  const locations = data.locations.map(managerLocationAgent)
  if (locations.some((location) => location == null)) {
    throw new FieldContractError("mobile manager locations")
  }
  const parsedLocations = locations as FieldManagerLocationAgent[]
  const page = managerListPage(data.page, parsedLocations.length)
  if (!page) {
    throw new FieldContractError("mobile manager locations")
  }
  return {
    scope: data.scope,
    generatedAt: contract.generatedAt,
    locations: parsedLocations,
    page,
  }
}

function managerPlanningAgent(value: unknown): FieldManagerPlanningAgent | null {
  const agent = record(value)
  if (
    !agent ||
    !string(agent.id) ||
    !string(agent.name) ||
    !string(agent.role) ||
    !string(agent.status) ||
    !(agent.teamId == null || string(agent.teamId))
  ) {
    return null
  }
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    teamId: agent.teamId == null ? null : agent.teamId,
  }
}

function managerPlanningRoute(value: unknown): FieldManagerPlanningRoute | null {
  const route = record(value)
  const agent = record(route?.agent)
  if (
    !route ||
    !string(route.id) ||
    !string(route.agentId) ||
    !timestamp(route.date) ||
    !(route.name == null || string(route.name)) ||
    !string(route.status) ||
    !number(route.totalPoints) ||
    !number(route.visitedPoints) ||
    !nullableTimestamp(route.startedAt) ||
    !nullableTimestamp(route.completedAt) ||
    !agent ||
    !string(agent.id) ||
    !string(agent.name)
  ) {
    return null
  }
  return {
    id: route.id,
    agentId: route.agentId,
    date: route.date,
    name: route.name == null ? null : route.name,
    status: route.status,
    totalPoints: route.totalPoints,
    visitedPoints: route.visitedPoints,
    startedAt: route.startedAt == null ? null : route.startedAt,
    completedAt: route.completedAt == null ? null : route.completedAt,
    agent: { id: agent.id, name: agent.name },
  }
}

export function parseFieldManagerPlanning(value: unknown): FieldManagerPlanningData {
  const data = validEnvelope(value)
  const date = data?.date == null ? null : data.date
  if (
    !data ||
    !managerScope(data.scope) ||
    !(date == null || dateKey(date)) ||
    !dateKey(data.from) ||
    !dateKey(data.to) ||
    !number(data.days) ||
    data.days < 1 ||
    !number(data.maxRangeDays) ||
    data.maxRangeDays < data.days ||
    !boolean(data.truncated) ||
    !Array.isArray(data.agents) ||
    !Array.isArray(data.routes)
  ) {
    throw new FieldContractError("mobile manager planning")
  }
  const agents = data.agents.map(managerPlanningAgent)
  const routes = data.routes.map(managerPlanningRoute)
  if (agents.some((agent) => agent == null) || routes.some((route) => route == null)) {
    throw new FieldContractError("mobile manager planning")
  }
  return {
    scope: data.scope,
    date: date == null ? null : date,
    from: data.from,
    to: data.to,
    days: data.days,
    maxRangeDays: data.maxRangeDays,
    agents: agents as FieldManagerPlanningAgent[],
    routes: routes as FieldManagerPlanningRoute[],
    truncated: data.truncated,
  }
}

function managerPerson(value: unknown, key: "agent" | "requestedByAgent"): { name: string } | null {
  const person = record(record(value)?.[key])
  return person && string(person.name) ? { name: person.name } : null
}

function managerHrmApproval(value: unknown): FieldManagerHrmApproval | null {
  const item = record(value)
  const agent = managerPerson(value, "agent")
  if (
    !item ||
    !string(item.id) ||
    !string(item.agentId) ||
    !string(item.type) ||
    !timestamp(item.startDate) ||
    !timestamp(item.endDate) ||
    !string(item.reason) ||
    !timestamp(item.submittedAt) ||
    !agent
  ) {
    return null
  }
  return {
    id: item.id, agentId: item.agentId, type: item.type, startDate: item.startDate,
    endDate: item.endDate, reason: item.reason, submittedAt: item.submittedAt, agent,
  }
}

function managerRouteChangeApproval(value: unknown): FieldManagerRouteChangeApproval | null {
  const item = record(value)
  const requestedByAgent = managerPerson(value, "requestedByAgent")
  if (
    !item ||
    !string(item.id) ||
    !string(item.requestedByAgentId) ||
    !string(item.routeId) ||
    !string(item.changeType) ||
    !string(item.reason) ||
    !string(item.status) ||
    !timestamp(item.submittedAt) ||
    !requestedByAgent
  ) {
    return null
  }
  return {
    id: item.id, requestedByAgentId: item.requestedByAgentId, routeId: item.routeId,
    changeType: item.changeType, reason: item.reason, status: item.status,
    submittedAt: item.submittedAt, requestedByAgent,
  }
}

function managerCustomerApproval(value: unknown): FieldManagerCustomerApproval | null {
  const item = record(value)
  const requestedByAgent = managerPerson(value, "requestedByAgent")
  if (
    !item ||
    !string(item.id) ||
    !string(item.requestedByAgentId) ||
    !string(item.name) ||
    !string(item.objectType) ||
    !string(item.reason) ||
    !string(item.status) ||
    !timestamp(item.submittedAt) ||
    !requestedByAgent
  ) {
    return null
  }
  return {
    id: item.id, requestedByAgentId: item.requestedByAgentId, name: item.name,
    objectType: item.objectType, reason: item.reason, status: item.status,
    submittedAt: item.submittedAt, requestedByAgent,
  }
}

function managerContactChangeApproval(value: unknown): FieldManagerContactChangeApproval | null {
  const item = record(value)
  const contact = record(item?.contact)
  const requestedByAgent = managerPerson(value, "requestedByAgent")
  const payload = item?.payload == null ? null : record(item.payload)
  if (
    !item ||
    !string(item.id) ||
    !string(item.contactId) ||
    !string(item.requestedByAgentId) ||
    !string(item.kind) ||
    !string(item.reason) ||
    !string(item.status) ||
    !timestamp(item.submittedAt) ||
    (item.payload != null && !payload) ||
    !contact ||
    !string(contact.displayName) ||
    !requestedByAgent
  ) {
    return null
  }
  return {
    id: item.id, contactId: item.contactId, requestedByAgentId: item.requestedByAgentId,
    kind: item.kind, reason: item.reason, status: item.status, submittedAt: item.submittedAt,
    payload,
    contact: { displayName: contact.displayName }, requestedByAgent,
  }
}

export function parseFieldManagerApprovals(value: unknown): FieldManagerApprovalsData {
  const data = validEnvelope(value)
  const counts = record(data?.counts)
  if (
    !data ||
    !managerScope(data.scope) ||
    !counts ||
    !number(counts.hrm) ||
    !number(counts.routeChanges) ||
    !number(counts.customers) ||
    !number(counts.contactChanges) ||
    !Array.isArray(data.hrm) ||
    !Array.isArray(data.routeChanges) ||
    !Array.isArray(data.customers) ||
    !Array.isArray(data.contactChanges)
  ) {
    throw new FieldContractError("mobile manager approvals")
  }
  const hrm = data.hrm.map(managerHrmApproval)
  const routeChanges = data.routeChanges.map(managerRouteChangeApproval)
  const customers = data.customers.map(managerCustomerApproval)
  const contactChanges = data.contactChanges.map(managerContactChangeApproval)
  if (
    hrm.some((item) => item == null) ||
    routeChanges.some((item) => item == null) ||
    customers.some((item) => item == null) ||
    contactChanges.some((item) => item == null)
  ) {
    throw new FieldContractError("mobile manager approvals")
  }
  return {
    scope: data.scope,
    counts: {
      hrm: counts.hrm,
      routeChanges: counts.routeChanges,
      customers: counts.customers,
      contactChanges: counts.contactChanges,
    },
    hrm: hrm as FieldManagerHrmApproval[],
    routeChanges: routeChanges as FieldManagerRouteChangeApproval[],
    customers: customers as FieldManagerCustomerApproval[],
    contactChanges: contactChanges as FieldManagerContactChangeApproval[],
  }
}

export function parseFieldVisitWorkspace(value: unknown): FieldVisitWorkspaceData {
  const data = validEnvelope(value)
  const visit = record(data?.visit)
  const customer = record(visit?.customer)
  const contact = visit?.contact == null ? null : record(visit.contact)
  const route = visit?.route == null ? null : record(visit.route)
  const routePoint = visit?.routePoint == null ? null : record(visit.routePoint)
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
    (customer.address != null && !string(customer.address)) ||
    (customer.city != null && !string(customer.city)) ||
    (customer.phone != null && !string(customer.phone)) ||
    (customer.latitude != null && !number(customer.latitude)) ||
    (customer.longitude != null && !number(customer.longitude)) ||
    (contact != null && (
      !string(contact.id) ||
      !string(contact.displayName) ||
      !string(contact.type) ||
      (contact.specialtyName != null && !string(contact.specialtyName)) ||
      (contact.phone != null && !string(contact.phone))
    )) ||
    (route != null && (
      !string(route.id) ||
      (route.name != null && !string(route.name)) ||
      !timestamp(route.date) ||
      !string(route.status)
    )) ||
    (routePoint != null && (
      !string(routePoint.id) ||
      !number(routePoint.orderIndex) ||
      (routePoint.plannedTime != null && !timestamp(routePoint.plannedTime)) ||
      !string(routePoint.status)
    )) ||
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
    if (item.target != null) {
      const target = record(item.target)
      if (
        !target ||
        !string(target.kind) ||
        !fieldNotificationTargetKinds.has(target.kind as FieldNotificationTargetKind) ||
        !string(target.id)
      ) {
        throw new FieldContractError("mobile notification target")
      }
    }
  }
  return data as unknown as FieldNotificationsData
}

const messageThreadTypes = new Set<FieldMessageThreadType>(["DIRECT", "BROADCAST", "SYSTEM"])
const messageReceiptTypes = new Set<FieldMessageReceiptType>(["READ", "ACKNOWLEDGED"])
const messageDeliveryStatuses = new Set<FieldMessageDeliveryStatus>(["SENT", "READ"])
const hrmRequestTypes = new Set<FieldHrmRequestType>(["LEAVE", "ABSENCE", "TIME_CORRECTION"])
const hrmRequestStatuses = new Set<FieldHrmRequestStatus>(["PENDING", "APPROVED", "REJECTED", "CANCELLED"])

function validMessagePerson(value: unknown): boolean {
  const person = record(value)
  return Boolean(
    person && string(person.id) && string(person.name) && string(person.role) &&
      (person.avatar == null || typeof person.avatar === "string") &&
      (person.teamId == null || typeof person.teamId === "string") &&
      (person.participantRole == null || typeof person.participantRole === "string"),
  )
}

function validMessageAttachment(value: unknown): boolean {
  if (value == null) return true
  const attachment = record(value)
  return Boolean(
    attachment && string(attachment.id) && string(attachment.fileName) &&
      string(attachment.mimeType) && number(attachment.sizeBytes) && attachment.sizeBytes >= 0 &&
      (attachment.title == null || typeof attachment.title === "string") &&
      (attachment.checksumSha256 == null || typeof attachment.checksumSha256 === "string") &&
      (attachment.downloadUrl == null || typeof attachment.downloadUrl === "string"),
  )
}

function validMessageDelivery(value: unknown): boolean {
  if (value == null) return true
  const delivery = record(value)
  return Boolean(
    delivery && string(delivery.status) &&
      messageDeliveryStatuses.has(delivery.status as FieldMessageDeliveryStatus) &&
      nullableTimestamp(delivery.readAt),
  )
}

function validMessage(value: unknown, summary = false): boolean {
  const message = record(value)
  if (!message) return false
  const receipts = message.receipts
  return Boolean(
    string(message.id) &&
      (message.senderAgentId == null || typeof message.senderAgentId === "string") &&
      (message.senderUserId == null || typeof message.senderUserId === "string") &&
      string(message.senderName) &&
      (summary || message.clientMessageId == null || typeof message.clientMessageId === "string") &&
      (message.body == null || typeof message.body === "string") &&
      timestamp(message.sentAt) && boolean(message.acknowledgementRequired) &&
      validMessageAttachment(message.attachmentDocument) &&
      (summary || boolean(message.read)) && boolean(message.acknowledged) &&
      validMessageDelivery(message.delivery) &&
      (receipts == null || (Array.isArray(receipts) && receipts.every((receiptValue) => {
        const receipt = record(receiptValue)
        return Boolean(
          receipt && string(receipt.type) && messageReceiptTypes.has(receipt.type as FieldMessageReceiptType) &&
            timestamp(receipt.occurredAt),
        )
      }))),
  )
}

export function parseFieldMessages(value: unknown): FieldMessagesData {
  const data = validEnvelope(value)
  const capabilities = record(data?.capabilities)
  if (
    !data || !Array.isArray(data.threads) || !number(data.unread) ||
    !Array.isArray(data.availableRecipients) || !data.availableRecipients.every(validMessagePerson) ||
    !capabilities || !boolean(capabilities.startDirectConversation) ||
    !boolean(capabilities.sendAttachments) || !boolean(capabilities.acknowledgeBroadcasts)
  ) throw new FieldContractError("mobile messages")
  for (const threadValue of data.threads) {
    const thread = record(threadValue)
    if (
      !thread || !string(thread.id) || !string(thread.type) ||
      !messageThreadTypes.has(thread.type as FieldMessageThreadType) ||
      (thread.subject == null ? false : typeof thread.subject !== "string") ||
      !string(thread.title) || !timestamp(thread.lastMessageAt) ||
      !Array.isArray(thread.participants) || !thread.participants.every(validMessagePerson) ||
      !(thread.lastMessage == null || validMessage(thread.lastMessage, true)) ||
      !boolean(thread.unread) || !boolean(thread.needsAcknowledgement)
    ) throw new FieldContractError("mobile messages")
  }
  return data as unknown as FieldMessagesData
}

export function parseFieldMessageThread(value: unknown): FieldMessageThreadData {
  const data = validEnvelope(value)
  const thread = record(data?.thread)
  const capabilities = record(data?.capabilities)
  if (
    !data || !thread || !string(thread.id) || !string(thread.type) ||
    !messageThreadTypes.has(thread.type as FieldMessageThreadType) ||
    (thread.subject == null ? false : typeof thread.subject !== "string") ||
    !timestamp(thread.lastMessageAt) ||
    !Array.isArray(thread.participants) || !thread.participants.every(validMessagePerson) ||
    !Array.isArray(thread.messages) || !thread.messages.every((message) => validMessage(message)) ||
    !capabilities || !boolean(capabilities.reply) || !boolean(capabilities.sendAttachments) ||
    !boolean(capabilities.acknowledge)
  ) throw new FieldContractError("mobile conversation")
  return data as unknown as FieldMessageThreadData
}

function validDocument(value: unknown): boolean {
  const document = record(value)
  const assignment = record(document?.assignment)
  return Boolean(
    document && string(document.id) &&
      (document.clientDocumentId == null || typeof document.clientDocumentId === "string") &&
      (document.title == null || typeof document.title === "string") &&
      string(document.fileName) && string(document.mimeType) &&
      number(document.sizeBytes) && document.sizeBytes >= 0 &&
      (document.checksumSha256 == null || typeof document.checksumSha256 === "string") &&
      (document.uploadedByAgentId == null || typeof document.uploadedByAgentId === "string") &&
      (document.visitId == null || typeof document.visitId === "string") &&
      (document.taskId == null || typeof document.taskId === "string") &&
      timestamp(document.createdAt) && assignment && string(assignment.id) &&
      boolean(assignment.required) && timestamp(assignment.assignedAt) &&
      nullableTimestamp(assignment.expiresAt) && nullableTimestamp(assignment.readAt) &&
      nullableTimestamp(assignment.downloadedAt) && boolean(document.expired) && string(document.downloadUrl),
  )
}

export function parseFieldDocuments(value: unknown): FieldDocumentsData {
  const data = validEnvelope(value)
  const capabilities = record(data?.capabilities)
  if (
    !data || !Array.isArray(data.documents) || !data.documents.every(validDocument) ||
    !capabilities || !boolean(capabilities.upload) || !boolean(capabilities.offlineDownload) ||
    !number(capabilities.maxUploadBytes) || capabilities.maxUploadBytes < 1
  ) throw new FieldContractError("mobile documents")
  return data as unknown as FieldDocumentsData
}

function validHrmRequest(value: unknown): boolean {
  const request = record(value)
  return Boolean(
    request && string(request.id) && string(request.clientRequestId) &&
      string(request.type) && hrmRequestTypes.has(request.type as FieldHrmRequestType) &&
      string(request.status) && hrmRequestStatuses.has(request.status as FieldHrmRequestStatus) &&
      timestamp(request.startDate) && timestamp(request.endDate) &&
      (request.correctionWorkdayId == null || typeof request.correctionWorkdayId === "string") &&
      nullableTimestamp(request.requestedStartAt) && nullableTimestamp(request.requestedEndAt) &&
      string(request.reason) && (request.decisionNote == null || typeof request.decisionNote === "string") &&
      timestamp(request.submittedAt) && nullableTimestamp(request.decidedAt) &&
      nullableTimestamp(request.cancelledAt) && timestamp(request.updatedAt),
  )
}

export function parseFieldHrm(value: unknown): FieldHrmData {
  const data = validEnvelope(value)
  const capabilities = record(data?.capabilities)
  if (
    !data || !string(data.timezone) || !dateKey(data.start) || !dateKey(data.end) ||
    !Array.isArray(data.days) || !Array.isArray(data.requests) || !data.requests.every(validHrmRequest) ||
    !capabilities || !boolean(capabilities.requestLeave) || !boolean(capabilities.requestAbsence) ||
    !boolean(capabilities.requestTimeCorrection) || !boolean(capabilities.cancelPending)
  ) throw new FieldContractError("mobile HRM")
  for (const dayValue of data.days) {
    const day = record(dayValue)
    const calendar = record(day?.calendar)
    const workday = day?.workday == null ? null : record(day.workday)
    if (
      !day || !dateKey(day.date) || !calendar || !boolean(calendar.isWorkingDay) ||
      !string(calendar.kind) || !string(calendar.source) ||
      (calendar.name == null ? false : typeof calendar.name !== "string") ||
      !boolean(calendar.routePlanningAllowed) ||
      (workday && (!string(workday.id) || !timestamp(workday.workDate) || !string(workday.status) ||
        !timestamp(workday.startedAt) || !nullableTimestamp(workday.pausedAt) ||
        !nullableTimestamp(workday.completedAt) || !number(workday.totalPausedSeconds))) ||
      !Array.isArray(day.requests) || !day.requests.every((requestValue) => {
        const request = record(requestValue)
        return Boolean(
          request && string(request.id) && string(request.type) &&
            hrmRequestTypes.has(request.type as FieldHrmRequestType) && string(request.status) &&
            hrmRequestStatuses.has(request.status as FieldHrmRequestStatus),
        )
      })
    ) throw new FieldContractError("mobile HRM")
  }
  return data as unknown as FieldHrmData
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
      string(contact.status) &&
      (contact.updatedAt == null || timestamp(contact.updatedAt)),
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

function validContactChangeRequest(value: unknown): value is Record<string, unknown> {
  const request = record(value)
  return Boolean(
    request &&
      string(request.id) &&
      string(request.contactId) &&
      string(request.kind) &&
      string(request.status) &&
      string(request.reason) &&
      record(request.payload) &&
      timestamp(request.submittedAt) &&
      (request.decisionComment == null || string(request.decisionComment)) &&
      nullableTimestamp(request.reviewedAt),
  )
}

export function parseFieldContactChangeRequests(value: unknown): FieldContactChangeRequestsData {
  const data = validEnvelope(value)
  if (!data || !Array.isArray(data.requests) || !data.requests.every(validContactChangeRequest)) {
    throw new FieldContractError("contact change requests")
  }
  return data as unknown as FieldContactChangeRequestsData
}

export function parseFieldContactChangeRequest(value: unknown): FieldContactChangeRequest {
  const data = validEnvelope(value)
  if (!data || !validContactChangeRequest(data)) {
    throw new FieldContractError("contact change request")
  }
  return data as unknown as FieldContactChangeRequest
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
