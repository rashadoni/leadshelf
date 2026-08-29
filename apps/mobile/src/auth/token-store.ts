import * as SecureStore from "expo-secure-store"

const KEYS = {
  access: "field.access",
  refresh: "field.refresh",
  legacyAccess: "ls.access",
  legacyRefresh: "ls.refresh",
  deviceId: "ls.deviceId",
  userId: "field.userId",
  orgSlug: "field.orgSlug",
  legacyOrgSlug: "ls.orgSlug",
  userName: "field.userName",
  locale: "ls.locale",
  lastEmail: "field.lastEmail",
  lastEmployeeCode: "field.lastEmployeeCode",
  legacyLastEmployeeCode: "ls.lastEmployeeCode",
  workforceAttendanceEnrollment: "field.workforceAttendanceEnrollment",
} as const

const ONBOARDING_KEYS = {
  route: "ls.onboardedRoute",
  tasks: "ls.onboardedTasks",
  shelves: "ls.onboardedShelves",
  planograms: "ls.onboardedPlanograms",
  profile: "ls.onboardedProfile",
} as const

export type OnboardingSection = keyof typeof ONBOARDING_KEYS

/**
 * This is only a local pointer to a non-exportable Android Keystore key.
 * It deliberately contains no QR, enrollment challenge, biometric result,
 * signature, PIN or private-key material.
 */
type WorkforceAttendanceEnrollmentPointerBase = {
  organizationId: string
  agentId: string
  keyAlias: string
  biometricBound: boolean
}

/**
 * A STARTING/PROVING pointer lets the client resume an interrupted enrollment
 * without retaining the public key, one-time challenge, signature or QR. Only
 * ACTIVE may sign workdays; all other lifecycle states remain server-online.
 */
export type WorkforceAttendanceEnrollmentPointer =
  | (WorkforceAttendanceEnrollmentPointerBase & {
    status: "STARTING"
    /** The active server enrollment that this new key will replace, if any. */
    replacesEnrollmentId?: string
  })
  | (WorkforceAttendanceEnrollmentPointerBase & {
    enrollmentId: string
    status: "PROVING" | "PENDING" | "ACTIVE"
  })

function attendanceEnrollmentPointer(value: unknown): WorkforceAttendanceEnrollmentPointer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const identifier = (key: string, max = 120) => (
    typeof record[key] === "string" && /^[A-Za-z0-9._-]+$/.test(record[key]) && record[key].length <= max
  )
  if (!identifier("organizationId") ||
    !identifier("agentId") ||
    !identifier("keyAlias") ||
    typeof record.biometricBound !== "boolean") return null

  const base = {
    organizationId: record.organizationId,
    agentId: record.agentId,
    keyAlias: record.keyAlias,
    biometricBound: record.biometricBound,
  }
  if (record.status === "STARTING") {
    if (record.replacesEnrollmentId != null && !identifier("replacesEnrollmentId")) return null
    return {
      ...base,
      status: "STARTING",
      ...(typeof record.replacesEnrollmentId === "string"
        ? { replacesEnrollmentId: record.replacesEnrollmentId }
        : {}),
    }
  }
  if (!identifier("enrollmentId") ||
    (record.status !== "PROVING" && record.status !== "PENDING" && record.status !== "ACTIVE")) return null
  return {
    ...base,
    enrollmentId: record.enrollmentId,
    status: record.status,
  }
}

async function get(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key)
}
async function set(key: string, value: string | null): Promise<void> {
  if (value == null) await SecureStore.deleteItemAsync(key)
  else await SecureStore.setItemAsync(key, value)
}

export const tokenStore = {
  getAccess: () => get(KEYS.access),
  getRefresh: async () => (await get(KEYS.refresh)) ?? get(KEYS.legacyRefresh),
  getDeviceId: () => get(KEYS.deviceId),
  getUserId: () => get(KEYS.userId),
  getOrgSlug: async () => (await get(KEYS.orgSlug)) ?? get(KEYS.legacyOrgSlug),
  getUserName: () => get(KEYS.userName),
  getLocale: () => get(KEYS.locale),
  // Email не является секретом и сохраняется для быстрого повторного входа.
  getLastEmail: () => get(KEYS.lastEmail),
  setLastEmail: (v: string) => set(KEYS.lastEmail, v),
  getLastEmployeeCode: async () =>
    (await get(KEYS.lastEmployeeCode)) ?? get(KEYS.legacyLastEmployeeCode),
  setLastEmployeeCode: (v: string) => set(KEYS.lastEmployeeCode, v),
  // Контекстные подсказки показываются один раз на каждом основном разделе.
  getOnboarded: (section: OnboardingSection) => get(ONBOARDING_KEYS[section]),
  setOnboarded: (section: OnboardingSection) => set(ONBOARDING_KEYS[section], "1"),
  async setAccess(access: string) {
    await set(KEYS.access, access)
    // Старый LeadShelf refresh больше не является мобильной сессией.
    await set(KEYS.legacyAccess, null)
    await set(KEYS.legacyRefresh, null)
  },
  async setTokens(access: string, refresh: string) {
    await Promise.all([
      set(KEYS.access, access),
      set(KEYS.refresh, refresh),
      set(KEYS.legacyAccess, null),
      set(KEYS.legacyRefresh, null),
    ])
  },
  setDeviceId: (v: string) => set(KEYS.deviceId, v),
  setUserId: (v: string | null) => set(KEYS.userId, v),
  setOrgSlug: (v: string) => set(KEYS.orgSlug, v),
  setUserName: (v: string) => set(KEYS.userName, v),
  setLocale: (v: string) => set(KEYS.locale, v),
  async getWorkforceAttendanceEnrollment(input: { organizationId: string; agentId: string }) {
    const raw = await get(KEYS.workforceAttendanceEnrollment)
    if (!raw) return null
    try {
      const pointer = attendanceEnrollmentPointer(JSON.parse(raw))
      return pointer?.organizationId === input.organizationId && pointer.agentId === input.agentId
        ? pointer
        : null
    } catch {
      return null
    }
  },
  async setWorkforceAttendanceEnrollment(pointer: WorkforceAttendanceEnrollmentPointer | null) {
    if (!pointer) {
      await set(KEYS.workforceAttendanceEnrollment, null)
      return
    }
    const safe = attendanceEnrollmentPointer(pointer)
    if (!safe) throw new Error("Invalid workforce attendance enrollment pointer")
    await set(KEYS.workforceAttendanceEnrollment, JSON.stringify(safe))
  },
  async clearSession() {
    await set(KEYS.access, null)
    await set(KEYS.refresh, null)
    await set(KEYS.legacyAccess, null)
    await set(KEYS.legacyRefresh, null)
    await set(KEYS.userId, null)
    await set(KEYS.userName, null)
  },
}
