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

export type FieldExecutionPushOperation = {
  clientOpId: string
  clientCreatedAt?: string
} & (
  | { kind: "field.visit.checkin"; payload: FieldVisitCheckInPayload }
  | { kind: "field.visit.action"; payload: FieldVisitActionPayload }
  | { kind: "field.visit.update"; payload: FieldVisitUpdatePayload }
)

export type FieldServerOperation = {
  operationId: string
  op: "create" | "update"
  entity: "visits" | "visitActions"
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

export function isFieldExecutionPushOperation(
  operation: { kind: string },
): operation is FieldExecutionPushOperation {
  return operation.kind === "field.visit.checkin" ||
    operation.kind === "field.visit.action" ||
    operation.kind === "field.visit.update"
}

export function toFieldServerOperation(operation: FieldExecutionPushOperation): FieldServerOperation {
  const clientTimestamp = operation.clientCreatedAt
    ? new Date(operation.clientCreatedAt).getTime()
    : Date.now()
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
