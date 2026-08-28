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
import { IS_LEADDRIVE_FIELD } from "../config/mobile-variant"
import {
  cacheFieldMessages,
  readFieldCache,
  readFieldMessages,
  setWorkforceStreamManifest,
  writeFieldCache,
} from "../db/local-store"
import { AuthLostError } from "../sync/ports-error"
import { stopWorkdayTracking } from "../location/workday-tracking"
import { FIELD_AGENT_TASKS_CACHE_KEY } from "./task-cache"
import type {
  FieldAgentTasksData,
  FieldLocationHistoryData,
  FieldMobileBootstrapData,
  FieldNotificationsData,
  FieldMessagesData,
  FieldProfileData,
  FieldWeekData,
  FieldWorkdayData,
} from "./contracts"
import { fieldModuleRefreshPlan, fieldModuleUiPlan } from "./module-refresh-plan"

type FieldPhase = "loading" | "ready" | "refreshing" | "stale" | "error"

type FieldContextValue = {
  bootstrap: FieldMobileBootstrapData | null
  workforceEnabled: boolean
  routesEnabled: boolean
  profile: FieldProfileData | null
  week: FieldWeekData | null
  notifications: FieldNotificationsData
  messages: FieldMessagesData
  workday: FieldWorkdayData | null
  locations: FieldLocationHistoryData | null
  agentTasks: FieldAgentTasksData | null
  taskPhase: FieldPhase
  taskError: string | null
  activityPhase: FieldPhase
  activityError: string | null
  phase: FieldPhase
  error: string | null
  lastUpdatedAt: string | null
  refresh: () => Promise<void>
  loadWeek: (start: string) => Promise<void>
  refreshActivity: (date?: string) => Promise<void>
  refreshAgentTasks: () => Promise<void>
  applyLocalWeek: (week: FieldWeekData) => void
  applyLocalWorkday: (workday: FieldWorkdayData) => void
  applyLocalLocations: (locations: FieldLocationHistoryData) => void
  applyLocalAgentTasks: (tasks: FieldAgentTasksData) => void
  markAllNotificationsRead: () => Promise<void>
}

const PROFILE_KEY = "field.profile"
const BOOTSTRAP_KEY = "field.bootstrap"
const CURRENT_WEEK_KEY = "field.week.current"
const NOTIFICATIONS_KEY = "field.notifications"
const WORKDAY_KEY = "field.workday.current"
const LOCATIONS_KEY = "field.locations.current"
const Ctx = createContext<FieldContextValue | null>(null)

function weekKey(start: string): string {
  return `field.week.${start}`
}

export function FieldProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<FieldMobileBootstrapData | null>(
    () => readFieldCache<FieldMobileBootstrapData>(BOOTSTRAP_KEY)?.value ?? null,
  )
  const [profile, setProfile] = useState<FieldProfileData | null>(null)
  const [week, setWeek] = useState<FieldWeekData | null>(null)
  const [notifications, setNotifications] = useState<FieldNotificationsData>({ items: [], unread: 0 })
  const [messages, setMessages] = useState<FieldMessagesData>(readFieldMessages)
  const [workday, setWorkday] = useState<FieldWorkdayData | null>(null)
  const [locations, setLocations] = useState<FieldLocationHistoryData | null>(null)
  const [agentTasks, setAgentTasks] = useState<FieldAgentTasksData | null>(null)
  const [taskPhase, setTaskPhase] = useState<FieldPhase>("loading")
  const [taskError, setTaskError] = useState<string | null>(null)
  const [activityPhase, setActivityPhase] = useState<FieldPhase>("loading")
  const [activityError, setActivityError] = useState<string | null>(null)
  const [phase, setPhase] = useState<FieldPhase>("loading")
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const requestedWeek = useRef<string | null>(null)
  const requestSequence = useRef(0)
  const bootstrapRef = useRef<FieldMobileBootstrapData | null>(bootstrap)

  const loseSession = useCallback(async () => {
    await stopWorkdayTracking().catch(() => {})
    await tokenStore.clearSession()
    router.replace("/(auth)/login" as never)
  }, [])

  const rememberBootstrap = useCallback((next: FieldMobileBootstrapData) => {
    bootstrapRef.current = next
    setBootstrap(next)
    writeFieldCache(BOOTSTRAP_KEY, next)
    // Only a strictly validated LeadDrive manifest may update the independent
    // Workforce cursor/config marker. A failed bootstrap keeps the last safe
    // state rather than broadening any capability or deleting local work.
    if (IS_LEADDRIVE_FIELD) {
      setWorkforceStreamManifest({
        cursor: next.modules.workforce.cursor,
        configVersion: next.modules.workforce.configVersion,
      })
    }
  }, [])

  const refreshBootstrap = useCallback(async (): Promise<FieldMobileBootstrapData | null> => {
    try {
      const next = await fieldApi.bootstrap()
      rememberBootstrap(next)
      return next
    } catch (reason) {
      if (reason instanceof AuthLostError) await loseSession()
      return null
    }
  }, [loseSession, rememberBootstrap])

  const loadWeek = useCallback(async (start: string) => {
    if (!fieldModuleRefreshPlan(bootstrapRef.current?.modules ?? null).week) {
      setWeek(null)
      setPhase("ready")
      return
    }
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

  const refreshActivity = useCallback(async (
    date?: string,
    manifest: FieldMobileBootstrapData | null = bootstrapRef.current,
  ) => {
    const plan = fieldModuleRefreshPlan(manifest?.modules ?? null)
    const workdayCache = plan.workday ? readFieldCache<FieldWorkdayData>(WORKDAY_KEY) : null
    const locationsCache = plan.locations ? readFieldCache<FieldLocationHistoryData>(LOCATIONS_KEY) : null
    if (workdayCache) setWorkday(workdayCache.value)
    else if (!plan.workday) setWorkday(null)
    if (locationsCache) setLocations(locationsCache.value)
    else if (!plan.locations) setLocations(null)

    if (!plan.workday && !plan.locations) {
      setActivityError(null)
      setActivityPhase("ready")
      return
    }

    setActivityPhase(workdayCache || locationsCache ? "refreshing" : "loading")
    setActivityError(null)
    const [workdayResult, locationResult] = await Promise.allSettled([
      plan.workday
        ? fieldApi.workday(date)
        : Promise.resolve<FieldWorkdayData | null>(null),
      plan.locations
        ? fieldApi.locations(date)
        : Promise.resolve<FieldLocationHistoryData | null>(null),
    ])
    const requestedResults = [
      ...(plan.workday ? [workdayResult] : []),
      ...(plan.locations ? [locationResult] : []),
    ]
    const authLost = requestedResults.some(
      (result) => result.status === "rejected" && result.reason instanceof AuthLostError,
    )
    if (authLost) {
      await loseSession()
      return
    }

    let updated = false
    if (plan.workday && workdayResult.status === "fulfilled" && workdayResult.value) {
      setWorkday(workdayResult.value)
      writeFieldCache(WORKDAY_KEY, workdayResult.value)
      updated = true
    }
    if (plan.locations && locationResult.status === "fulfilled" && locationResult.value) {
      setLocations(locationResult.value)
      writeFieldCache(LOCATIONS_KEY, locationResult.value)
      updated = true
    }
    if (updated) {
      setActivityPhase(requestedResults.every((result) => result.status === "fulfilled") ? "ready" : "stale")
      return
    }
    const rejected = requestedResults.find((result) => result.status === "rejected")
    const reason = rejected?.status === "rejected" ? rejected.reason : null
    setActivityError(reason instanceof Error ? reason.message : String(reason ?? "Field activity unavailable"))
    setActivityPhase(workdayCache || locationsCache ? "stale" : "error")
  }, [loseSession])

  const refreshAgentTasks = useCallback(async (
    manifest: FieldMobileBootstrapData | null = bootstrapRef.current,
  ) => {
    if (!fieldModuleRefreshPlan(manifest?.modules ?? null).agentTasks) {
      setAgentTasks(null)
      setTaskError(null)
      setTaskPhase("ready")
      return
    }
    const cached = readFieldCache<FieldAgentTasksData>(FIELD_AGENT_TASKS_CACHE_KEY)
    if (cached) setAgentTasks(cached.value)
    setTaskPhase(cached ? "refreshing" : "loading")
    setTaskError(null)
    try {
      const next = await fieldApi.agentTasks("limit=200")
      setAgentTasks(next)
      writeFieldCache(FIELD_AGENT_TASKS_CACHE_KEY, next)
      setTaskPhase("ready")
    } catch (reason) {
      if (reason instanceof AuthLostError) {
        await loseSession()
        return
      }
      setTaskError(reason instanceof Error ? reason.message : String(reason))
      setTaskPhase(cached ? "stale" : "error")
    }
  }, [loseSession])

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current
    setPhase((current) => current === "loading" ? "loading" : "refreshing")
    setError(null)
    const manifest = await refreshBootstrap()
    if (sequence !== requestSequence.current) return
    if (!manifest) {
      setError("Field capability manifest unavailable")
      setPhase(profile || week ? "stale" : "error")
      return
    }

    const plan = fieldModuleRefreshPlan(manifest.modules)
    if (!plan.week) setWeek(null)
    const start = requestedWeek.current ?? undefined
    const [profileResult, notificationsResult, messagesResult, weekResult] = await Promise.allSettled([
      fieldApi.profile(),
      fieldApi.notifications(),
      fieldApi.messages(),
      plan.week
        ? fieldApi.week(start)
        : Promise.resolve<FieldWeekData | null>(null),
    ])
    if (sequence !== requestSequence.current) return

    const requestedResults = [
      profileResult,
      notificationsResult,
      messagesResult,
      ...(plan.week ? [weekResult] : []),
    ]
    const authLost = requestedResults.some(
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
    if (plan.week && weekResult.status === "fulfilled" && weekResult.value) {
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
    if (messagesResult.status === "fulfilled") {
      setMessages(cacheFieldMessages(messagesResult.value))
      updated = true
    }
    if (updated) {
      setLastUpdatedAt(new Date().toISOString())
      setPhase(
        requestedResults.every((result) => result.status === "fulfilled") ? "ready" : "stale",
      )
    } else {
      const failed = requestedResults.find((result) => result.status === "rejected")
      const firstError = failed?.status === "rejected" ? failed.reason : null
      setError(firstError instanceof Error ? firstError.message : String(firstError ?? "Field data unavailable"))
      setPhase(profile || week ? "stale" : "error")
    }
    await Promise.all([
      refreshActivity(undefined, manifest),
      refreshAgentTasks(manifest),
    ])
  }, [loseSession, profile, refreshActivity, refreshAgentTasks, refreshBootstrap, week])

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

  const applyLocalWorkday = useCallback((next: FieldWorkdayData) => {
    setWorkday(next)
    writeFieldCache(WORKDAY_KEY, next)
    setActivityPhase("stale")
  }, [])

  const applyLocalLocations = useCallback((next: FieldLocationHistoryData) => {
    setLocations(next)
    writeFieldCache(LOCATIONS_KEY, next)
    setActivityPhase("stale")
  }, [])

  const applyLocalAgentTasks = useCallback((next: FieldAgentTasksData) => {
    setAgentTasks(next)
    writeFieldCache(FIELD_AGENT_TASKS_CACHE_KEY, next)
    setTaskPhase("stale")
  }, [])

  useEffect(() => {
    const bootstrapCache = readFieldCache<FieldMobileBootstrapData>(BOOTSTRAP_KEY)
    const profileCache = readFieldCache<FieldProfileData>(PROFILE_KEY)
    const weekCache = readFieldCache<FieldWeekData>(CURRENT_WEEK_KEY)
    const notificationsCache = readFieldCache<FieldNotificationsData>(NOTIFICATIONS_KEY)
    const workdayCache = readFieldCache<FieldWorkdayData>(WORKDAY_KEY)
    const locationsCache = readFieldCache<FieldLocationHistoryData>(LOCATIONS_KEY)
    const agentTasksCache = readFieldCache<FieldAgentTasksData>(FIELD_AGENT_TASKS_CACHE_KEY)
    const messagesCache = readFieldMessages()
    if (bootstrapCache) {
      bootstrapRef.current = bootstrapCache.value
      setBootstrap(bootstrapCache.value)
    }
    if (profileCache) setProfile(profileCache.value)
    if (weekCache) {
      setWeek(weekCache.value)
      requestedWeek.current = weekCache.value.weekStart
    }
    if (notificationsCache) setNotifications(notificationsCache.value)
    if (workdayCache) setWorkday(workdayCache.value)
    if (locationsCache) setLocations(locationsCache.value)
    if (agentTasksCache) setAgentTasks(agentTasksCache.value)
    setMessages(messagesCache)
    const cachedAt = [bootstrapCache?.updatedAt, profileCache?.updatedAt, weekCache?.updatedAt, notificationsCache?.updatedAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
    setLastUpdatedAt(cachedAt)
    if (profileCache || weekCache || notificationsCache || bootstrapCache) setPhase("stale")
    if (workdayCache || locationsCache) setActivityPhase("stale")
    if (agentTasksCache) setTaskPhase("stale")
    void refresh()
  // Initial cache hydration and refresh belong to this provider lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const modulePlan = fieldModuleUiPlan(IS_LEADDRIVE_FIELD, bootstrap?.modules ?? null)

  return (
    <Ctx.Provider value={{
      bootstrap,
      workforceEnabled: modulePlan.workforce,
      routesEnabled: modulePlan.routes,
      profile,
      week,
      notifications,
      messages,
      workday,
      locations,
      agentTasks,
      taskPhase,
      taskError,
      activityPhase,
      activityError,
      phase,
      error,
      lastUpdatedAt,
      refresh,
      loadWeek,
      refreshActivity,
      refreshAgentTasks,
      applyLocalWeek,
      applyLocalWorkday,
      applyLocalLocations,
      applyLocalAgentTasks,
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
