import * as SecureStore from "expo-secure-store"

const KEYS = {
  access: "field.access",
  legacyAccess: "ls.access",
  legacyRefresh: "ls.refresh",
  deviceId: "ls.deviceId",
  userId: "field.userId",
  orgSlug: "field.orgSlug",
  legacyOrgSlug: "ls.orgSlug",
  userName: "field.userName",
  locale: "ls.locale",
  lastEmail: "field.lastEmail",
} as const

const ONBOARDING_KEYS = {
  route: "ls.onboardedRoute",
  tasks: "ls.onboardedTasks",
  shelves: "ls.onboardedShelves",
  planograms: "ls.onboardedPlanograms",
  profile: "ls.onboardedProfile",
} as const

export type OnboardingSection = keyof typeof ONBOARDING_KEYS

async function get(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key)
}
async function set(key: string, value: string | null): Promise<void> {
  if (value == null) await SecureStore.deleteItemAsync(key)
  else await SecureStore.setItemAsync(key, value)
}

export const tokenStore = {
  getAccess: () => get(KEYS.access),
  getDeviceId: () => get(KEYS.deviceId),
  getUserId: () => get(KEYS.userId),
  getOrgSlug: async () => (await get(KEYS.orgSlug)) ?? get(KEYS.legacyOrgSlug),
  getUserName: () => get(KEYS.userName),
  getLocale: () => get(KEYS.locale),
  // Email не является секретом и сохраняется для быстрого повторного входа.
  getLastEmail: () => get(KEYS.lastEmail),
  setLastEmail: (v: string) => set(KEYS.lastEmail, v),
  // Контекстные подсказки показываются один раз на каждом основном разделе.
  getOnboarded: (section: OnboardingSection) => get(ONBOARDING_KEYS[section]),
  setOnboarded: (section: OnboardingSection) => set(ONBOARDING_KEYS[section], "1"),
  async setAccess(access: string) {
    await set(KEYS.access, access)
    // Старый LeadShelf refresh больше не является мобильной сессией.
    await set(KEYS.legacyAccess, null)
    await set(KEYS.legacyRefresh, null)
  },
  setDeviceId: (v: string) => set(KEYS.deviceId, v),
  setUserId: (v: string | null) => set(KEYS.userId, v),
  setOrgSlug: (v: string) => set(KEYS.orgSlug, v),
  setUserName: (v: string) => set(KEYS.userName, v),
  setLocale: (v: string) => set(KEYS.locale, v),
  async clearSession() {
    await set(KEYS.access, null)
    await set(KEYS.legacyAccess, null)
    await set(KEYS.legacyRefresh, null)
    await set(KEYS.userId, null)
    await set(KEYS.userName, null)
  },
}
