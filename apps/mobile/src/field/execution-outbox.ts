import { HttpError } from "../sync/ports-error"

export type FieldVisitOutcome = "SUCCESSFUL" | "PARTIAL" | "NO_CONTACT" | "RESCHEDULE"
export type FieldVisitPotential = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"
export type FieldVisitActionKey =
  | "PHOTO"
  | "PRESENTATION"
  | "STOCK_CHECK"
  | "VISIT_NOTE"
  | "CHECKLIST"
  | "FEEDBACK"
  | "NEXT_ACTION"

export type FieldVisitCheckInPayload = {
  visitId: string
  customerId: string
  contactId: string | null
  routeId: string
  routePointId: string
  checkInAt: string
  checkInLat: number | null
  checkInLng: number | null
  accuracyM: number | null
  notes?: string | null
}

export type FieldVisitActionPayload = {
  actionResultId: string
  visitId: string
  actionKey: FieldVisitActionKey
  status: "COMPLETED" | "WAIVED"
  evidence?: Record<string, unknown> | null
  completedAt: string
}

export type FieldVisitUpdatePayload = {
  visitId: string
  status?: "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED"
  checkOutAt?: string
  checkOutLat?: number | null
  checkOutLng?: number | null
  outcome?: FieldVisitOutcome
  potential?: FieldVisitPotential
  notes?: string | null
  resultNotes?: string | null
}

export type FieldVisitPhotoPayload = {
  clientPhotoId: string
  visitId: string
  agentId: string
  fileUri: string
  category: string | null
  latitude: number | null
  longitude: number | null
  takenAt: string
}

export type FieldWorkdayAction = "START" | "PAUSE" | "RESUME" | "FINISH"

export type FieldWorkdayEventPayload = {
  action: FieldWorkdayAction
  workdayId: string
  workDate?: string
  occurredAt: string
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  note: string | null
}

export type FieldLocationPayload = {
  clientLocationId: string
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  altitude: number | null
  battery: number | null
  recordedAt: string
}

export type FieldTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT"
export type FieldTaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
export type FieldTaskRecurrenceRule = "DAILY" | "WEEKLY" | "MONTHLY"

export type FieldTaskCreatePayload = {
  taskId: string
  title: string
  description?: string | null
  customerId?: string | null
  visitId?: string | null
  priority: FieldTaskPriority
  dueDate?: string | null
  copiedFromId?: string | null
  recurrence?: {
    rule: FieldTaskRecurrenceRule
    interval: number
    until?: string | null
  } | null
}

export type FieldTaskUpdatePayload = {
  taskId: string
  expectedVersion: number
  status?: FieldTaskStatus
  title?: string
  description?: string | null
  priority?: FieldTaskPriority
  dueDate?: string | null
  result?: string | null
  acceptedAt?: string
}

export type FieldTaskEventPayload = {
  taskId: string
  type: "COMMENTED" | "EVIDENCE_ADDED"
  occurredAt: string
  comment?: string | null
  evidence?: Record<string, unknown> | null
}

export type FieldCommitmentCreatePayload = {
  clientCommitmentId: string
  visitId: string
  customerId: string
  customerName: string
  customerType: string
  contactId: string | null
  contactName: string | null
  productExternalId: string | null
  productName: string
  brandExternalId: string | null
  brandName: string | null
  promisedQuantity: number
  unit: string
  dueAt: string
  note: string | null
  evidenceClientPhotoId: string | null
}

export type FieldCommitmentFulfillPayload = {
  commitmentId: string
  clientFulfillmentId: string
  outcome: "FULFILLED" | "PARTIAL" | "NOT_FULFILLED"
  actualQuantity: number
  note: string | null
  evidenceClientPhotoId: string | null
}

export type FieldMessageCreatePayload = {
  threadId: string | null
  recipientAgentId: string | null
  clientMessageId: string
  body: string | null
  attachmentClientDocumentId: string | null
  sentAt: string
}

export type FieldMessageReceiptPayload = {
  messageId: string
  type: "READ" | "ACKNOWLEDGED"
  clientReceiptId: string
  occurredAt: string
}

export type FieldDocumentStatePayload = {
  documentId: string
  state: "READ" | "DOWNLOADED"
  occurredAt: string
}

export type FieldDocumentUploadPayload = {
  clientDocumentId: string
  title: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  fileUri: string
  visitId: string | null
  taskId: string | null
  createdAt: string
}

export type FieldHrmRequestCreatePayload = {
  id: string
  clientRequestId: string
  type: "LEAVE" | "ABSENCE" | "TIME_CORRECTION"
  startDate: string
  endDate: string
  correctionWorkdayId: string | null
  requestedStartAt: string | null
  requestedEndAt: string | null
  reason: string
  submittedAt: string
}

export type FieldHrmRequestCancelPayload = {
  id: string
  cancelledAt: string
}

export type FieldExecutionPushOperation = {
  clientOpId: string
  clientCreatedAt?: string
} & (
  | { kind: "field.visit.checkin"; payload: FieldVisitCheckInPayload }
  | { kind: "field.visit.action"; payload: FieldVisitActionPayload }
  | { kind: "field.visit.update"; payload: FieldVisitUpdatePayload }
  | { kind: "field.workday.event"; payload: FieldWorkdayEventPayload }
  | { kind: "field.task.create"; payload: FieldTaskCreatePayload }
  | { kind: "field.task.update"; payload: FieldTaskUpdatePayload }
  | { kind: "field.task.event"; payload: FieldTaskEventPayload }
  | { kind: "field.commitment.create"; payload: FieldCommitmentCreatePayload }
  | { kind: "field.commitment.fulfill"; payload: FieldCommitmentFulfillPayload }
  | { kind: "field.message.send"; payload: FieldMessageCreatePayload }
  | { kind: "field.message.receipt"; payload: FieldMessageReceiptPayload }
  | { kind: "field.document.state"; payload: FieldDocumentStatePayload }
  | { kind: "field.hrm.create"; payload: FieldHrmRequestCreatePayload }
  | { kind: "field.hrm.cancel"; payload: FieldHrmRequestCancelPayload }
)

export type FieldVisitPhotoPushOperation = {
  clientOpId: string
  clientCreatedAt?: string
  kind: "field.visit.photo"
  payload: FieldVisitPhotoPayload
}

export type FieldLocationPushOperation = {
  clientOpId: string
  clientCreatedAt?: string
  kind: "field.location"
  payload: FieldLocationPayload
}

export type FieldDocumentUploadPushOperation = {
  clientOpId: string
  clientCreatedAt?: string
  kind: "field.document.upload"
  payload: FieldDocumentUploadPayload
}

export type FieldServerOperation = {
  operationId: string
  op: "create" | "update"
  entity: "visits" | "visitActions" | "workdays" | "tasks" | "taskEvents" | "commitments" | "commitmentFulfillments" | "messages" | "messageReceipts" | "documentStates" | "hrmRequests"
  data: Record<string, unknown>
  clientTimestamp: number
}

export type FieldServerPushResponse = {
  success: true
  results: Array<{
    operationId: string
    status: "ok" | "conflict" | "error"
    serverId?: string
    serverData?: unknown
    error?: string
  }>
}

export type FieldExecutionPushResult = {
  clientOpId: string
  status: "applied" | "conflict" | "rejected"
  detail?: unknown
}

type FieldExecutionApi = {
  push(operations: FieldServerOperation[]): Promise<FieldServerPushResponse>
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function string(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function parseDate(value: unknown): value is string {
  return string(value) && !Number.isNaN(new Date(value).getTime())
}

function safeId(value: unknown): value is string {
  return string(value) && value.length <= 100 && /^[A-Za-z0-9._:-]+$/.test(value)
}

export function parseFieldVisitCheckInPayload(value: unknown): FieldVisitCheckInPayload {
  const payload = record(value)
  const coordinatesValid = (
    (payload?.checkInLat == null && payload?.checkInLng == null) ||
    (finite(payload?.checkInLat) && finite(payload?.checkInLng) &&
      payload.checkInLat >= -90 && payload.checkInLat <= 90 &&
      payload.checkInLng >= -180 && payload.checkInLng <= 180)
  )
  if (
    !payload ||
    !string(payload.visitId) ||
    !string(payload.customerId) ||
    !(payload.contactId == null || string(payload.contactId)) ||
    !string(payload.routeId) ||
    !string(payload.routePointId) ||
    !parseDate(payload.checkInAt) ||
    !coordinatesValid ||
    !(payload.accuracyM == null || finite(payload.accuracyM))
  ) throw new Error("Invalid field visit check-in payload")
  return payload as unknown as FieldVisitCheckInPayload
}

export function parseFieldVisitActionPayload(value: unknown): FieldVisitActionPayload {
  const payload = record(value)
  const actionKeys = ["PHOTO", "PRESENTATION", "STOCK_CHECK", "VISIT_NOTE", "CHECKLIST", "FEEDBACK", "NEXT_ACTION"]
  if (
    !payload ||
    !string(payload.actionResultId) ||
    !string(payload.visitId) ||
    !actionKeys.includes(String(payload.actionKey)) ||
    !["COMPLETED", "WAIVED"].includes(String(payload.status)) ||
    !parseDate(payload.completedAt) ||
    !(payload.evidence == null || record(payload.evidence))
  ) throw new Error("Invalid field visit action payload")
  return payload as unknown as FieldVisitActionPayload
}

export function parseFieldVisitUpdatePayload(value: unknown): FieldVisitUpdatePayload {
  const payload = record(value)
  const coordinatesValid = (
    (payload?.checkOutLat == null && payload?.checkOutLng == null) ||
    (finite(payload?.checkOutLat) && finite(payload?.checkOutLng) &&
      payload.checkOutLat >= -90 && payload.checkOutLat <= 90 &&
      payload.checkOutLng >= -180 && payload.checkOutLng <= 180)
  )
  if (
    !payload ||
    !string(payload.visitId) ||
    !(payload.status == null || ["CHECKED_IN", "CHECKED_OUT", "CANCELLED"].includes(String(payload.status))) ||
    !(payload.checkOutAt == null || parseDate(payload.checkOutAt)) ||
    !coordinatesValid ||
    !(payload.outcome == null || ["SUCCESSFUL", "PARTIAL", "NO_CONTACT", "RESCHEDULE"].includes(String(payload.outcome))) ||
    !(payload.potential == null || ["HIGH", "MEDIUM", "LOW", "UNKNOWN"].includes(String(payload.potential)))
  ) throw new Error("Invalid field visit update payload")
  return payload as unknown as FieldVisitUpdatePayload
}

export function parseFieldVisitPhotoPayload(value: unknown): FieldVisitPhotoPayload {
  const payload = record(value)
  const coordinatesValid = (
    (payload?.latitude == null && payload?.longitude == null) ||
    (finite(payload?.latitude) && finite(payload?.longitude) &&
      payload.latitude >= -90 && payload.latitude <= 90 &&
      payload.longitude >= -180 && payload.longitude <= 180)
  )
  if (
    !payload ||
    !string(payload.clientPhotoId) ||
    payload.clientPhotoId.length < 8 ||
    payload.clientPhotoId.length > 128 ||
    !string(payload.visitId) ||
    !string(payload.agentId) ||
    !string(payload.fileUri) ||
    !(payload.category == null || string(payload.category)) ||
    !coordinatesValid ||
    !parseDate(payload.takenAt)
  ) throw new Error("Invalid field visit photo payload")
  return payload as unknown as FieldVisitPhotoPayload
}

export function parseFieldWorkdayEventPayload(value: unknown): FieldWorkdayEventPayload {
  const payload = record(value)
  const actions = ["START", "PAUSE", "RESUME", "FINISH"]
  const coordinatesValid = (
    (payload?.latitude == null && payload?.longitude == null) ||
    (finite(payload?.latitude) && finite(payload?.longitude) &&
      payload.latitude >= -90 && payload.latitude <= 90 &&
      payload.longitude >= -180 && payload.longitude <= 180)
  )
  if (
    !payload ||
    !actions.includes(String(payload.action)) ||
    !string(payload.workdayId) ||
    !(payload.workDate == null || (string(payload.workDate) && /^\d{4}-\d{2}-\d{2}$/.test(payload.workDate))) ||
    !parseDate(payload.occurredAt) ||
    !coordinatesValid ||
    !(payload.accuracy == null || (finite(payload.accuracy) && payload.accuracy >= 0)) ||
    !(payload.note == null || (typeof payload.note === "string" && payload.note.length <= 500))
  ) throw new Error("Invalid field workday event payload")
  return payload as unknown as FieldWorkdayEventPayload
}

export function parseFieldLocationPayload(value: unknown): FieldLocationPayload {
  const payload = record(value)
  if (
    !payload ||
    !string(payload.clientLocationId) ||
    payload.clientLocationId.length > 100 ||
    !finite(payload.latitude) || payload.latitude < -90 || payload.latitude > 90 ||
    !finite(payload.longitude) || payload.longitude < -180 || payload.longitude > 180 ||
    !(payload.accuracy == null || (finite(payload.accuracy) && payload.accuracy >= 0)) ||
    !(payload.speed == null || (finite(payload.speed) && payload.speed >= 0)) ||
    !(payload.heading == null || (finite(payload.heading) && payload.heading >= 0 && payload.heading <= 360)) ||
    !(payload.altitude == null || finite(payload.altitude)) ||
    !(payload.battery == null || (finite(payload.battery) && payload.battery >= 0 && payload.battery <= 100)) ||
    !parseDate(payload.recordedAt)
  ) throw new Error("Invalid field location payload")
  return payload as unknown as FieldLocationPayload
}

export function parseFieldTaskCreatePayload(value: unknown): FieldTaskCreatePayload {
  const payload = record(value)
  const recurrence = payload?.recurrence == null ? null : record(payload.recurrence)
  const dueDateValid = payload?.dueDate == null || parseDate(payload.dueDate)
  const recurrenceValid = !recurrence || (
    ["DAILY", "WEEKLY", "MONTHLY"].includes(String(recurrence.rule)) &&
    finite(recurrence.interval) && Number.isInteger(recurrence.interval) &&
    recurrence.interval >= 1 && recurrence.interval <= 30 &&
    (recurrence.until == null || parseDate(recurrence.until))
  )
  if (
    !payload ||
    !safeId(payload.taskId) ||
    !string(payload.title) || payload.title.trim().length < 1 || payload.title.trim().length > 200 ||
    !(payload.description == null || (typeof payload.description === "string" && payload.description.length <= 5_000)) ||
    !(payload.customerId == null || safeId(payload.customerId)) ||
    !(payload.visitId == null || safeId(payload.visitId)) ||
    !["LOW", "MEDIUM", "HIGH", "URGENT"].includes(String(payload.priority)) ||
    !dueDateValid ||
    !(payload.copiedFromId == null || safeId(payload.copiedFromId)) ||
    !recurrenceValid ||
    (recurrence != null && payload.dueDate == null) ||
    (recurrence?.until != null && new Date(String(recurrence.until)).getTime() < new Date(String(payload.dueDate)).getTime())
  ) throw new Error("Invalid field task create payload")
  return payload as unknown as FieldTaskCreatePayload
}

export function parseFieldTaskUpdatePayload(value: unknown): FieldTaskUpdatePayload {
  const payload = record(value)
  const mutationKeys = ["status", "title", "description", "priority", "dueDate", "result", "acceptedAt"]
  if (
    !payload ||
    !safeId(payload.taskId) ||
    !finite(payload.expectedVersion) || !Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 1 ||
    !mutationKeys.some((key) => payload[key] !== undefined) ||
    !(payload.status === undefined || ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(String(payload.status))) ||
    !(payload.title === undefined || (string(payload.title) && payload.title.trim().length <= 200)) ||
    !(payload.description == null || (typeof payload.description === "string" && payload.description.length <= 5_000)) ||
    !(payload.priority === undefined || ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(String(payload.priority))) ||
    !(payload.dueDate == null || parseDate(payload.dueDate)) ||
    !(payload.result == null || (typeof payload.result === "string" && payload.result.length <= 5_000)) ||
    !(payload.acceptedAt === undefined || parseDate(payload.acceptedAt))
  ) throw new Error("Invalid field task update payload")
  return payload as unknown as FieldTaskUpdatePayload
}

export function parseFieldTaskEventPayload(value: unknown): FieldTaskEventPayload {
  const payload = record(value)
  const evidence = payload?.evidence == null ? null : record(payload.evidence)
  if (
    !payload ||
    !safeId(payload.taskId) ||
    !["COMMENTED", "EVIDENCE_ADDED"].includes(String(payload.type)) ||
    !parseDate(payload.occurredAt) ||
    !(payload.comment == null || (typeof payload.comment === "string" && payload.comment.trim().length > 0 && payload.comment.length <= 2_000)) ||
    !(payload.evidence == null || evidence) ||
    (payload.type === "COMMENTED" && !payload.comment) ||
    (payload.type === "EVIDENCE_ADDED" && !evidence) ||
    (evidence != null && JSON.stringify(evidence).length > 25_000)
  ) throw new Error("Invalid field task event payload")
  return payload as unknown as FieldTaskEventPayload
}

function quantity(value: unknown, allowZero: boolean): value is number {
  return finite(value) &&
    (allowZero ? value >= 0 : value > 0) &&
    value <= 1_000_000_000 &&
    Math.abs(value * 100 - Math.round(value * 100)) <= 1e-7
}

function optionalText(value: unknown, max: number): boolean {
  return value == null || (typeof value === "string" && value.trim().length <= max)
}

export function parseFieldCommitmentCreatePayload(value: unknown): FieldCommitmentCreatePayload {
  const payload = record(value)
  if (
    !payload ||
    !safeId(payload.clientCommitmentId) ||
    !safeId(payload.visitId) ||
    !safeId(payload.customerId) ||
    !string(payload.customerName) || payload.customerName.trim().length > 200 ||
    !string(payload.customerType) || payload.customerType.length > 40 ||
    !(payload.contactId == null || safeId(payload.contactId)) ||
    !optionalText(payload.contactName, 200) ||
    !optionalText(payload.productExternalId, 128) ||
    !string(payload.productName) || payload.productName.trim().length > 200 ||
    !optionalText(payload.brandExternalId, 128) ||
    !optionalText(payload.brandName, 200) ||
    !quantity(payload.promisedQuantity, false) ||
    !string(payload.unit) || payload.unit.trim().length > 40 ||
    !parseDate(payload.dueAt) ||
    !optionalText(payload.note, 2_000) ||
    !(payload.evidenceClientPhotoId == null || safeId(payload.evidenceClientPhotoId))
  ) throw new Error("Invalid field commitment create payload")
  return payload as unknown as FieldCommitmentCreatePayload
}

export function parseFieldCommitmentFulfillPayload(value: unknown): FieldCommitmentFulfillPayload {
  const payload = record(value)
  if (
    !payload ||
    !safeId(payload.commitmentId) ||
    !safeId(payload.clientFulfillmentId) ||
    !["FULFILLED", "PARTIAL", "NOT_FULFILLED"].includes(String(payload.outcome)) ||
    !quantity(payload.actualQuantity, true) ||
    !optionalText(payload.note, 2_000) ||
    !(payload.evidenceClientPhotoId == null || safeId(payload.evidenceClientPhotoId))
  ) throw new Error("Invalid field commitment fulfillment payload")
  return payload as unknown as FieldCommitmentFulfillPayload
}

export function parseFieldMessageCreatePayload(value: unknown): FieldMessageCreatePayload {
  const payload = record(value)
  const threadId = payload?.threadId
  const recipientAgentId = payload?.recipientAgentId
  const hasThread = threadId != null
  const hasRecipient = recipientAgentId != null
  if (
    !payload || hasThread === hasRecipient ||
    !(threadId == null || safeId(threadId)) ||
    !(recipientAgentId == null || safeId(recipientAgentId)) ||
    !safeId(payload.clientMessageId) || payload.clientMessageId.length < 8 ||
    !(payload.body == null || (typeof payload.body === "string" && payload.body.trim().length <= 4_000)) ||
    !(payload.attachmentClientDocumentId == null || safeId(payload.attachmentClientDocumentId)) ||
    (!(typeof payload.body === "string" && payload.body.trim()) && payload.attachmentClientDocumentId == null) ||
    !parseDate(payload.sentAt)
  ) throw new Error("Invalid field message payload")
  return payload as unknown as FieldMessageCreatePayload
}

export function parseFieldMessageReceiptPayload(value: unknown): FieldMessageReceiptPayload {
  const payload = record(value)
  if (
    !payload || !safeId(payload.messageId) ||
    !["READ", "ACKNOWLEDGED"].includes(String(payload.type)) ||
    !safeId(payload.clientReceiptId) || payload.clientReceiptId.length < 8 ||
    !parseDate(payload.occurredAt)
  ) throw new Error("Invalid field message receipt payload")
  return payload as unknown as FieldMessageReceiptPayload
}

export function parseFieldDocumentStatePayload(value: unknown): FieldDocumentStatePayload {
  const payload = record(value)
  if (
    !payload || !safeId(payload.documentId) ||
    !["READ", "DOWNLOADED"].includes(String(payload.state)) ||
    !parseDate(payload.occurredAt)
  ) throw new Error("Invalid field document state payload")
  return payload as unknown as FieldDocumentStatePayload
}

const documentMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/zip",
])

export function parseFieldDocumentUploadPayload(value: unknown): FieldDocumentUploadPayload {
  const payload = record(value)
  if (
    !payload || !safeId(payload.clientDocumentId) || payload.clientDocumentId.length < 8 ||
    !(payload.title == null || (typeof payload.title === "string" && payload.title.trim().length <= 200)) ||
    !string(payload.fileName) || payload.fileName.length > 240 || /[\\/\u0000-\u001f\u007f]/.test(payload.fileName) ||
    !string(payload.mimeType) || !documentMimeTypes.has(payload.mimeType) ||
    !finite(payload.sizeBytes) || !Number.isInteger(payload.sizeBytes) || payload.sizeBytes < 1 || payload.sizeBytes > 25 * 1024 * 1024 ||
    !string(payload.fileUri) ||
    !(payload.visitId == null || safeId(payload.visitId)) ||
    !(payload.taskId == null || safeId(payload.taskId)) ||
    !parseDate(payload.createdAt)
  ) throw new Error("Invalid field document upload payload")
  return payload as unknown as FieldDocumentUploadPayload
}

function dateKey(value: unknown): value is string {
  return string(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
}

export function parseFieldHrmRequestCreatePayload(value: unknown): FieldHrmRequestCreatePayload {
  const payload = record(value)
  const isCorrection = payload?.type === "TIME_CORRECTION"
  if (
    !payload || !safeId(payload.id) || !safeId(payload.clientRequestId) || payload.clientRequestId.length < 8 ||
    !["LEAVE", "ABSENCE", "TIME_CORRECTION"].includes(String(payload.type)) ||
    !dateKey(payload.startDate) || !dateKey(payload.endDate) || payload.endDate < payload.startDate ||
    !(payload.correctionWorkdayId == null || safeId(payload.correctionWorkdayId)) ||
    !(payload.requestedStartAt == null || parseDate(payload.requestedStartAt)) ||
    !(payload.requestedEndAt == null || parseDate(payload.requestedEndAt)) ||
    !string(payload.reason) || payload.reason.trim().length < 3 || payload.reason.trim().length > 1_000 ||
    !parseDate(payload.submittedAt) ||
    (isCorrection && !payload.correctionWorkdayId) ||
    (isCorrection && !payload.requestedStartAt && !payload.requestedEndAt) ||
    (!isCorrection && (payload.correctionWorkdayId != null || payload.requestedStartAt != null || payload.requestedEndAt != null))
  ) throw new Error("Invalid field HRM request payload")
  return payload as unknown as FieldHrmRequestCreatePayload
}

export function parseFieldHrmRequestCancelPayload(value: unknown): FieldHrmRequestCancelPayload {
  const payload = record(value)
  if (!payload || !safeId(payload.id) || !parseDate(payload.cancelledAt)) {
    throw new Error("Invalid field HRM cancellation payload")
  }
  return payload as unknown as FieldHrmRequestCancelPayload
}

export function isFieldExecutionPushOperation(
  operation: { kind: string },
): operation is FieldExecutionPushOperation {
  return operation.kind === "field.visit.checkin" ||
    operation.kind === "field.visit.action" ||
    operation.kind === "field.visit.update" ||
    operation.kind === "field.workday.event" ||
    operation.kind === "field.task.create" ||
    operation.kind === "field.task.update" ||
    operation.kind === "field.task.event" ||
    operation.kind === "field.commitment.create" ||
    operation.kind === "field.commitment.fulfill" ||
    operation.kind === "field.message.send" ||
    operation.kind === "field.message.receipt" ||
    operation.kind === "field.document.state" ||
    operation.kind === "field.hrm.create" ||
    operation.kind === "field.hrm.cancel"
}

export function isFieldVisitPhotoPushOperation(
  operation: { kind: string },
): operation is FieldVisitPhotoPushOperation {
  return operation.kind === "field.visit.photo"
}

export function isFieldLocationPushOperation(
  operation: { kind: string },
): operation is FieldLocationPushOperation {
  return operation.kind === "field.location"
}

export function isFieldDocumentUploadPushOperation(
  operation: { kind: string },
): operation is FieldDocumentUploadPushOperation {
  return operation.kind === "field.document.upload"
}

export function toFieldServerOperation(operation: FieldExecutionPushOperation): FieldServerOperation {
  const clientTimestamp = operation.clientCreatedAt
    ? new Date(operation.clientCreatedAt).getTime()
    : Date.now()
  if (operation.kind === "field.workday.event") {
    const { workdayId, ...payload } = operation.payload
    return {
      operationId: operation.clientOpId,
      op: "create",
      entity: "workdays",
      clientTimestamp,
      data: operation.payload.action === "START"
        ? { ...payload, id: workdayId }
        : { ...payload, workdayId },
    }
  }
  if (operation.kind === "field.task.create") {
    const { taskId, ...payload } = operation.payload
    return {
      operationId: operation.clientOpId,
      op: "create",
      entity: "tasks",
      clientTimestamp,
      data: { id: taskId, ...payload },
    }
  }
  if (operation.kind === "field.task.update") {
    const { taskId, ...payload } = operation.payload
    return {
      operationId: operation.clientOpId,
      op: "update",
      entity: "tasks",
      clientTimestamp,
      data: { id: taskId, ...payload },
    }
  }
  if (operation.kind === "field.task.event") {
    return {
      operationId: operation.clientOpId,
      op: "create",
      entity: "taskEvents",
      clientTimestamp,
      data: operation.payload,
    }
  }
  if (operation.kind === "field.commitment.create") {
    const payload = operation.payload
    return {
      operationId: operation.clientOpId,
      op: "create",
      entity: "commitments",
      clientTimestamp,
      data: {
        clientCommitmentId: payload.clientCommitmentId,
        visitId: payload.visitId,
        productExternalId: payload.productExternalId,
        productName: payload.productName,
        brandExternalId: payload.brandExternalId,
        brandName: payload.brandName,
        promisedQuantity: payload.promisedQuantity,
        unit: payload.unit,
        dueAt: payload.dueAt,
        note: payload.note,
        evidenceClientPhotoId: payload.evidenceClientPhotoId,
      },
    }
  }
  if (operation.kind === "field.commitment.fulfill") {
    return {
      operationId: operation.clientOpId,
      op: "create",
      entity: "commitmentFulfillments",
      clientTimestamp,
      data: operation.payload,
    }
  }
  if (operation.kind === "field.message.send") {
    return {
      operationId: operation.clientOpId,
      op: "create",
      entity: "messages",
      clientTimestamp,
      data: operation.payload,
    }
  }
  if (operation.kind === "field.message.receipt") {
    return {
      operationId: operation.clientOpId,
      op: "create",
      entity: "messageReceipts",
      clientTimestamp,
      data: operation.payload,
    }
  }
  if (operation.kind === "field.document.state") {
    return {
      operationId: operation.clientOpId,
      op: "update",
      entity: "documentStates",
      clientTimestamp,
      data: operation.payload,
    }
  }
  if (operation.kind === "field.hrm.create") {
    return {
      operationId: operation.clientOpId,
      op: "create",
      entity: "hrmRequests",
      clientTimestamp,
      data: operation.payload,
    }
  }
  if (operation.kind === "field.hrm.cancel") {
    return {
      operationId: operation.clientOpId,
      op: "update",
      entity: "hrmRequests",
      clientTimestamp,
      data: operation.payload,
    }
  }
  if (operation.kind === "field.visit.checkin") {
    const {
      visitId,
      checkInLat,
      checkInLng,
      accuracyM,
      ...payload
    } = operation.payload
    const coordinates = checkInLat == null || checkInLng == null
      ? {}
      : { checkInLat, checkInLng, accuracyM }
    return {
      operationId: operation.clientOpId,
      op: "create",
      entity: "visits",
      clientTimestamp,
      data: { id: visitId, ...payload, ...coordinates },
    }
  }
  if (operation.kind === "field.visit.action") {
    const { actionResultId, ...payload } = operation.payload
    return {
      operationId: operation.clientOpId,
      op: "create",
      entity: "visitActions",
      clientTimestamp,
      data: { id: actionResultId, ...payload },
    }
  }
  const {
    visitId,
    checkOutLat,
    checkOutLng,
    ...payload
  } = operation.payload
  const coordinates = checkOutLat == null || checkOutLng == null
    ? {}
    : { checkOutLat, checkOutLng }
  return {
    operationId: operation.clientOpId,
    op: "update",
    entity: "visits",
    clientTimestamp,
    data: { id: visitId, ...payload, ...coordinates },
  }
}

function retryableServerError(message: string): boolean {
  return /internal|retry|recheck|temporar|unavailable/i.test(message)
}

export async function sendFieldExecutionOperations(
  operations: FieldExecutionPushOperation[],
  api: FieldExecutionApi,
): Promise<FieldExecutionPushResult[]> {
  if (operations.length === 0) return []
  const response = await api.push(operations.map(toFieldServerOperation))
  const results = new Map(response.results.map((result) => [result.operationId, result]))

  for (const result of response.results) {
    if (result.status === "error" && retryableServerError(result.error ?? "")) {
      throw new HttpError(503, result.error ?? "Field execution retry required", result)
    }
  }

  return operations.map((operation) => {
    const result = results.get(operation.clientOpId)
    if (!result) throw new HttpError(503, "Field execution result missing")
    const detail = {
      ...(record(result.serverData) ?? {}),
      ...(result.serverId ? { serverId: result.serverId } : {}),
      ...(result.error ? { error: result.error } : {}),
    }
    return {
      clientOpId: operation.clientOpId,
      status: result.status === "ok" ? "applied" : result.status === "conflict" ? "conflict" : "rejected",
      detail,
    }
  })
}

export async function sendFieldVisitPhotoOperation(
  operation: FieldVisitPhotoPushOperation,
  api: { upload(payload: FieldVisitPhotoPayload): Promise<Record<string, unknown>> },
): Promise<FieldExecutionPushResult> {
  try {
    const photo = await api.upload(operation.payload)
    return {
      clientOpId: operation.clientOpId,
      status: "applied",
      detail: { photo },
    }
  } catch (error) {
    if (!(error instanceof HttpError)) throw error
    if (error.status === 408 || error.status === 429 || error.status >= 500) throw error
    return {
      clientOpId: operation.clientOpId,
      status: [403, 404, 409, 422].includes(error.status) ? "conflict" : "rejected",
      detail: error.detail ?? { error: error.message, status: error.status },
    }
  }
}

export async function sendFieldLocationOperation(
  operation: FieldLocationPushOperation,
  api: { upload(payload: FieldLocationPayload): Promise<Record<string, unknown>> },
): Promise<FieldExecutionPushResult> {
  try {
    const location = await api.upload(operation.payload)
    return { clientOpId: operation.clientOpId, status: "applied", detail: { location } }
  } catch (error) {
    if (!(error instanceof HttpError)) throw error
    if (error.status === 408 || error.status === 429 || error.status >= 500) throw error
    return {
      clientOpId: operation.clientOpId,
      status: [403, 404, 409, 422].includes(error.status) ? "conflict" : "rejected",
      detail: error.detail ?? { error: error.message, status: error.status },
    }
  }
}

export async function sendFieldDocumentUploadOperation(
  operation: FieldDocumentUploadPushOperation,
  api: { upload(payload: FieldDocumentUploadPayload): Promise<Record<string, unknown>> },
): Promise<FieldExecutionPushResult> {
  try {
    const document = await api.upload(operation.payload)
    return { clientOpId: operation.clientOpId, status: "applied", detail: { document } }
  } catch (error) {
    if (!(error instanceof HttpError)) throw error
    if (error.status === 408 || error.status === 429 || error.status >= 500) throw error
    return {
      clientOpId: operation.clientOpId,
      status: [403, 404, 409, 410, 422].includes(error.status) ? "conflict" : "rejected",
      detail: error.detail ?? { error: error.message, status: error.status },
    }
  }
}
