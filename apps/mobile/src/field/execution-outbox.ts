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
  checkInLat: number
  checkInLng: number
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
  checkOutLat?: number
  checkOutLng?: number
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

export type FieldExecutionPushOperation = {
  clientOpId: string
  clientCreatedAt?: string
} & (
  | { kind: "field.visit.checkin"; payload: FieldVisitCheckInPayload }
  | { kind: "field.visit.action"; payload: FieldVisitActionPayload }
  | { kind: "field.visit.update"; payload: FieldVisitUpdatePayload }
  | { kind: "field.workday.event"; payload: FieldWorkdayEventPayload }
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

export type FieldServerOperation = {
  operationId: string
  op: "create" | "update"
  entity: "visits" | "visitActions" | "workdays"
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

export function parseFieldVisitCheckInPayload(value: unknown): FieldVisitCheckInPayload {
  const payload = record(value)
  if (
    !payload ||
    !string(payload.visitId) ||
    !string(payload.customerId) ||
    !(payload.contactId == null || string(payload.contactId)) ||
    !string(payload.routeId) ||
    !string(payload.routePointId) ||
    !parseDate(payload.checkInAt) ||
    !finite(payload.checkInLat) ||
    !finite(payload.checkInLng) ||
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
  if (
    !payload ||
    !string(payload.visitId) ||
    !(payload.status == null || ["CHECKED_IN", "CHECKED_OUT", "CANCELLED"].includes(String(payload.status))) ||
    !(payload.checkOutAt == null || parseDate(payload.checkOutAt)) ||
    !(payload.checkOutLat == null || finite(payload.checkOutLat)) ||
    !(payload.checkOutLng == null || finite(payload.checkOutLng)) ||
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

export function isFieldExecutionPushOperation(
  operation: { kind: string },
): operation is FieldExecutionPushOperation {
  return operation.kind === "field.visit.checkin" ||
    operation.kind === "field.visit.action" ||
    operation.kind === "field.visit.update" ||
    operation.kind === "field.workday.event"
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
  if (operation.kind === "field.visit.checkin") {
    const { visitId, accuracyM, ...payload } = operation.payload
    return {
      operationId: operation.clientOpId,
      op: "create",
      entity: "visits",
      clientTimestamp,
      data: { id: visitId, ...payload, accuracyM },
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
  const { visitId, ...payload } = operation.payload
  return {
    operationId: operation.clientOpId,
    op: "update",
    entity: "visits",
    clientTimestamp,
    data: { id: visitId, ...payload },
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
