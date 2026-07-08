import * as SecureStore from "expo-secure-store"

const KEYS = {
  access: "ls.access",
  refresh: "ls.refresh",
  deviceId: "ls.deviceId",
  userId: "ls.userId",
  orgSlug: "ls.orgSlug",
  userName: "ls.userName",
  locale: "ls.locale",
  lastEmployeeCode: "ls.lastEmployeeCode",
} as const

async function get(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key)
}
async function set(key: string, value: string | null): Promise<void> {
  if (value == null) await SecureStore.deleteItemAsync(key)
  else await SecureStore.setItemAsync(key, value)
}

export const tokenStore = {
  getAccess: () => get(KEYS.access),
  getRefresh: () => get(KEYS.refresh),
  getDeviceId: () => get(KEYS.deviceId),
  getUserId: () => get(KEYS.userId),
  getOrgSlug: () => get(KEYS.orgSlug),
  getUserName: () => get(KEYS.userName),
  getLocale: () => get(KEYS.locale),
  // Запоминаем код сотрудника для быстрого повторного входа (не секрет,
  // не чистится при выходе) — docs/28 «запомнить меня».
  getLastEmployeeCode: () => get(KEYS.lastEmployeeCode),
  setLastEmployeeCode: (v: string) => set(KEYS.lastEmployeeCode, v),
  async setTokens(access: string, refresh: string) {
    await set(KEYS.access, access)
    await set(KEYS.refresh, refresh)
  },
  setDeviceId: (v: string) => set(KEYS.deviceId, v),
  setUserId: (v: string | null) => set(KEYS.userId, v),
  setOrgSlug: (v: string) => set(KEYS.orgSlug, v),
  setUserName: (v: string) => set(KEYS.userName, v),
  setLocale: (v: string) => set(KEYS.locale, v),
  async clearSession() {
    await set(KEYS.access, null)
    await set(KEYS.refresh, null)
    await set(KEYS.userId, null)
    await set(KEYS.userName, null)
  },
}
