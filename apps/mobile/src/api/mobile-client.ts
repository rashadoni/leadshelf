// Единый мобильный транспорт: пользователь входит только в LeadDrive.
// CRM-запросы обслуживает LeadDrive, а коммерческий sync/photo трафик он
// проксирует в LeadShelf через доверенный Field BFF.

import { AuthLostError, HttpError, UpgradeRequiredError } from "../sync/ports-error"
import type { PullResponse, PushOperation, PushResult, SyncApi } from "../sync/ports"
import {
  MOBILE_PROTOCOL_VERSION,
  mobilePhotoUploadResponseSchema,
  mobileSyncPullResponseSchema,
  mobileSyncPushResponseSchema,
} from "@leadshelf/api-contracts/mobile/v1"
import { File } from "expo-file-system"
import * as FileSystem from "expo-file-system/legacy"
import { Platform } from "react-native"
import { tokenStore } from "../auth/token-store"
import { prepareMobileSessionScope } from "../db/local-store"
import { isFieldRoutePushOperation, sendFieldRouteOperation } from "../field/route-outbox"
import {
  isFieldExecutionPushOperation,
  isFieldLocationPushOperation,
  isFieldVisitPhotoPushOperation,
  sendFieldExecutionOperations,
  sendFieldLocationOperation,
  sendFieldVisitPhotoOperation,
  type FieldExecutionPushOperation,
  type FieldLocationPayload,
  type FieldServerOperation,
  type FieldServerPushResponse,
  type FieldVisitPhotoPayload,
} from "../field/execution-outbox"
import {
  parseFieldProfile,
  parseFieldAgentTasks,
  parseFieldPersonalKpi,
  parseFieldNotifications,
  parseFieldLocationHistory,
  parseFieldContactDetail,
  parseFieldContacts,
  parseFieldCustomerRequest,
  parseFieldCustomerRequests,
  parseFieldOrganizationDetail,
  parseFieldOrganizations,
  parseFieldWeek,
  parseFieldWorkday,
  parseFieldVisitWorkspace,
  type CreateFieldCustomerRequest,
  type FieldContactDetailData,
  type FieldContactListData,
  type FieldCustomerRequest,
  type FieldCustomerRequestsData,
  type FieldAgentProfile,
  type FieldProfileData,
  type FieldAgentTasksData,
  type FieldPersonalKpiData,
  type FieldNotificationsData,
  type FieldLocationHistoryData,
  type FieldOrganizationDetailData,
  type FieldOrganizationListData,
  type FieldWeekData,
  type FieldWorkdayData,
  type FieldVisitWorkspaceData,
} from "../field/contracts"

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://app.leaddrivecrm.org"
export const PROTOCOL_VERSION = MOBILE_PROTOCOL_VERSION

export { AuthLostError } from "../sync/ports-error"

export class AccountSwitchBlockedError extends Error {
  constructor(
    public pendingOps: number,
    public pendingPhotos: number,
  ) {
    super("Unsynced work belongs to another mobile account")
    this.name = "AccountSwitchBlockedError"
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const [access, deviceId] = await Promise.all([
    tokenStore.getAccess(),
    tokenStore.getDeviceId(),
  ])
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string>),
      // Протокол на не-JSON путях (multipart upload, media) едет заголовком.
      "x-leadshelf-protocol": String(PROTOCOL_VERSION),
      ...(deviceId ? { "x-field-device-id": deviceId } : {}),
      "x-field-device-platform": Platform.OS,
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
    },
  })
  if (res.status === 426) throw new UpgradeRequiredError()
  if (res.status === 401) throw new AuthLostError()
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const message = (body as { message?: string; error?: string }).message ??
      (body as { error?: string }).error
    throw new HttpError(res.status, message, body)
  }
  return (await res.json()) as T
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

export async function mobileLogin(input: {
  orgSlug: string
  email: string
  password: string
}): Promise<{ agent: FieldAgentProfile } | null> {
  const deviceId = await tokenStore.getDeviceId()
  const res = await fetch(`${API_URL}/api/v1/mtm/mobile/auth`, {
    ...json({
      organizationSlug: input.orgSlug,
      email: input.email,
      password: input.password,
    }),
    headers: {
      "Content-Type": "application/json",
      ...(deviceId ? { "x-field-device-id": deviceId } : {}),
      "x-field-device-platform": Platform.OS,
    },
  })
  if (res.status === 401 || res.status === 404) return null
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new HttpError(res.status, (error as { error?: string }).error, error)
  }
  const body = await res.json() as {
    success?: boolean
    data?: { token?: unknown; agent?: Record<string, unknown> }
  }
  const token = body.data?.token
  const rawAgent = body.data?.agent
  if (body.success !== true || typeof token !== "string" || !rawAgent) {
    throw new Error("Invalid mobile auth response")
  }
  const agent: FieldAgentProfile = {
    id: String(rawAgent.id ?? ""),
    name: String(rawAgent.name ?? ""),
    email: typeof rawAgent.email === "string" ? rawAgent.email : null,
    phone: typeof rawAgent.phone === "string" ? rawAgent.phone : null,
    role: String(rawAgent.role ?? "AGENT"),
    status: "ACTIVE",
    avatar: typeof rawAgent.avatar === "string" ? rawAgent.avatar : null,
    isOnline: true,
    organizationId: String(rawAgent.organizationId ?? ""),
    organizationName: String(rawAgent.organizationName ?? ""),
    manager: null,
  }
  if (!agent.id || !agent.name || !agent.organizationId) {
    throw new Error("Invalid mobile auth agent")
  }
  const scope = prepareMobileSessionScope(input.orgSlug, agent.id)
  if (!scope.ok) throw new AccountSwitchBlockedError(scope.pendingOps, scope.pendingPhotos)
  await tokenStore.setAccess(token)
  await tokenStore.setUserId(agent.id)
  await tokenStore.setUserName(agent.name)
  await tokenStore.setOrgSlug(input.orgSlug)
  await tokenStore.setLastEmail(input.email)
  return { agent }
}

// LeadDrive выдаёт короткоживущий bearer без refresh-сессии. Выход локальный;
// серверная ревокация будет подключена отдельным endpoint без смены клиента.
export async function mobileLogout(): Promise<void> {
  return Promise.resolve()
}

export const fieldApi = {
  profile: () => request<unknown>("/api/v1/mtm/mobile/profile").then(parseFieldProfile),
  week: (start?: string) =>
    request<unknown>(`/api/v1/mtm/mobile/week${start ? `?start=${encodeURIComponent(start)}` : ""}`)
      .then(parseFieldWeek),
  agentTasks: (query = "") =>
    request<unknown>(`/api/v1/mtm/mobile/tasks${query ? `?${query}` : ""}`)
      .then(parseFieldAgentTasks),
  personalKpi: (period: "week" | "month", anchor?: string) => {
    const query = new URLSearchParams({ period })
    if (anchor) query.set("anchor", anchor)
    return request<unknown>(`/api/v1/mtm/mobile/kpi?${query.toString()}`)
      .then(parseFieldPersonalKpi)
  },
  notifications: () =>
    request<unknown>("/api/v1/mtm/mobile/notifications").then(parseFieldNotifications),
  workday: (date?: string) =>
    request<unknown>(`/api/v1/mtm/mobile/workday${date ? `?date=${encodeURIComponent(date)}` : ""}`)
      .then(parseFieldWorkday),
  locations: (date?: string) =>
    request<unknown>(`/api/v1/mtm/mobile/location${date ? `?date=${encodeURIComponent(date)}` : ""}`)
      .then(parseFieldLocationHistory),
  uploadLocation: async (input: FieldLocationPayload) => {
    const body = await request<{ success?: boolean; data?: { location?: unknown } }>(
      "/api/v1/mtm/mobile/location",
      json(input),
    )
    const location = body.data?.location
    if (body.success !== true || !location || typeof location !== "object" || Array.isArray(location)) {
      throw new Error("Invalid mobile location response")
    }
    const value = location as Record<string, unknown>
    if (typeof value.id !== "string" || typeof value.latitude !== "number" || typeof value.longitude !== "number") {
      throw new Error("Invalid mobile location response")
    }
    return value
  },
  visitWorkspace: (id: string) =>
    request<unknown>(`/api/v1/mtm/mobile/visits/${encodeURIComponent(id)}/workspace`)
      .then(parseFieldVisitWorkspace),
  uploadVisitPhoto: async (input: FieldVisitPhotoPayload) => {
    const form = new FormData()
    form.append("file", new File(input.fileUri), `${input.clientPhotoId}.jpg`)
    form.append("clientPhotoId", input.clientPhotoId)
    form.append("agentId", input.agentId)
    form.append("visitId", input.visitId)
    if (input.category) form.append("category", input.category)
    if (input.latitude != null) form.append("latitude", String(input.latitude))
    if (input.longitude != null) form.append("longitude", String(input.longitude))
    const body = await request<{ success?: boolean; data?: unknown }>("/api/v1/mtm/photos", {
      method: "POST",
      body: form,
    })
    const photo = body.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? body.data as Record<string, unknown>
      : null
    if (body.success !== true || !photo || typeof photo.id !== "string" || typeof photo.url !== "string") {
      throw new Error("Invalid visit photo response")
    }
    return photo
  },
  markNotificationsRead: async (input: { ids?: string[]; all?: boolean; isRead: boolean }) => {
    await request("/api/v1/mtm/mobile/notifications", {
      ...json(input),
      method: "PATCH",
    })
  },
  createRoute: async (input: {
    agentId: string
    date: string
    name?: string | null
    notes?: string | null
    points: Array<{ customerId: string; contactId?: string | null; plannedTime: string | null }>
  }) => {
    const body = await request<{ success?: boolean; data?: { id?: unknown } }>("/api/v1/mtm/routes", json({
      agentId: input.agentId,
      assignments: [{ agentId: input.agentId, role: "PRIMARY" }],
      date: input.date,
      status: "DRAFT",
      name: input.name ?? null,
      notes: input.notes ?? null,
      points: input.points,
    }))
    if (body.success !== true || typeof body.data?.id !== "string") throw new Error("Invalid route create response")
    return { id: body.data.id }
  },
  updateRoute: async (routeId: string, input: {
    name?: string | null
    notes?: string | null
    points: Array<{ customerId: string; contactId?: string | null; plannedTime: string | null }>
  }) => {
    await request(`/api/v1/mtm/routes/${encodeURIComponent(routeId)}`, {
      ...json(input),
      method: "PUT",
    })
  },
  publishRoute: async (routeId: string) => {
    await request(`/api/v1/mtm/routes/${encodeURIComponent(routeId)}/publish`, json({}))
  },
  requestRouteChange: async (routeId: string, input: {
    changeType: "REMOVE_STOP" | "ADD_STOP" | "CONFLICT_OVERRIDE"
    routePointId?: string
    reason: string
    payload?: Record<string, unknown>
  }) => {
    await request(`/api/v1/mtm/routes/${encodeURIComponent(routeId)}/change-requests`, json(input))
  },
  organizations: (search = "") =>
    request<unknown>(`/api/v1/mtm/organizations?limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`)
      .then(parseFieldOrganizations),
  organization: (id: string) =>
    request<unknown>(`/api/v1/mtm/organizations/${encodeURIComponent(id)}`)
      .then(parseFieldOrganizationDetail),
  contacts: (search = "") =>
    request<unknown>(`/api/v1/mtm/contacts?limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`)
      .then(parseFieldContacts),
  contact: (id: string) =>
    request<unknown>(`/api/v1/mtm/contacts/${encodeURIComponent(id)}`)
      .then(parseFieldContactDetail),
  customerRequests: () =>
    request<unknown>("/api/v1/mtm/customer-create-requests?mine=1")
      .then(parseFieldCustomerRequests),
  createCustomerRequest: (input: CreateFieldCustomerRequest) =>
    request<unknown>("/api/v1/mtm/customer-create-requests", json(input))
      .then(parseFieldCustomerRequest),
} satisfies {
  profile(): Promise<FieldProfileData>
  week(start?: string): Promise<FieldWeekData>
  agentTasks(query?: string): Promise<FieldAgentTasksData>
  personalKpi(period: "week" | "month", anchor?: string): Promise<FieldPersonalKpiData>
  notifications(): Promise<FieldNotificationsData>
  workday(date?: string): Promise<FieldWorkdayData>
  locations(date?: string): Promise<FieldLocationHistoryData>
  uploadLocation(input: FieldLocationPayload): Promise<Record<string, unknown>>
  visitWorkspace(id: string): Promise<FieldVisitWorkspaceData>
  uploadVisitPhoto(input: FieldVisitPhotoPayload): Promise<Record<string, unknown>>
  markNotificationsRead(input: { ids?: string[]; all?: boolean; isRead: boolean }): Promise<void>
  createRoute(input: {
    agentId: string
    date: string
    name?: string | null
    notes?: string | null
    points: Array<{ customerId: string; contactId?: string | null; plannedTime: string | null }>
  }): Promise<{ id: string }>
  updateRoute(routeId: string, input: {
    name?: string | null
    notes?: string | null
    points: Array<{ customerId: string; contactId?: string | null; plannedTime: string | null }>
  }): Promise<void>
  publishRoute(routeId: string): Promise<void>
  requestRouteChange(routeId: string, input: {
    changeType: "REMOVE_STOP" | "ADD_STOP" | "CONFLICT_OVERRIDE"
    routePointId?: string
    reason: string
    payload?: Record<string, unknown>
  }): Promise<void>
  organizations(search?: string): Promise<FieldOrganizationListData>
  organization(id: string): Promise<FieldOrganizationDetailData>
  contacts(search?: string): Promise<FieldContactListData>
  contact(id: string): Promise<FieldContactDetailData>
  customerRequests(): Promise<FieldCustomerRequestsData>
  createCustomerRequest(input: CreateFieldCustomerRequest): Promise<FieldCustomerRequest>
}

export const syncApi: SyncApi = {
  pull: (cursors) =>
    request<PullResponse>(
      "/api/v1/mtm/mobile/shelf/sync/pull",
      json({ protocolVersion: PROTOCOL_VERSION, cursors }),
    ).then((body) => mobileSyncPullResponseSchema.parse(body)),
  push: async (operations: PushOperation[]) => {
    const results: PushResult[] = []
    const shelfOperations: PushOperation[] = []
    let fieldExecutionOperations: FieldExecutionPushOperation[] = []
    const flushFieldExecution = async () => {
      if (fieldExecutionOperations.length === 0) return
      const deviceId = await tokenStore.getDeviceId()
      results.push(...await sendFieldExecutionOperations(fieldExecutionOperations, {
        push: (fieldOperations: FieldServerOperation[]) => request<FieldServerPushResponse>(
          "/api/v1/mtm/mobile/sync/push",
          json({ clientId: deviceId ?? "unknown-device", operations: fieldOperations }),
        ),
      }))
      fieldExecutionOperations = []
    }

    // Preserve causal order around multipart evidence: queued check-in/action
    // batches flush before a photo; checkout queued after it cannot reach the
    // server until the required photo upload has succeeded.
    for (const operation of operations) {
      if (isFieldExecutionPushOperation(operation)) {
        fieldExecutionOperations.push(operation)
        continue
      }
      await flushFieldExecution()
      if (isFieldRoutePushOperation(operation)) {
        results.push(await sendFieldRouteOperation(operation, fieldApi))
      } else if (isFieldLocationPushOperation(operation)) {
        results.push(await sendFieldLocationOperation(operation, { upload: fieldApi.uploadLocation }))
      } else if (isFieldVisitPhotoPushOperation(operation)) {
        const result = await sendFieldVisitPhotoOperation(operation, { upload: fieldApi.uploadVisitPhoto })
        results.push(result)
        await FileSystem.deleteAsync(operation.payload.fileUri, { idempotent: true }).catch(() => {})
      } else {
        shelfOperations.push(operation)
      }
    }
    await flushFieldExecution()
    if (shelfOperations.length > 0) {
      const shelf = await request<{ results: PushResult[] }>(
        "/api/v1/mtm/mobile/shelf/sync/push",
        json({ protocolVersion: PROTOCOL_VERSION, operations: shelfOperations }),
      ).then((body) => mobileSyncPushResponseSchema.parse(body))
      results.push(...shelf.results)
    }
    const byId = new Map(results.map((result) => [result.clientOpId, result]))
    return { results: operations.flatMap((operation) => {
      const result = byId.get(operation.clientOpId)
      return result ? [result] : []
    }) }
  },
  ack: async (appliedCursors) => {
    await request(
      "/api/v1/mtm/mobile/shelf/sync/ack",
      json({ protocolVersion: PROTOCOL_VERSION, appliedCursors }),
    )
  },
  uploadPhoto: async (photo) => {
    const form = new FormData()
    const mediaType = photo.mediaType ?? "photo"
    const fileExtension = mediaType === "video" ? "mp4" : "jpg"
    // Expo 57 / RN 0.86 fetch принимает Blob/File. Старый RN-объект
    // { uri, name, type } теперь падает до запроса с
    // "Unsupported FormDataPart implementation".
    form.append("file", new File(photo.fileUri), `${photo.clientPhotoId}.${fileExtension}`)
    form.append("clientPhotoId", photo.clientPhotoId)
    form.append("taskId", photo.taskId)
    form.append("takenAt", photo.takenAt)
    form.append("mediaType", mediaType)
    if (photo.durationMs != null) form.append("durationMs", String(photo.durationMs))
    if (photo.captureStepJson) form.append("captureStepJson", photo.captureStepJson)
    if (photo.exifJson) form.append("exifJson", photo.exifJson)
    if (photo.captureFlagsJson) form.append("captureFlagsJson", photo.captureFlagsJson)
    if (photo.captureTelemetryJson) form.append("captureTelemetryJson", photo.captureTelemetryJson)
    return request("/api/v1/mtm/mobile/shelf/photos/upload", {
      method: "POST",
      body: form,
    }).then((body) => mobilePhotoUploadResponseSchema.parse(body))
  },
}
