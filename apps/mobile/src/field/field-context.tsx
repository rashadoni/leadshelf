import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { router } from "expo-router"
import { fieldApi } from "../api/mobile-client"
import { tokenStore } from "../auth/token-store"
import { readFieldCache, writeFieldCache } from "../db/local-store"
import { AuthLostError } from "../sync/ports-error"
import type { FieldNotificationsData, FieldProfileData, FieldWeekData } from "./contracts"

type FieldPhase = "loading" | "ready" | "refreshing" | "stale" | "error"

type FieldContextValue = {
  profile: FieldProfileData | null
  week: FieldWeekData | null
  notifications: FieldNotificationsData
  phase: FieldPhase
  error: string | null
  lastUpdatedAt: string | null
  refresh: () => Promise<void>
  loadWeek: (start: string) => Promise<void>
  applyLocalWeek: (week: FieldWeekData) => void
  markAllNotificationsRead: () => Promise<void>
}

const PROFILE_KEY = "field.profile"
const CURRENT_WEEK_KEY = "field.week.current"
const NOTIFICATIONS_KEY = "field.notifications"
const Ctx = createContext<FieldContextValue | null>(null)

function weekKey(start: string): string {
  return `field.week.${start}`
}

export function FieldProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<FieldProfileData | null>(null)
  const [week, setWeek] = useState<FieldWeekData | null>(null)
  const [notifications, setNotifications] = useState<FieldNotificationsData>({ items: [], unread: 0 })
  const [phase, setPhase] = useState<FieldPhase>("loading")
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const requestedWeek = useRef<string | null>(null)
  const requestSequence = useRef(0)

  const loseSession = useCallback(async () => {
    await tokenStore.clearSession()
    router.replace("/(auth)/login" as never)
  }, [])

  const loadWeek = useCallback(async (start: string) => {
    requestedWeek.current = start
    const sequence = ++requestSequence.current
    const cached = readFieldCache<FieldWeekData>(weekKey(start))
    if (cached) {
      setWeek(cached.value)
      setLastUpdatedAt(cached.updatedAt)
      setPhase("refreshing")
    } else {
      setPhase("loading")
    }
    setError(null)
    try {
      const next = await fieldApi.week(start)
      if (sequence !== requestSequence.current) return
      writeFieldCache(weekKey(next.weekStart), next)
      writeFieldCache(CURRENT_WEEK_KEY, next)
      setWeek(next)
      setLastUpdatedAt(new Date().toISOString())
      setPhase("ready")
    } catch (reason) {
      if (sequence !== requestSequence.current) return
      if (reason instanceof AuthLostError) {
        await loseSession()
        return
      }
      setError(reason instanceof Error ? reason.message : String(reason))
      setPhase(cached ? "stale" : "error")
    }
  }, [loseSession])

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current
    setPhase((current) => current === "loading" ? "loading" : "refreshing")
    setError(null)
    const start = requestedWeek.current ?? undefined
    const [profileResult, weekResult, notificationsResult] = await Promise.allSettled([
      fieldApi.profile(),
      fieldApi.week(start),
      fieldApi.notifications(),
    ])
    if (sequence !== requestSequence.current) return

    const authLost = [profileResult, weekResult, notificationsResult].some(
      (result) => result.status === "rejected" && result.reason instanceof AuthLostError,
    )
    if (authLost) {
      await loseSession()
      return
    }

    let updated = false
    if (profileResult.status === "fulfilled") {
      setProfile(profileResult.value)
      writeFieldCache(PROFILE_KEY, profileResult.value)
      updated = true
    }
    if (weekResult.status === "fulfilled") {
      setWeek(weekResult.value)
      requestedWeek.current = weekResult.value.weekStart
      writeFieldCache(CURRENT_WEEK_KEY, weekResult.value)
      writeFieldCache(weekKey(weekResult.value.weekStart), weekResult.value)
      updated = true
    }
    if (notificationsResult.status === "fulfilled") {
      setNotifications(notificationsResult.value)
      writeFieldCache(NOTIFICATIONS_KEY, notificationsResult.value)
      updated = true
    }
    if (updated) {
      setLastUpdatedAt(new Date().toISOString())
      setPhase(
        profileResult.status === "fulfilled" &&
        weekResult.status === "fulfilled" &&
        notificationsResult.status === "fulfilled"
          ? "ready"
          : "stale",
      )
    } else {
      const firstError = profileResult.status === "rejected"
        ? profileResult.reason
        : weekResult.status === "rejected"
          ? weekResult.reason
          : notificationsResult.status === "rejected"
            ? notificationsResult.reason
            : null
      setError(firstError instanceof Error ? firstError.message : String(firstError ?? "Field data unavailable"))
      setPhase(profile || week ? "stale" : "error")
    }
  }, [loseSession, profile, week])

  const markAllNotificationsRead = useCallback(async () => {
    if (notifications.unread === 0) return
    await fieldApi.markNotificationsRead({ all: true, isRead: true })
    const next = {
      unread: 0,
      items: notifications.items.map((item) => ({ ...item, isRead: true })),
    }
    setNotifications(next)
    writeFieldCache(NOTIFICATIONS_KEY, next)
  }, [notifications])

  const applyLocalWeek = useCallback((next: FieldWeekData) => {
    setWeek(next)
    requestedWeek.current = next.weekStart
    writeFieldCache(CURRENT_WEEK_KEY, next)
    writeFieldCache(weekKey(next.weekStart), next)
    setLastUpdatedAt(new Date().toISOString())
    setPhase("stale")
  }, [])

  useEffect(() => {
    const profileCache = readFieldCache<FieldProfileData>(PROFILE_KEY)
    const weekCache = readFieldCache<FieldWeekData>(CURRENT_WEEK_KEY)
    const notificationsCache = readFieldCache<FieldNotificationsData>(NOTIFICATIONS_KEY)
    if (profileCache) setProfile(profileCache.value)
    if (weekCache) {
      setWeek(weekCache.value)
      requestedWeek.current = weekCache.value.weekStart
    }
    if (notificationsCache) setNotifications(notificationsCache.value)
    const cachedAt = [profileCache?.updatedAt, weekCache?.updatedAt, notificationsCache?.updatedAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
    setLastUpdatedAt(cachedAt)
    if (profileCache || weekCache || notificationsCache) setPhase("stale")
    void refresh()
  // Initial cache hydration and refresh belong to this provider lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Ctx.Provider value={{
      profile,
      week,
      notifications,
      phase,
      error,
      lastUpdatedAt,
      refresh,
      loadWeek,
      applyLocalWeek,
      markAllNotificationsRead,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useField() {
  const context = useContext(Ctx)
  if (!context) throw new Error("useField outside FieldProvider")
  return context
}
