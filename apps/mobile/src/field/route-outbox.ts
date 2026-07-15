import { HttpError } from "../sync/ports-error"

export type FieldRouteMutationPoint = {
  customerId: string
  contactId?: string | null
  plannedTime: string | null
}

export type FieldRouteCreatePayload = {
  localRouteId: string
  agentId: string
  date: string
  name?: string | null
  notes?: string | null
  points: FieldRouteMutationPoint[]
}

export type FieldRouteUpdatePayload = {
  routeId: string
  name?: string | null
  notes?: string | null
  points: FieldRouteMutationPoint[]
}

export type FieldRoutePublishPayload = { routeId: string }

export type FieldRouteChangeRequestPayload = {
  routeId: string
  changeType: "REMOVE_STOP" | "ADD_STOP" | "CONFLICT_OVERRIDE"
  routePointId?: string
  reason: string
  payload?: Record<string, unknown>
}

export type FieldRoutePushOperation = {
  clientOpId: string
  clientCreatedAt?: string
} & (
  | { kind: "field.route.create"; payload: FieldRouteCreatePayload }
  | { kind: "field.route.update"; payload: FieldRouteUpdatePayload }
  | { kind: "field.route.publish"; payload: FieldRoutePublishPayload }
  | { kind: "field.route.change-request"; payload: FieldRouteChangeRequestPayload }
)

export type FieldRoutePushResult = {
  clientOpId: string
  status: "applied" | "already_applied" | "conflict" | "rejected"
  detail?: unknown
}

type RouteMutationApi = {
  createRoute(input: Omit<FieldRouteCreatePayload, "localRouteId">): Promise<{ id: string }>
  updateRoute(routeId: string, input: Omit<FieldRouteUpdatePayload, "routeId">): Promise<void>
  publishRoute(routeId: string): Promise<void>
  requestRouteChange(
    routeId: string,
    input: Omit<FieldRouteChangeRequestPayload, "routeId">,
  ): Promise<void>
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nullableString(value: unknown): value is string | null | undefined {
  return value == null || typeof value === "string"
}

function parsePoints(value: unknown): FieldRouteMutationPoint[] {
  if (!Array.isArray(value)) throw new Error("Invalid field route points")
  return value.map((item) => {
    const point = record(item)
    if (
      !point ||
      typeof point.customerId !== "string" ||
      !nullableString(point.contactId) ||
      !nullableString(point.plannedTime)
    ) throw new Error("Invalid field route point")
    return {
      customerId: point.customerId,
      contactId: point.contactId ?? null,
      plannedTime: point.plannedTime ?? null,
    }
  })
}

export function parseFieldRouteCreatePayload(value: unknown): FieldRouteCreatePayload {
  const payload = record(value)
  if (
    !payload ||
    typeof payload.localRouteId !== "string" ||
    typeof payload.agentId !== "string" ||
    typeof payload.date !== "string" ||
    !nullableString(payload.name) ||
    !nullableString(payload.notes)
  ) throw new Error("Invalid field route create payload")
  return {
    localRouteId: payload.localRouteId,
    agentId: payload.agentId,
    date: payload.date,
    name: payload.name ?? null,
    notes: payload.notes ?? null,
    points: parsePoints(payload.points),
  }
}

export function parseFieldRouteUpdatePayload(value: unknown): FieldRouteUpdatePayload {
  const payload = record(value)
  if (
    !payload ||
    typeof payload.routeId !== "string" ||
    !nullableString(payload.name) ||
    !nullableString(payload.notes)
  ) throw new Error("Invalid field route update payload")
  return {
    routeId: payload.routeId,
    name: payload.name ?? null,
    notes: payload.notes ?? null,
    points: parsePoints(payload.points),
  }
}

export function parseFieldRoutePublishPayload(value: unknown): FieldRoutePublishPayload {
  const payload = record(value)
  if (!payload || typeof payload.routeId !== "string") throw new Error("Invalid field route publish payload")
  return { routeId: payload.routeId }
}

export function parseFieldRouteChangeRequestPayload(value: unknown): FieldRouteChangeRequestPayload {
  const payload = record(value)
  const changeType = payload?.changeType
  if (
    !payload ||
    typeof payload.routeId !== "string" ||
    !["REMOVE_STOP", "ADD_STOP", "CONFLICT_OVERRIDE"].includes(String(changeType)) ||
    typeof payload.reason !== "string" ||
    (payload.routePointId != null && typeof payload.routePointId !== "string") ||
    (payload.payload != null && !record(payload.payload))
  ) throw new Error("Invalid field route change request payload")
  return {
    routeId: payload.routeId,
    changeType: changeType as FieldRouteChangeRequestPayload["changeType"],
    routePointId: typeof payload.routePointId === "string" ? payload.routePointId : undefined,
    reason: payload.reason,
    payload: record(payload.payload) ?? undefined,
  }
}

export function isFieldRoutePushOperation(operation: { kind: string }): operation is FieldRoutePushOperation {
  return operation.kind === "field.route.create" ||
    operation.kind === "field.route.update" ||
    operation.kind === "field.route.publish" ||
    operation.kind === "field.route.change-request"
}

function duplicateRouteId(error: HttpError): string | null {
  const detail = record(error.detail)
  const duplicate = record(detail?.duplicate)
  return detail?.code === "ROUTE_DUPLICATE" && typeof duplicate?.id === "string"
    ? duplicate.id
    : null
}

export async function sendFieldRouteOperation(
  operation: FieldRoutePushOperation,
  api: RouteMutationApi,
): Promise<FieldRoutePushResult> {
  try {
    if (operation.kind === "field.route.create") {
      const { localRouteId: _localRouteId, ...input } = operation.payload
      const route = await api.createRoute(input)
      return { clientOpId: operation.clientOpId, status: "applied", detail: { routeId: route.id } }
    }
    if (operation.kind === "field.route.update") {
      await api.updateRoute(operation.payload.routeId, {
        name: operation.payload.name,
        notes: operation.payload.notes,
        points: operation.payload.points,
      })
    } else if (operation.kind === "field.route.publish") {
      await api.publishRoute(operation.payload.routeId)
    } else {
      const { routeId, ...input } = operation.payload
      await api.requestRouteChange(routeId, input)
    }
    return {
      clientOpId: operation.clientOpId,
      status: "applied",
      detail: { routeId: operation.payload.routeId },
    }
  } catch (error) {
    if (!(error instanceof HttpError) || error.status >= 500 || error.status === 408 || error.status === 429) {
      throw error
    }
    const duplicateId = operation.kind === "field.route.create" ? duplicateRouteId(error) : null
    if (duplicateId) {
      return {
        clientOpId: operation.clientOpId,
        status: "already_applied",
        detail: { routeId: duplicateId, duplicate: true },
      }
    }
    return {
      clientOpId: operation.clientOpId,
      status: error.status === 404 || error.status === 409 ? "conflict" : "rejected",
      detail: error.detail ?? error.message,
    }
  }
}
