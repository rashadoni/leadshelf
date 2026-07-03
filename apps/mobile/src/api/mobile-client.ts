// Клиент замороженного mobile API (docs/18): bearer, protocolVersion=1,
// singleflight-refresh (гонка рефрешей ломает grace-ротацию), 426 -> upgrade.

import { UpgradeRequiredError } from "../sync/ports-error"
import type { PullResponse, PushOperation, PushResult, SyncApi } from "../sync/ports"
import {
  MOBILE_PROTOCOL_VERSION,
  mobileLoginResponseSchema,
  mobileSyncPullResponseSchema,
  mobileSyncPushResponseSchema,
  mobileTokenPairSchema,
} from "@leadshelf/api-contracts/mobile/v1"
import { tokenStore } from "../auth/token-store"

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://hermescrm.xyz"
export const PROTOCOL_VERSION = MOBILE_PROTOCOL_VERSION

export class AuthLostError extends Error {
  constructor() {
    super("session lost")
  }
}

let refreshInFlight: Promise<boolean> | null = null

async function refreshTokens(): Promise<boolean> {
  // singleflight: параллельные 401 ждут ОДИН рефреш
  refreshInFlight ??= (async () => {
    try {
      const refresh = await tokenStore.getRefresh()
      const deviceId = await tokenStore.getDeviceId()
      if (!refresh || !deviceId) return false
      const res = await fetch(`${API_URL}/api/v1/mobile/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, refreshToken: refresh, deviceId }),
      })
      if (!res.ok) return false
      const body = mobileTokenPairSchema.parse(await res.json())
      await tokenStore.setTokens(body.access, body.refresh)
      return true
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

async function request<T>(
  path: string,
  init: RequestInit & { retryOn401?: boolean } = {},
): Promise<T> {
  const { retryOn401 = true, ...rest } = init
  const access = await tokenStore.getAccess()
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      ...(rest.headers as Record<string, string>),
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
    throw new Error((body as { message?: string; error?: string }).message ?? `HTTP ${res.status}`)
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
  employeeCode: string
  pin: string
}): Promise<{ user: { name: string } } | null> {
  const deviceId = (await tokenStore.getDeviceId())!
  const res = await fetch(`${API_URL}/api/v1/mobile/auth/login`, {
    ...json({
      protocolVersion: PROTOCOL_VERSION,
      orgSlug: input.orgSlug,
      employeeCode: input.employeeCode,
      pin: input.pin,
      device: { id: deviceId, platform: "expo" },
    }),
  })
  if (res.status === 426) throw new UpgradeRequiredError()
  if (!res.ok) return null
  const body = mobileLoginResponseSchema.parse(await res.json())
  await tokenStore.setTokens(body.tokens.access, body.tokens.refresh)
  await tokenStore.setUserName(body.user.name)
  await tokenStore.setOrgSlug(input.orgSlug)
  return { user: body.user }
}

export const syncApi: SyncApi = {
  pull: (cursors) =>
    request<PullResponse>(
      "/api/v1/mobile/sync/pull",
      json({ protocolVersion: PROTOCOL_VERSION, cursors }),
    ).then((body) => mobileSyncPullResponseSchema.parse(body)),
  push: (operations: PushOperation[]) =>
    request<{ results: PushResult[] }>(
      "/api/v1/mobile/sync/push",
      json({ protocolVersion: PROTOCOL_VERSION, operations }),
    ).then((body) => mobileSyncPushResponseSchema.parse(body)),
  ack: async (appliedCursors) => {
    await request(
      "/api/v1/mobile/sync/ack",
      json({ protocolVersion: PROTOCOL_VERSION, appliedCursors }),
    )
  },
  uploadPhoto: async (photo) => {
    const form = new FormData()
    // RN FormData: файл как {uri, name, type}
    form.append("file", {
      uri: photo.fileUri,
      name: `${photo.clientPhotoId}.jpg`,
      type: "image/jpeg",
    } as unknown as Blob)
    form.append("clientPhotoId", photo.clientPhotoId)
    form.append("taskId", photo.taskId)
    form.append("takenAt", photo.takenAt)
    return request<{ photoId: string; key: string }>("/api/v1/mobile/photos/upload", {
      method: "POST",
      body: form,
    })
  },
}
