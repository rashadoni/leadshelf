// One native client, two server-authoritative variants. LeadShelf authenticates
// directly; LeadDrive Field authenticates once against MTM and reaches shelf
// execution only through the LeadDrive Field BFF.

import { AuthLostError, HttpError, UpgradeRequiredError } from "../sync/ports-error"
import type { PullResponse, PushOperation, PushResult, SyncApi } from "../sync/ports"
import {
  MOBILE_PROTOCOL_VERSION,
  mobileCommercialMediaUploadResponseSchema,
  mobileLoginResponseSchema,
  mobilePhotoUploadResponseSchema,
  mobileSyncPullResponseSchema,
  mobileSyncPushResponseSchema,
  mobileTokenPairSchema,
} from "@leadshelf/api-contracts/mobile/v1"
import { File } from "expo-file-system"
import { fetch } from "expo/fetch"
import * as FileSystem from "expo-file-system/legacy"
import { Platform } from "react-native"
import {
  IS_LEADDRIVE_FIELD,
  mobileVariant,
  shelfBffPath,
} from "../config/mobile-variant"
import {
  FIELD_DOCUMENT_MEDIA_DIR,
  persistEncryptedMedia,
  withDecryptedMedia,
  withTemporaryPlaintextMedia,
} from "../media/encrypted-media-store"
import { tokenStore } from "../auth/token-store"
import { prepareMobileSessionScope } from "../db/local-store"
import { isFieldRoutePushOperation, sendFieldRouteOperation } from "../field/route-outbox"
import {
  isFieldNotificationReadPushOperation,
  sendFieldNotificationReadOperation,
} from "../field/notification-read-outbox"
import {
  isFieldExecutionPushOperation,
  isFieldDocumentUploadPushOperation,
  isFieldLocationPushOperation,
  isFieldVisitPhotoPushOperation,
  sendFieldExecutionOperations,
  sendFieldDocumentUploadOperation,
  sendFieldLocationOperation,
  sendFieldVisitPhotoOperation,
  type FieldExecutionPushOperation,
  type FieldDocumentUploadPayload,
  type FieldLocationPayload,
  type FieldServerOperation,
  type FieldServerPushResponse,
  type FieldVisitPhotoPayload,
} from "../field/execution-outbox"
import {
  parseFieldProfile,
  parseFieldCommitments,
  parseFieldAgentTasks,
  parseFieldPersonalKpi,
  parseFieldNotifications,
  parseFieldMessages,
  parseFieldMessageThread,
  parseFieldDocuments,
  parseFieldHrm,
  parseFieldLocationHistory,
  parseFieldContactChangeRequest,
  parseFieldContactChangeRequests,
  parseFieldContactDetail,
  parseFieldContacts,
  parseFieldCustomerRequest,
  parseFieldCustomerRequests,
  parseFieldOrganizationDetail,
  parseFieldOrganizations,
  parseFieldManagerApprovals,
  parseFieldManagerLocations,
  parseFieldManagerPlanning,
  parseFieldManagerTeam,
  parseFieldWeek,
  parseFieldWorkday,
  parseFieldVisitWorkspace,
  type CreateFieldCustomerRequest,
  type CreateFieldContactChangeRequest,
  type FieldContactChangeRequest,
  type FieldContactChangeRequestsData,
  type FieldContactDetailData,
  type FieldContactListData,
  type FieldCustomerRequest,
  type FieldCustomerRequestsData,
  type FieldProfileData,
  type FieldCommitmentsData,
  type FieldAgentTasksData,
  type FieldPersonalKpiData,
  type FieldNotificationsData,
  type FieldMessagesData,
  type FieldMessageThreadData,
  type FieldDocumentsData,
  type FieldHrmData,
  type FieldLocationHistoryData,
  type FieldManagerApprovalsData,
  type FieldManagerApprovalDecisionInput,
  type FieldManagerLocationsData,
  type FieldManagerPlanningData,
  type FieldManagerTeamData,
  type FieldOrganizationDetailData,
  type FieldOrganizationListData,
  type FieldWeekData,
  type FieldWorkdayData,
  type FieldVisitWorkspaceData,
} from "../field/contracts"

export const API_URL = mobileVariant.apiUrl
export const PROTOCOL_VERSION = MOBILE_PROTOCOL_VERSION

function workdayPath(date?: string): string {
  const base = IS_LEADDRIVE_FIELD
    ? "/api/v1/mtm/mobile/workday"
    : "/api/v1/mobile/workday"
  return `${base}${date ? `?date=${encodeURIComponent(date)}` : ""}`
}

function locationsPath(date?: string): string {
  const base = IS_LEADDRIVE_FIELD
    ? "/api/v1/mtm/mobile/location"
    : "/api/v1/mobile/locations"
  return `${base}${date ? `?date=${encodeURIComponent(date)}` : ""}`
}

export { AuthLostError } from "../sync/ports-error"

let refreshInFlight: Promise<boolean> | null = null

async function refreshTokens(): Promise<boolean> {
  if (IS_LEADDRIVE_FIELD) return false
  refreshInFlight ??= (async () => {
    try {
      const [refreshToken, deviceId] = await Promise.all([
        tokenStore.getRefresh(),
        tokenStore.getDeviceId(),
      ])
      if (!refreshToken || !deviceId) return false
      const res = await fetch(`${API_URL}/api/v1/mobile/auth/refresh`, {
        ...json({
          protocolVersion: PROTOCOL_VERSION,
          refreshToken,
          deviceId,
        }),
      })
      if (!res.ok) return false
      const tokens = mobileTokenPairSchema.parse(await res.json())
      await tokenStore.setTokens(tokens.access, tokens.refresh)
      return true
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

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
  init: RequestInit & { retryOn401?: boolean } = {},
): Promise<T> {
  const { retryOn401 = true, ...rest } = init
  const [access, deviceId] = await Promise.all([
    tokenStore.getAccess(),
    tokenStore.getDeviceId(),
  ])
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      ...(rest.headers as Record<string, string>),
      // Протокол на не-JSON путях (multipart upload, media) едет заголовком.
      "x-leadshelf-protocol": String(PROTOCOL_VERSION),
      ...(deviceId ? { "x-field-device-id": deviceId } : {}),
      "x-field-device-platform": Platform.OS,
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
    },
  })
  if (res.status === 426) throw new UpgradeRequiredError()
  if (res.status === 401 && retryOn401) {
    if (await refreshTokens()) return request<T>(path, { ...init, retryOn401: false })
    throw new AuthLostError()
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const message = (body as { message?: string; error?: string }).message ??
      (body as { error?: string }).error
    throw new HttpError(res.status, message, body)
  }
  return (await res.json()) as T
}

async function uploadMultipartFile<T>(
  path: string,
  fileUri: string,
  mimeType: string,
  parameters: Record<string, string>,
  retryOn401 = true,
): Promise<T> {
  const [access, deviceId] = await Promise.all([
    tokenStore.getAccess(),
    tokenStore.getDeviceId(),
  ])
  const response = await FileSystem.uploadAsync(`${API_URL}${path}`, fileUri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "file",
    mimeType,
    parameters,
    headers: {
      "x-leadshelf-protocol": String(PROTOCOL_VERSION),
      ...(deviceId ? { "x-field-device-id": deviceId } : {}),
      "x-field-device-platform": Platform.OS,
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
    },
  })
  if (response.status === 426) throw new UpgradeRequiredError()
  if (response.status === 401 && retryOn401) {
    if (await refreshTokens()) {
      return uploadMultipartFile<T>(path, fileUri, mimeType, parameters, false)
    }
    throw new AuthLostError()
  }
  let body: unknown = {}
  try {
    body = JSON.parse(response.body)
  } catch {
    body = {}
  }
  if (response.status < 200 || response.status >= 300) {
    const message = (body as { message?: string; error?: string }).message ??
      (body as { error?: string }).error
    throw new HttpError(response.status, message, body)
  }
  return body as T
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

type LeadShelfLoginInput = {
  orgSlug: string
  employeeCode: string
  pin: string
}

type LeadDriveFieldLoginInput = {
  orgSlug: string
  email: string
  password: string
}

export async function mobileLogin(
  input: LeadShelfLoginInput | LeadDriveFieldLoginInput,
): Promise<{ user: { id?: string; name: string } } | null> {
  const deviceId = await tokenStore.getDeviceId()
  if (!deviceId) throw new Error("Mobile device id is unavailable")
  if (IS_LEADDRIVE_FIELD) {
    if (!("email" in input)) throw new Error("LeadDrive Field credentials are required")
    const res = await fetch(`${API_URL}/api/v1/mtm/mobile/auth`, {
      ...json({
        email: input.email.trim().toLowerCase(),
        password: input.password,
        organizationSlug: input.orgSlug.trim().toLowerCase(),
      }),
    })
    if (res.status === 401) return null
    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new HttpError(res.status, (error as { error?: string }).error, error)
    }
    const body = await res.json() as {
      success?: boolean
      data?: { token?: unknown; agent?: { id?: unknown; name?: unknown } }
    }
    const token = body.data?.token
    const agent = body.data?.agent
    if (body.success !== true || typeof token !== "string" || typeof agent?.id !== "string" || typeof agent.name !== "string") {
      throw new Error("Invalid LeadDrive mobile auth response")
    }
    const scope = prepareMobileSessionScope(input.orgSlug, agent.id)
    if (!scope.ok) throw new AccountSwitchBlockedError(scope.pendingOps, scope.pendingPhotos)
    await tokenStore.setAccess(token)
    await tokenStore.setUserId(agent.id)
    await tokenStore.setUserName(agent.name)
    await tokenStore.setOrgSlug(input.orgSlug)
    await tokenStore.setLastEmail(input.email.trim().toLowerCase())
    return { user: { id: agent.id, name: agent.name } }
  }
  if (!("employeeCode" in input)) throw new Error("LeadShelf credentials are required")
  const res = await fetch(`${API_URL}/api/v1/mobile/auth/login`, {
    ...json({
      protocolVersion: PROTOCOL_VERSION,
      orgSlug: input.orgSlug,
      employeeCode: input.employeeCode,
      pin: input.pin,
      device: {
        id: deviceId,
        platform: Platform.OS,
      },
    }),
  })
  if (res.status === 426) throw new UpgradeRequiredError()
  if (res.status === 401) return null
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new HttpError(res.status, (error as { error?: string }).error, error)
  }
  const body = mobileLoginResponseSchema.parse(await res.json())
  const scope = prepareMobileSessionScope(input.orgSlug, body.user.id ?? input.employeeCode)
  if (!scope.ok) throw new AccountSwitchBlockedError(scope.pendingOps, scope.pendingPhotos)
  await tokenStore.setTokens(body.tokens.access, body.tokens.refresh)
  await tokenStore.setUserId(body.user.id ?? null)
  await tokenStore.setUserName(body.user.name)
  await tokenStore.setOrgSlug(input.orgSlug)
  await tokenStore.setLastEmployeeCode(input.employeeCode)
  return { user: body.user }
}

export async function mobileLogout(): Promise<void> {
  if (IS_LEADDRIVE_FIELD) return
  const refreshToken = await tokenStore.getRefresh()
  await fetch(`${API_URL}/api/v1/mobile/auth/logout`, {
    ...json({ protocolVersion: PROTOCOL_VERSION, refreshToken: refreshToken ?? undefined }),
  }).catch(() => {})
}

export const fieldApi = {
  heartbeat: async () => {
    const body = await request<{ success?: boolean }>("/api/v1/mtm/mobile/ping", json({}))
    if (body.success !== true) throw new Error("Invalid mobile heartbeat response")
  },
  profile: () => request<unknown>("/api/v1/mtm/mobile/profile").then(parseFieldProfile),
  week: (start?: string) =>
    request<unknown>(`/api/v1/mtm/mobile/week${start ? `?start=${encodeURIComponent(start)}` : ""}`)
      .then(parseFieldWeek),
  agentTasks: (query = "") =>
    request<unknown>(`/api/v1/mtm/mobile/tasks${query ? `?${query}` : ""}`)
      .then(parseFieldAgentTasks),
  commitments: (scope: "open" | "all" = "all") =>
    request<unknown>(`/api/v1/mtm/mobile/commitments?scope=${scope}`)
      .then(parseFieldCommitments),
  personalKpi: (period: "week" | "month", anchor?: string) => {
    const query = new URLSearchParams({ period })
    if (anchor) query.set("anchor", anchor)
    return request<unknown>(`/api/v1/mtm/mobile/kpi?${query.toString()}`)
      .then(parseFieldPersonalKpi)
  },
  notifications: () =>
    request<unknown>("/api/v1/mtm/mobile/notifications").then(parseFieldNotifications),
  messages: () =>
    request<unknown>("/api/v1/mtm/mobile/messages").then(parseFieldMessages),
  messageThread: (threadId: string) =>
    request<unknown>(`/api/v1/mtm/mobile/messages/${encodeURIComponent(threadId)}`)
      .then(parseFieldMessageThread),
  documents: (scope: "active" | "all" = "active") =>
    request<unknown>(`/api/v1/mtm/mobile/documents${scope === "all" ? "?scope=all" : ""}`)
      .then(parseFieldDocuments),
  hrm: (start?: string, end?: string) => {
    const query = new URLSearchParams()
    if (start) query.set("start", start)
    if (end) query.set("end", end)
    const suffix = query.size > 0 ? `?${query.toString()}` : ""
    return request<unknown>(`/api/v1/mtm/mobile/hrm${suffix}`).then(parseFieldHrm)
  },
  workday: (date?: string) =>
    request<unknown>(workdayPath(date))
      .then(parseFieldWorkday),
  locations: (date?: string) =>
    request<unknown>(locationsPath(date))
      .then(parseFieldLocationHistory),
  managerTeam: () =>
    request<unknown>("/api/v1/mtm/mobile/manager/team").then(parseFieldManagerTeam),
  managerLocations: () =>
    request<unknown>("/api/v1/mtm/mobile/manager/locations?limit=200").then(parseFieldManagerLocations),
  managerPlanning: (from: string, to?: string) =>
    request<unknown>(
      to
        ? `/api/v1/mtm/mobile/manager/planning?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        : "/api/v1/mtm/mobile/manager/planning?date=" + encodeURIComponent(from),
    )
      .then(parseFieldManagerPlanning),
  managerApprovals: () =>
    request<unknown>("/api/v1/mtm/mobile/manager/approvals").then(parseFieldManagerApprovals),
  managerApprovalDecision: async (input: FieldManagerApprovalDecisionInput) => {
    await request<unknown>("/api/v1/mtm/mobile/manager/approvals", json(input))
  },
  uploadLocation: async (input: FieldLocationPayload) => {
    const body = await request<{ success?: boolean; data?: { location?: unknown } }>(
      locationsPath(),
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
    return withDecryptedMedia(input.fileUri, async (temporaryUri) => {
      const form = new FormData()
      form.append("file", new File(temporaryUri), `${input.clientPhotoId}.jpg`)
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
    })
  },
  uploadDocument: async (input: FieldDocumentUploadPayload) => {
    return withDecryptedMedia(input.fileUri, async (temporaryUri) => {
      const form = new FormData()
      form.append("file", new File(temporaryUri), input.fileName)
      form.append("clientDocumentId", input.clientDocumentId)
      if (input.title) form.append("title", input.title)
      if (input.visitId) form.append("visitId", input.visitId)
      if (input.taskId) form.append("taskId", input.taskId)
      const body = await request<{ success?: boolean; data?: unknown }>(
        "/api/v1/mtm/mobile/documents/upload",
        { method: "POST", body: form },
      )
      const document = body.data && typeof body.data === "object" && !Array.isArray(body.data)
        ? body.data as Record<string, unknown>
        : null
      if (body.success !== true || !document || typeof document.id !== "string") {
        throw new Error("Invalid mobile document upload response")
      }
      return document
    })
  },
  downloadDocument: async (input: { documentId: string; fileName: string; downloadUrl?: string }) => {
    const [access, deviceId, organizationSlug, agentId] = await Promise.all([
      tokenStore.getAccess(),
      tokenStore.getDeviceId(),
      tokenStore.getOrgSlug(),
      tokenStore.getUserId(),
    ])
    const safeName = input.fileName.replace(/[^A-Za-z0-9._ -]+/g, "_").slice(0, 180) || "document"
    const scope = `${organizationSlug ?? "unknown"}-${agentId ?? "unknown"}`.replace(/[^A-Za-z0-9._-]+/g, "_")
    const directory = `${FIELD_DOCUMENT_MEDIA_DIR}${scope}/`
    if (!FileSystem.documentDirectory) throw new Error("Device document storage is unavailable")
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
    const destination = `${directory}${input.documentId}-${safeName}`
    const extension = safeName.split(".").at(-1) ?? "bin"
    return withTemporaryPlaintextMedia(extension, async (temporaryUri) => {
      const result = await FileSystem.downloadAsync(
        `${API_URL}${input.downloadUrl ?? `/api/v1/mtm/mobile/documents/${encodeURIComponent(input.documentId)}/download`}`,
        temporaryUri,
        {
          headers: {
            "x-leadshelf-protocol": String(PROTOCOL_VERSION),
            ...(deviceId ? { "x-field-device-id": deviceId } : {}),
            "x-field-device-platform": Platform.OS,
            ...(access ? { Authorization: `Bearer ${access}` } : {}),
          },
        },
      )
      if (result.status === 401) throw new AuthLostError()
      if (result.status < 200 || result.status >= 300) {
        throw new HttpError(result.status, "Document download failed")
      }
      await persistEncryptedMedia(result.uri, destination, { deletePlaintextSource: true })
      return destination
    })
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
  organizations: (search = "", page = 1, limit = 50) =>
    request<unknown>(`/api/v1/mtm/organizations?limit=${encodeURIComponent(String(limit))}&page=${encodeURIComponent(String(page))}${search ? `&search=${encodeURIComponent(search)}` : ""}`)
      .then(parseFieldOrganizations),
  organization: (id: string) =>
    request<unknown>(`/api/v1/mtm/organizations/${encodeURIComponent(id)}`)
      .then(parseFieldOrganizationDetail),
  contacts: (search = "", page = 1, limit = 50) =>
    request<unknown>(`/api/v1/mtm/contacts?limit=${encodeURIComponent(String(limit))}&page=${encodeURIComponent(String(page))}${search ? `&search=${encodeURIComponent(search)}` : ""}`)
      .then(parseFieldContacts),
  contact: (id: string) =>
    request<unknown>(`/api/v1/mtm/contacts/${encodeURIComponent(id)}`)
      .then(parseFieldContactDetail),
  contactChangeRequests: (id: string) =>
    request<unknown>(`/api/v1/mtm/contacts/${encodeURIComponent(id)}/change-requests`)
      .then(parseFieldContactChangeRequests),
  createContactChangeRequest: (id: string, input: CreateFieldContactChangeRequest) =>
    request<unknown>(`/api/v1/mtm/contacts/${encodeURIComponent(id)}/change-requests`, json(input))
      .then(parseFieldContactChangeRequest),
  customerRequests: () =>
    request<unknown>("/api/v1/mtm/customer-create-requests?mine=1")
      .then(parseFieldCustomerRequests),
  createCustomerRequest: (input: CreateFieldCustomerRequest) =>
    request<unknown>("/api/v1/mtm/customer-create-requests", json(input))
      .then(parseFieldCustomerRequest),
} satisfies {
  heartbeat(): Promise<void>
  profile(): Promise<FieldProfileData>
  week(start?: string): Promise<FieldWeekData>
  agentTasks(query?: string): Promise<FieldAgentTasksData>
  commitments(scope?: "open" | "all"): Promise<FieldCommitmentsData>
  personalKpi(period: "week" | "month", anchor?: string): Promise<FieldPersonalKpiData>
  notifications(): Promise<FieldNotificationsData>
  messages(): Promise<FieldMessagesData>
  messageThread(threadId: string): Promise<FieldMessageThreadData>
  documents(scope?: "active" | "all"): Promise<FieldDocumentsData>
  hrm(start?: string, end?: string): Promise<FieldHrmData>
  workday(date?: string): Promise<FieldWorkdayData>
  locations(date?: string): Promise<FieldLocationHistoryData>
  managerTeam(): Promise<FieldManagerTeamData>
  managerLocations(): Promise<FieldManagerLocationsData>
  managerPlanning(from: string, to?: string): Promise<FieldManagerPlanningData>
  managerApprovals(): Promise<FieldManagerApprovalsData>
  managerApprovalDecision(input: FieldManagerApprovalDecisionInput): Promise<void>
  uploadLocation(input: FieldLocationPayload): Promise<Record<string, unknown>>
  visitWorkspace(id: string): Promise<FieldVisitWorkspaceData>
  uploadVisitPhoto(input: FieldVisitPhotoPayload): Promise<Record<string, unknown>>
  uploadDocument(input: FieldDocumentUploadPayload): Promise<Record<string, unknown>>
  downloadDocument(input: { documentId: string; fileName: string; downloadUrl?: string }): Promise<string>
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
  organizations(search?: string, page?: number, limit?: number): Promise<FieldOrganizationListData>
  organization(id: string): Promise<FieldOrganizationDetailData>
  contacts(search?: string, page?: number, limit?: number): Promise<FieldContactListData>
  contact(id: string): Promise<FieldContactDetailData>
  contactChangeRequests(id: string): Promise<FieldContactChangeRequestsData>
  createContactChangeRequest(id: string, input: CreateFieldContactChangeRequest): Promise<FieldContactChangeRequest>
  customerRequests(): Promise<FieldCustomerRequestsData>
  createCustomerRequest(input: CreateFieldCustomerRequest): Promise<FieldCustomerRequest>
}

export const syncApi: SyncApi = {
  pull: (cursors) =>
    request<PullResponse>(
      shelfBffPath("pull"),
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
      if (!IS_LEADDRIVE_FIELD && operation.kind === "field.workday.event") {
        await flushFieldExecution()
        shelfOperations.push({
          clientOpId: operation.clientOpId,
          clientCreatedAt: operation.clientCreatedAt,
          kind: "workday.event",
          payload: operation.payload,
        } as PushOperation)
        continue
      }
      if (isFieldExecutionPushOperation(operation)) {
        fieldExecutionOperations.push(operation)
        continue
      }
      await flushFieldExecution()
      if (isFieldRoutePushOperation(operation)) {
        results.push(await sendFieldRouteOperation(operation, fieldApi))
      } else if (isFieldNotificationReadPushOperation(operation)) {
        results.push(await sendFieldNotificationReadOperation(operation, {
          markNotificationRead: (notificationId) => fieldApi.markNotificationsRead({
            ids: [notificationId],
            isRead: true,
          }),
        }))
      } else if (isFieldLocationPushOperation(operation)) {
        results.push(await sendFieldLocationOperation(operation, { upload: fieldApi.uploadLocation }))
      } else if (isFieldVisitPhotoPushOperation(operation)) {
        const result = await sendFieldVisitPhotoOperation(operation, { upload: fieldApi.uploadVisitPhoto })
        results.push(result)
        // Keep failed evidence on-device so the recovery center can retry it
        // or explicitly detach it from the still-unapplied business event.
        if (result.status === "applied") {
          await FileSystem.deleteAsync(operation.payload.fileUri, { idempotent: true }).catch(() => {})
        }
      } else if (isFieldDocumentUploadPushOperation(operation)) {
        const result = await sendFieldDocumentUploadOperation(operation, { upload: fieldApi.uploadDocument })
        results.push(result)
        // The following message may reference this clientDocumentId. Leave all
        // later operations pending until the private upload is actually present.
        if (result.status !== "applied") {
          const byId = new Map(results.map((item) => [item.clientOpId, item]))
          return { results: operations.flatMap((item) => {
            const applied = byId.get(item.clientOpId)
            return applied ? [applied] : []
          }) }
        }
      } else {
        shelfOperations.push(operation)
      }
    }
    await flushFieldExecution()
    if (shelfOperations.length > 0) {
      const shelf = await request<{ results: PushResult[] }>(
        shelfBffPath("push"),
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
      shelfBffPath("ack"),
      json({ protocolVersion: PROTOCOL_VERSION, appliedCursors }),
    )
  },
  uploadPhoto: async (photo) => {
    const mediaType = photo.mediaType ?? "photo"
    const mimeType = mediaType === "video" ? "video/mp4" : "image/jpeg"
    // Native multipart reads the file:// URI directly. This avoids the
    // Android FormData/Blob bridge, which can leave valid offline photos
    // permanently queued even though JSON sync still works.
    return withDecryptedMedia(photo.fileUri, async (temporaryUri) => {
      const body = await uploadMultipartFile(
        shelfBffPath("photos"),
        temporaryUri,
        mimeType,
        {
          clientPhotoId: photo.clientPhotoId,
          taskId: photo.taskId,
          takenAt: photo.takenAt,
          mediaType,
          ...(photo.durationMs != null ? { durationMs: String(photo.durationMs) } : {}),
          ...(photo.captureStepJson ? { captureStepJson: photo.captureStepJson } : {}),
          ...(photo.exifJson ? { exifJson: photo.exifJson } : {}),
          ...(photo.captureFlagsJson ? { captureFlagsJson: photo.captureFlagsJson } : {}),
          ...(photo.captureTelemetryJson ? { captureTelemetryJson: photo.captureTelemetryJson } : {}),
        },
      )
      return mobilePhotoUploadResponseSchema.parse(body)
    })
  },
  uploadCommercialMedia: async (media) => {
    return withDecryptedMedia(media.fileUri, async (temporaryUri) => {
      const body = await uploadMultipartFile(
        shelfBffPath("commercialMedia"),
        temporaryUri,
        "image/jpeg",
        {
          clientMediaId: media.clientMediaId,
          purpose: media.purpose,
          takenAt: media.takenAt,
        },
      )
      return mobileCommercialMediaUploadResponseSchema.parse(body)
    })
  },
  cleanupCommercialMedia: async (media) => {
    await FileSystem.deleteAsync(media.fileUri, { idempotent: true }).catch(() => {})
  },
}
