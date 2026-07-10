"use client"

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  Ban,
  Download,
  Pencil,
  FileText,
  Map as MapIcon,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Trophy,
  Users,
  X,
} from "lucide-react"
import { FieldForceDashboard } from "./field-force-dashboard"
import { Link } from "@/i18n/navigation"
import { useLocale, useTranslations } from "next-intl"
import { formatLocaleDate } from "@/i18n/format"

type ViewKey = "map" | "routes" | "agents" | "leaderboard" | "activity" | "reports" | "settings"

interface RoutePoint {
  id: string
  customerId: string
  orderIndex: number
  status: "VISITED" | "SKIPPED" | "PENDING"
  plannedTime: string | null
  visitedAt: string | null
  visitId: string | null
  visitStatus: string | null
  openTaskCount: number
  orderCount: number
  customer: {
    id: string
    name: string
    code?: string | null
    address?: string | null
    latitude?: number | null
    longitude?: number | null
  }
}

interface RouteItem {
  id: string
  name: string
  agentId: string | null
  date: string
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
  totalPoints: number
  visitedPoints: number
  startedAt: string | null
  completedAt: string | null
  agent: { id: string; name: string } | null
  points: RoutePoint[]
}

interface AgentItem {
  id: string
  agentId: string
  userId: string
  name: string
  email: string | null
  role: string
  status: "ACTIVE" | "INACTIVE"
  phone: string | null
  employeeCode: string | null
  teamId: string | null
  team: { id: string; name: string } | null
  isOnline: boolean
  fieldStatus: "CHECKED_IN" | "ON_ROAD" | "LATE" | "OFFLINE"
  routeCompletion: number
  visitsToday: number
  completedVisitsToday: number
  activeRoutes: number
  routeStopsToday: number
  lastCustomer: string | null
  lastSeenAt: string | null
}

interface StoreOption {
  id: string
  name: string
  code: string | null
  address: string | null
  format?: { id: string; name: string } | null
  region?: { id: string; name: string } | null
}

interface TeamOption {
  id: string
  name: string
}

interface UserCandidate {
  id: string
  name: string
  email: string | null
  employeeCode: string | null
  role: string
}

interface RouteFormPayload {
  name: string
  agentId: string | null
  date: string | null
  storeIds?: string[]
}

interface AgentCreatePayload {
  userId: string
  teamId: string | null
  phone: string | null
}

interface AgentUpdatePayload {
  teamId: string | null
  phone: string | null
}

interface ActionMessage {
  type: "success" | "error"
  text: string
}

interface LiveEvent {
  id: string
  type: string
  agent: string
  customer: string
  time: string
}

interface SettingsState {
  gpsRefreshSeconds: number
  geofenceRadiusM: number
  offlineAfterMinutes: number
  requirePhotoProof: boolean
  requireShelfScan: boolean
  alertLateVisits: boolean
}

interface LeaderboardItem extends AgentItem {
  score: number
}

interface ReportShape {
  totalRoutes: number
  inProgressRoutes: number
  completedRoutes: number
  plannedRoutes: number
  cancelledRoutes: number
  totalPoints: number
  visitedPoints: number
  completion: number
  onlineAgents: number
  lateAgents: number
}

const TABS: Array<{ key: ViewKey; Icon: typeof MapIcon }> = [
  { key: "map", Icon: MapIcon },
  { key: "routes", Icon: Route },
  { key: "agents", Icon: Users },
  { key: "leaderboard", Icon: Trophy },
  { key: "activity", Icon: Activity },
  { key: "reports", Icon: FileText },
  { key: "settings", Icon: Settings },
]

const DEFAULT_SETTINGS: SettingsState = {
  gpsRefreshSeconds: 15,
  geofenceRadiusM: 120,
  offlineAfterMinutes: 45,
  requirePhotoProof: true,
  requireShelfScan: true,
  alertLateVisits: true,
}

const EMPTY_REPORT: ReportShape = {
  totalRoutes: 0,
  inProgressRoutes: 0,
  completedRoutes: 0,
  plannedRoutes: 0,
  cancelledRoutes: 0,
  totalPoints: 0,
  visitedPoints: 0,
  completion: 0,
  onlineAgents: 0,
  lateAgents: 0,
}

function toDateInput(value: string | Date | null | undefined) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ""
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function percent(value: number, total: number) {
  if (total <= 0) return 0
  return Math.round((value / total) * 100)
}

function routeStatusClass(status: RouteItem["status"]) {
  if (status === "COMPLETED") return "border-green-200 bg-green-50 text-green-700"
  if (status === "IN_PROGRESS") return "border-blue-200 bg-blue-50 text-blue-700"
  if (status === "CANCELLED") return "border-neutral-200 bg-neutral-100 text-neutral-500"
  return "border-amber-200 bg-amber-50 text-amber-700"
}

function fieldStatusClass(status: AgentItem["fieldStatus"]) {
  if (status === "CHECKED_IN") return "bg-green-500"
  if (status === "ON_ROAD") return "bg-blue-500"
  if (status === "LATE") return "bg-red-500"
  return "bg-neutral-400"
}

function toSettingsState(value: Partial<SettingsState> | null | undefined): SettingsState {
  return { ...DEFAULT_SETTINGS, ...(value ?? {}) }
}

function toCsvValue(value: unknown) {
  const text = value == null ? "" : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return
  const headers = Object.keys(rows[0]!)
  const csv = [
    headers.map(toCsvValue).join(","),
    ...rows.map((row) => headers.map((header) => toCsvValue(row[header])).join(",")),
  ].join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

async function apiRequest(url: string, init: RequestInit) {
  const headers = new Headers(init.headers)
  headers.set("Content-Type", "application/json")
  const res = await fetch(url, {
    ...init,
    headers,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) {
    const message = typeof body.error === "string" ? body.error : `HTTP ${res.status}`
    throw new Error(message)
  }
  return body
}

export function FieldForceWorkspace() {
  const tWork = useTranslations("fieldForce.workspace")
  const locale = useLocale()
  const [activeView, setActiveView] = useState<ViewKey>("map")
  const [routes, setRoutes] = useState<RouteItem[]>([])
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [stores, setStores] = useState<StoreOption[]>([])
  const [teams, setTeams] = useState<TeamOption[]>([])
  const [userCandidates, setUserCandidates] = useState<UserCandidate[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([])
  const [activityEvents, setActivityEvents] = useState<LiveEvent[]>([])
  const [report, setReport] = useState<ReportShape>(EMPTY_REPORT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)
  const [routeSearch, setRouteSearch] = useState("")
  const [agentSearch, setAgentSearch] = useState("")
  const [routeStatus, setRouteStatus] = useState<"ALL" | RouteItem["status"]>("ALL")
  const [agentStatus, setAgentStatus] = useState<"ALL" | AgentItem["fieldStatus"]>("ALL")
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [routesRes, agentsRes, storesRes, settingsRes, leaderboardRes, activityRes, reportsRes] = await Promise.all([
        fetch("/api/v1/field-force/routes?limit=200", { cache: "no-store" }),
        fetch("/api/v1/field-force/agents?limit=200", { cache: "no-store" }),
        fetch("/api/v1/field-force/stores?limit=300", { cache: "no-store" }),
        fetch("/api/v1/field-force/settings", { cache: "no-store" }),
        fetch("/api/v1/field-force/leaderboard?limit=100", { cache: "no-store" }),
        fetch("/api/v1/field-force/activity?limit=50", { cache: "no-store" }),
        fetch("/api/v1/field-force/reports", { cache: "no-store" }),
      ])
      const [routesJson, agentsJson, storesJson, settingsJson, leaderboardJson, activityJson, reportsJson] = await Promise.all([
        routesRes.json(),
        agentsRes.json(),
        storesRes.json(),
        settingsRes.json(),
        leaderboardRes.json(),
        activityRes.json(),
        reportsRes.json(),
      ])
      if (!routesRes.ok || !routesJson.success) throw new Error("routes_failed")
      if (!agentsRes.ok || !agentsJson.success) throw new Error("agents_failed")
      if (!storesRes.ok || !storesJson.success) throw new Error("stores_failed")
      if (!settingsRes.ok || !settingsJson.success) throw new Error("settings_failed")
      if (!leaderboardRes.ok || !leaderboardJson.success) throw new Error("leaderboard_failed")
      if (!activityRes.ok || !activityJson.success) throw new Error("activity_failed")
      if (!reportsRes.ok || !reportsJson.success) throw new Error("reports_failed")

      const nextRoutes = (routesJson.data?.routes ?? []) as RouteItem[]
      const nextSettings = settingsJson.data?.settings as (Partial<SettingsState> & { updatedAt?: string | null }) | undefined
      setRoutes(nextRoutes)
      setAgents((agentsJson.data?.agents ?? []) as AgentItem[])
      setTeams((agentsJson.data?.teams ?? []) as TeamOption[])
      setUserCandidates((agentsJson.data?.users ?? []) as UserCandidate[])
      setStores((storesJson.data?.stores ?? []) as StoreOption[])
      setSettings(toSettingsState(nextSettings))
      setLeaderboard((leaderboardJson.data?.leaderboard ?? []) as LeaderboardItem[])
      setActivityEvents((activityJson.data?.events ?? []) as LiveEvent[])
      setReport((reportsJson.data?.report ?? EMPTY_REPORT) as ReportShape)
      if (nextSettings?.updatedAt) setSavedAt(new Date(nextSettings.updatedAt))
      setSelectedRouteId((current) => current ?? nextRoutes[0]?.id ?? null)
      setLastLoadedAt(new Date())
    } catch {
      setError(tWork("loadError"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("view") === "routes") setActiveView("routes")
    const routeId = params.get("routeId")
    if (routeId) setSelectedRouteId(routeId)
  }, [])

  const createRoute = useCallback(async (payload: RouteFormPayload) => {
    try {
      await apiRequest("/api/v1/field-force/routes", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      setActionMessage({ type: "success", text: tWork("messages.routeCreated") })
      await loadWorkspace()
    } catch (err) {
      setActionMessage({ type: "error", text: tWork("messages.routeCreateFailed", { error: (err as Error).message }) })
      throw err
    }
  }, [loadWorkspace])

  const updateRoute = useCallback(async (routeId: string, payload: RouteFormPayload) => {
    try {
      await apiRequest(`/api/v1/field-force/routes/${routeId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      })
      setActionMessage({ type: "success", text: tWork("messages.routeUpdated") })
      await loadWorkspace()
    } catch (err) {
      setActionMessage({ type: "error", text: tWork("messages.routeUpdateFailed", { error: (err as Error).message }) })
      throw err
    }
  }, [loadWorkspace])

  const cancelRoute = useCallback(async (routeId: string) => {
    try {
      await apiRequest(`/api/v1/field-force/routes/${routeId}`, { method: "DELETE" })
      setActionMessage({ type: "success", text: tWork("messages.routeCancelled") })
      await loadWorkspace()
    } catch (err) {
      setActionMessage({ type: "error", text: tWork("messages.routeCancelFailed", { error: (err as Error).message }) })
      throw err
    }
  }, [loadWorkspace])

  const createAgent = useCallback(async (payload: AgentCreatePayload) => {
    try {
      await apiRequest("/api/v1/field-force/agents", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      setActionMessage({ type: "success", text: tWork("messages.agentCreated") })
      await loadWorkspace()
    } catch (err) {
      setActionMessage({ type: "error", text: tWork("messages.agentCreateFailed", { error: (err as Error).message }) })
      throw err
    }
  }, [loadWorkspace])

  const updateAgent = useCallback(async (agentId: string, payload: AgentUpdatePayload) => {
    try {
      await apiRequest(`/api/v1/field-force/agents/${agentId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      })
      setActionMessage({ type: "success", text: tWork("messages.agentUpdated") })
      await loadWorkspace()
    } catch (err) {
      setActionMessage({ type: "error", text: tWork("messages.agentUpdateFailed", { error: (err as Error).message }) })
      throw err
    }
  }, [loadWorkspace])

  const filteredRoutes = useMemo(() => {
    const term = routeSearch.trim().toLowerCase()
    return routes.filter((route) => {
      const matchesStatus = routeStatus === "ALL" || route.status === routeStatus
      const matchesTerm =
        !term ||
        route.name.toLowerCase().includes(term) ||
        route.agent?.name.toLowerCase().includes(term) ||
        route.points.some((point) => point.customer.name.toLowerCase().includes(term))
      return matchesStatus && matchesTerm
    })
  }, [routes, routeSearch, routeStatus])

  const filteredAgents = useMemo(() => {
    const term = agentSearch.trim().toLowerCase()
    return agents.filter((agent) => {
      const matchesStatus = agentStatus === "ALL" || agent.fieldStatus === agentStatus
      const matchesTerm =
        !term ||
        agent.name.toLowerCase().includes(term) ||
        agent.email?.toLowerCase().includes(term) ||
        agent.employeeCode?.toLowerCase().includes(term) ||
        agent.team?.name.toLowerCase().includes(term)
      return matchesStatus && matchesTerm
    })
  }, [agents, agentSearch, agentStatus])

  const selectedRoute = useMemo(
    () => filteredRoutes.find((route) => route.id === selectedRouteId) ?? filteredRoutes[0] ?? null,
    [selectedRouteId, filteredRoutes],
  )

  const saveSettings = useCallback(async () => {
    setSettingsSaving(true)
    try {
      const body = await apiRequest("/api/v1/field-force/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      })
      const nextSettings = body.data?.settings as (Partial<SettingsState> & { updatedAt?: string | null }) | undefined
      setSettings(toSettingsState(nextSettings))
      setSavedAt(nextSettings?.updatedAt ? new Date(nextSettings.updatedAt) : new Date())
      setActionMessage({ type: "success", text: tWork("messages.settingsSaved") })
      await loadWorkspace()
    } catch (err) {
      setActionMessage({ type: "error", text: tWork("messages.settingsFailed", { error: (err as Error).message }) })
    } finally {
      setSettingsSaving(false)
    }
  }, [settings, loadWorkspace])

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{tWork("title")}</h1>
            <p className="mt-1 text-sm text-neutral-500">
              {tWork("subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {lastLoadedAt ? (
              <span className="text-xs text-neutral-500">{tWork("updated", { value: formatLocaleDate(lastLoadedAt, locale, { timeStyle: "short" }) })}</span>
            ) : null}
            <button
              className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-800 hover:bg-neutral-50"
              onClick={loadWorkspace}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              {tWork("refresh")}
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {TABS.map(({ key, Icon }) => {
            const active = activeView === key
            return (
              <button
                key={key}
                className={`rounded-lg border p-2 text-left transition-colors ${
                  active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50"
                }`}
                onClick={() => setActiveView(key)}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-semibold">{tWork(`tabs.${key}.label`)}</span>
                </div>
                <div className={`mt-1 hidden text-xs sm:block ${active ? "text-indigo-100" : "text-neutral-500"}`}>{tWork(`tabs.${key}.description`)}</div>
              </button>
            )
          })}
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      {activeView === "map" ? <FieldForceDashboard /> : null}
      {activeView === "routes" ? (
        <RoutesView
          filteredRoutes={filteredRoutes}
          agents={agents}
          stores={stores}
          routeSearch={routeSearch}
          routeStatus={routeStatus}
          selectedRoute={selectedRoute}
          loading={loading}
          actionMessage={actionMessage}
          onRouteSearch={setRouteSearch}
          onRouteStatus={setRouteStatus}
          onSelectRoute={setSelectedRouteId}
          onCreateRoute={createRoute}
          onUpdateRoute={updateRoute}
          onCancelRoute={cancelRoute}
          onExport={() =>
            downloadCsv(
              "field-routes.csv",
              filteredRoutes.map((route) => ({
                route: route.name,
                agent: route.agent?.name ?? "",
                status: tWork(`routeStatus.${route.status}`),
                points: route.totalPoints,
                visited: route.visitedPoints,
                completion: `${percent(route.visitedPoints, route.totalPoints)}%`,
              })),
            )
          }
        />
      ) : null}
      {activeView === "agents" ? (
        <AgentsView
          agents={filteredAgents}
          teams={teams}
          userCandidates={userCandidates}
          agentSearch={agentSearch}
          agentStatus={agentStatus}
          loading={loading}
          actionMessage={actionMessage}
          onAgentSearch={setAgentSearch}
          onAgentStatus={setAgentStatus}
          onCreateAgent={createAgent}
          onUpdateAgent={updateAgent}
          onExport={() =>
            downloadCsv(
              "field-agents.csv",
              filteredAgents.map((agent) => ({
                agent: agent.name,
                email: agent.email ?? "",
                team: agent.team?.name ?? "",
                status: tWork(`fieldStatus.${agent.fieldStatus}`),
                visitsToday: agent.visitsToday,
                completedVisitsToday: agent.completedVisitsToday,
                completion: `${agent.routeCompletion}%`,
              })),
            )
          }
        />
      ) : null}
      {activeView === "leaderboard" ? <LeaderboardView agents={leaderboard} /> : null}
      {activeView === "activity" ? <ActivityView events={activityEvents} /> : null}
      {activeView === "reports" ? <ReportsView report={report} routes={routes} agents={agents} /> : null}
      {activeView === "settings" ? (
        <SettingsView
          settings={settings}
          savedAt={savedAt}
          saving={settingsSaving}
          actionMessage={actionMessage}
          onChange={setSettings}
          onSave={saveSettings}
        />
      ) : null}
    </div>
  )
}

function ToolbarSearch({
  value,
  placeholder,
  onChange,
}: {
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <label className="relative min-w-[220px] flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
      <input
        className="h-10 w-full rounded-md border border-neutral-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-neutral-900"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function RoutesView({
  filteredRoutes,
  agents,
  stores,
  routeSearch,
  routeStatus,
  selectedRoute,
  loading,
  actionMessage,
  onRouteSearch,
  onRouteStatus,
  onSelectRoute,
  onCreateRoute,
  onUpdateRoute,
  onCancelRoute,
  onExport,
}: {
  filteredRoutes: RouteItem[]
  agents: AgentItem[]
  stores: StoreOption[]
  routeSearch: string
  routeStatus: "ALL" | RouteItem["status"]
  selectedRoute: RouteItem | null
  loading: boolean
  actionMessage: ActionMessage | null
  onRouteSearch: (value: string) => void
  onRouteStatus: (value: "ALL" | RouteItem["status"]) => void
  onSelectRoute: (id: string) => void
  onCreateRoute: (payload: RouteFormPayload) => Promise<void>
  onUpdateRoute: (routeId: string, payload: RouteFormPayload) => Promise<void>
  onCancelRoute: (routeId: string) => Promise<void>
  onExport: () => void
}) {
  const tExecution = useTranslations("fieldForce.execution")
  const tWork = useTranslations("fieldForce.workspace")
  const locale = useLocale()
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [routeForm, setRouteForm] = useState({
    name: "",
    agentId: "",
    date: toDateInput(new Date()),
    storeIds: [] as string[],
  })

  const storeById = useMemo(() => new Map(stores.map((store) => [store.id, store])), [stores])
  const selectedStoreIds = useMemo(() => new Set(routeForm.storeIds), [routeForm.storeIds])
  const routeLocked = Boolean(
    formMode === "edit" &&
      selectedRoute?.points.some((point) => point.status !== "PENDING" || point.visitedAt),
  )

  const openCreate = () => {
    setFormMode("create")
    setFormError(null)
    setRouteForm({
      name: "",
      agentId: selectedRoute?.agentId ?? "",
      date: toDateInput(new Date()),
      storeIds: [],
    })
  }

  const openEdit = () => {
    if (!selectedRoute) return
    setFormMode("edit")
    setFormError(null)
    setRouteForm({
      name: selectedRoute.name,
      agentId: selectedRoute.agentId ?? "",
      date: toDateInput(selectedRoute.date),
      storeIds: selectedRoute.points.map((point) => point.customerId),
    })
  }

  const addStore = (storeId: string) => {
    if (!storeId || selectedStoreIds.has(storeId)) return
    setRouteForm((current) => ({ ...current, storeIds: [...current.storeIds, storeId] }))
  }

  const moveStore = (storeId: string, direction: -1 | 1) => {
    setRouteForm((current) => {
      const index = current.storeIds.indexOf(storeId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.storeIds.length) return current
      const nextIds = [...current.storeIds]
      const [item] = nextIds.splice(index, 1)
      nextIds.splice(nextIndex, 0, item!)
      return { ...current, storeIds: nextIds }
    })
  }

  const removeStore = (storeId: string) => {
    setRouteForm((current) => ({ ...current, storeIds: current.storeIds.filter((id) => id !== storeId) }))
  }

  const submitRoute = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = routeForm.name.trim()
    if (!name) {
      setFormError(tWork("routes.validation.name"))
      return
    }
    if (!routeLocked && routeForm.storeIds.length === 0) {
      setFormError(tWork("routes.validation.store"))
      return
    }
    const today = toDateInput(new Date())
    if (routeForm.date && routeForm.date < today) {
      const confirmed = window.confirm(tWork("routes.confirmPastDate", { date: routeForm.date }))
      if (!confirmed) return
    }

    setSaving(true)
    setFormError(null)
    try {
      const payload: RouteFormPayload = {
        name,
        agentId: routeForm.agentId || null,
        date: routeForm.date || null,
        ...(routeLocked ? {} : { storeIds: routeForm.storeIds }),
      }
      if (formMode === "edit" && selectedRoute) {
        await onUpdateRoute(selectedRoute.id, payload)
      } else {
        await onCreateRoute(payload)
      }
      setFormMode(null)
    } catch {
      // Parent sets the visible API error message.
    } finally {
      setSaving(false)
    }
  }

  const cancelSelectedRoute = async () => {
    if (!selectedRoute) return
    const confirmed = window.confirm(tWork("routes.confirmCancel", { name: selectedRoute.name }))
    if (!confirmed) return
    await onCancelRoute(selectedRoute.id)
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="order-2 rounded-lg border border-neutral-200 bg-white p-3 xl:order-1">
        <div className="flex flex-wrap items-center gap-2">
          <ToolbarSearch value={routeSearch} placeholder={tWork("routes.search")} onChange={onRouteSearch} />
          <select
            className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm"
            value={routeStatus}
            onChange={(event) => onRouteStatus(event.target.value as "ALL" | RouteItem["status"])}
          >
            <option value="ALL">{tWork("allStatuses")}</option>
            <option value="PLANNED">{tWork("routeStatus.PLANNED")}</option>
            <option value="IN_PROGRESS">{tWork("routeStatus.IN_PROGRESS")}</option>
            <option value="COMPLETED">{tWork("routeStatus.COMPLETED")}</option>
            <option value="CANCELLED">{tWork("routeStatus.CANCELLED")}</option>
          </select>
          <button
            className="inline-flex h-10 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-50"
            onClick={onExport}
          >
            <Download className="h-4 w-4" />
            CSV
          </button>
          <button
            className="inline-flex h-10 items-center gap-1 rounded-md bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700"
            onClick={openCreate}
          >
            <Plus className="h-4 w-4" />
            {tWork("routes.new")}
          </button>
          <button
            className="inline-flex h-10 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={openEdit}
            disabled={!selectedRoute}
          >
            <Pencil className="h-4 w-4" />
            {tWork("edit")}
          </button>
          <button
            className="inline-flex h-10 items-center gap-1 rounded-md border border-red-200 bg-white px-3 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={cancelSelectedRoute}
            disabled={!selectedRoute || selectedRoute.status === "CANCELLED"}
          >
            <Ban className="h-4 w-4" />
            {tWork("cancel")}
          </button>
        </div>

        <div className="mt-3 grid gap-2">
          {loading ? <div className="rounded-lg bg-neutral-50 p-6 text-center text-sm text-neutral-500">{tWork("routes.loading")}</div> : null}
          {!loading && filteredRoutes.length === 0 ? (
            <div className="rounded-lg bg-neutral-50 p-6 text-center text-sm text-neutral-500">{tWork("routes.emptyFilter")}</div>
          ) : null}
          {filteredRoutes.map((route) => {
            const completion = percent(route.visitedPoints, route.totalPoints)
            const active = selectedRoute?.id === route.id
            return (
              <button
                key={route.id}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  active ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 bg-white hover:bg-neutral-50"
                }`}
                onClick={() => onSelectRoute(route.id)}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-neutral-900">{route.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        {formatLocaleDate(route.date, locale, { dateStyle: "medium" })}
                      </span>
                      <span>{route.agent?.name ?? tWork("unassigned")}</span>
                    </div>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-xs font-medium ${routeStatusClass(route.status)}`}>
                    {tWork(`routeStatus.${route.status}`)}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full rounded-full bg-neutral-900" style={{ width: `${completion}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-xs text-neutral-500">
                  <span>{tWork("routes.pointsCount", { visited: route.visitedPoints, total: route.totalPoints })}</span>
                  <span>{completion}%</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="order-1 rounded-lg border border-neutral-200 bg-white p-3 xl:order-2">
        {actionMessage ? (
          <div
            role={actionMessage.type === "error" ? "alert" : "status"}
            className={`mb-3 rounded-md border p-2 text-sm ${
              actionMessage.type === "success"
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {actionMessage.text}
          </div>
        ) : null}

        {formMode ? (
          <form onSubmit={submitRoute} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{formMode === "edit" ? tWork("routes.editTitle") : tWork("routes.new")}</h2>
                <p className="mt-1 text-xs text-neutral-500">
                  {routeLocked ? tWork("routes.lockedHint") : tWork("routes.orderHint")}
                </p>
              </div>
              <button
                type="button"
                className="rounded-md border border-neutral-300 p-2 text-neutral-600 hover:bg-neutral-50"
                onClick={() => setFormMode(null)}
                aria-label={tWork("closeForm")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {formError ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{formError}</div> : null}

            <label className="block">
              <span className="text-sm font-medium">{tWork("routes.name")}</span>
              <input
                className="mt-1 h-10 w-full rounded-md border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-900"
                value={routeForm.name}
                onChange={(event) => setRouteForm((current) => ({ ...current, name: event.target.value }))}
                placeholder={tWork("routes.namePlaceholder")}
              />
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium">{tWork("agent")}</span>
                <select
                  className="mt-1 h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm"
                  value={routeForm.agentId}
                  onChange={(event) => setRouteForm((current) => ({ ...current, agentId: event.target.value }))}
                >
                  <option value="">{tWork("unassigned")}</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium">{tWork("date")}</span>
                <input
                  className="mt-1 h-10 w-full rounded-md border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-900"
                  type="date"
                  value={routeForm.date}
                  onChange={(event) => setRouteForm((current) => ({ ...current, date: event.target.value }))}
                />
              </label>
            </div>

            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{tWork("routes.stops")}</h3>
                <span className="text-xs text-neutral-500">{tWork("routes.storeCount", { count: routeForm.storeIds.length })}</span>
              </div>
              <div className="mt-2 space-y-2">
                {routeForm.storeIds.length === 0 ? (
                  <div className="rounded-md bg-white p-3 text-sm text-neutral-500">{tWork("routes.noStops")}</div>
                ) : null}
                {routeForm.storeIds.map((storeId, index) => {
                  const store = storeById.get(storeId)
                  return (
                    <div key={storeId} className="flex items-center gap-2 rounded-md bg-white p-2 text-sm">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{store?.name ?? tWork("storeNotFound")}</div>
                        <div className="truncate text-xs text-neutral-500">{store?.address ?? store?.code ?? tWork("noAddress")}</div>
                      </div>
                      {!routeLocked ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            className="rounded border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40"
                            onClick={() => moveStore(storeId, -1)}
                            disabled={index === 0}
                            aria-label={tWork("routes.moveUp", { store: store?.name ?? "" })}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="rounded border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-40"
                            onClick={() => moveStore(storeId, 1)}
                            disabled={index === routeForm.storeIds.length - 1}
                            aria-label={tWork("routes.moveDown", { store: store?.name ?? "" })}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                            onClick={() => removeStore(storeId)}
                          >
                            {tWork("remove")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              {!routeLocked ? (
                <select
                  className="mt-2 h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm"
                  value=""
                  onChange={(event) => addStore(event.target.value)}
                >
                  <option value="">{tWork("routes.addStore")}</option>
                  {stores
                    .filter((store) => !selectedStoreIds.has(store.id))
                    .map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}{store.code ? ` (${store.code})` : ""}
                      </option>
                    ))}
                </select>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="inline-flex h-10 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-50"
                onClick={() => setFormMode(null)}
              >
                <X className="h-4 w-4" />
                {tWork("close")}
              </button>
              <button
                type="submit"
                className="inline-flex h-10 items-center gap-1 rounded-md bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saving}
              >
                <Save className="h-4 w-4" />
                {saving ? tWork("saving") : tWork("save")}
              </button>
            </div>
          </form>
        ) : selectedRoute ? (
          <div className="mt-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold">{tWork("routes.details")}</h2>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs hover:bg-neutral-50"
                onClick={openEdit}
              >
                <Pencil className="h-3.5 w-3.5" />
                {tWork("edit")}
              </button>
            </div>
            <div>
              <div className="text-sm font-semibold">{selectedRoute.name}</div>
              <div className="mt-1 text-xs text-neutral-500">
                {selectedRoute.agent?.name ?? tWork("unassigned")} · {tWork(`routeStatus.${selectedRoute.status}`)}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MetricCard label={tWork("routes.metrics.points")} value={selectedRoute.totalPoints} />
              <MetricCard label={tWork("routes.metrics.completed")} value={selectedRoute.visitedPoints} />
              <MetricCard label={tWork("routes.metrics.progress")} value={`${percent(selectedRoute.visitedPoints, selectedRoute.totalPoints)}%`} />
            </div>
            <div className="space-y-2">
              {selectedRoute.points.map((point) => (
                <div key={point.id} className="flex gap-2 rounded-lg border border-neutral-100 bg-neutral-50 p-2">
                  <div className={`mt-1 h-2.5 w-2.5 rounded-full ${point.status === "VISITED" ? "bg-green-500" : point.status === "SKIPPED" ? "bg-neutral-400" : "bg-amber-400"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {point.orderIndex + 1}.{" "}
                      <Link
                        href={`/stores/${point.customer.id}`}
                        className="hover:text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                      >
                        {point.customer.name}
                      </Link>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-neutral-500">{point.customer.address ?? tWork("noAddress")}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      {point.visitStatus ? (
                        <span className="rounded-full bg-white px-2 py-1 text-neutral-600">
                          {tExecution(`visitStatus.${point.visitStatus}` as never)}
                        </span>
                      ) : null}
                      <Link
                        href={`/tasks?storeId=${encodeURIComponent(point.customer.id)}`}
                        className="rounded-full bg-indigo-50 px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                      >
                        {tExecution("tasks", { count: point.openTaskCount })}
                      </Link>
                      <Link
                        href={`/orders?storeId=${encodeURIComponent(point.customer.id)}${point.visitId ? `&visitId=${encodeURIComponent(point.visitId)}` : ""}`}
                        className="rounded-full bg-indigo-50 px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                      >
                        {tExecution("orders", { count: point.orderCount })}
                      </Link>
                    </div>
                  </div>
                  <div className="text-right text-xs text-neutral-500">
                    {point.visitedAt ? formatLocaleDate(point.visitedAt, locale, { timeStyle: "short" }) : point.plannedTime ? formatLocaleDate(point.plannedTime, locale, { timeStyle: "short" }) : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-lg font-semibold">{tWork("routes.details")}</h2>
            <div className="mt-6 rounded-lg bg-neutral-50 p-6 text-center text-sm text-neutral-500">{tWork("routes.selectHint")}</div>
          </div>
        )}
      </div>
    </section>
  )
}

function AgentsView({
  agents,
  teams,
  userCandidates,
  agentSearch,
  agentStatus,
  loading,
  actionMessage,
  onAgentSearch,
  onAgentStatus,
  onCreateAgent,
  onUpdateAgent,
  onExport,
}: {
  agents: AgentItem[]
  teams: TeamOption[]
  userCandidates: UserCandidate[]
  agentSearch: string
  agentStatus: "ALL" | AgentItem["fieldStatus"]
  loading: boolean
  actionMessage: ActionMessage | null
  onAgentSearch: (value: string) => void
  onAgentStatus: (value: "ALL" | AgentItem["fieldStatus"]) => void
  onCreateAgent: (payload: AgentCreatePayload) => Promise<void>
  onUpdateAgent: (agentId: string, payload: AgentUpdatePayload) => Promise<void>
  onExport: () => void
}) {
  const tWork = useTranslations("fieldForce.workspace")
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null)
  const [editingAgent, setEditingAgent] = useState<AgentItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [agentForm, setAgentForm] = useState({ userId: "", teamId: "", phone: "" })

  const openCreate = () => {
    setFormMode("create")
    setEditingAgent(null)
    setFormError(null)
    setAgentForm({ userId: userCandidates[0]?.id ?? "", teamId: "", phone: "" })
  }

  const openEdit = (agent: AgentItem) => {
    setFormMode("edit")
    setEditingAgent(agent)
    setFormError(null)
    setAgentForm({ userId: agent.userId, teamId: agent.teamId ?? "", phone: agent.phone ?? "" })
  }

  const submitAgent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (formMode === "create" && !agentForm.userId) {
      setFormError(tWork("agents.validation.user"))
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      if (formMode === "edit" && editingAgent) {
        await onUpdateAgent(editingAgent.id, {
          teamId: agentForm.teamId || null,
          phone: agentForm.phone.trim() || null,
        })
      } else {
        await onCreateAgent({
          userId: agentForm.userId,
          teamId: agentForm.teamId || null,
          phone: agentForm.phone.trim() || null,
        })
      }
      setFormMode(null)
      setEditingAgent(null)
    } catch {
      // Parent sets the visible API error message.
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarSearch value={agentSearch} placeholder={tWork("agents.search")} onChange={onAgentSearch} />
        <select
          className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm"
          value={agentStatus}
          onChange={(event) => onAgentStatus(event.target.value as "ALL" | AgentItem["fieldStatus"])}
        >
          <option value="ALL">{tWork("allStatuses")}</option>
          <option value="CHECKED_IN">{tWork("fieldStatus.CHECKED_IN")}</option>
          <option value="ON_ROAD">{tWork("fieldStatus.ON_ROAD")}</option>
          <option value="LATE">{tWork("fieldStatus.LATE")}</option>
          <option value="OFFLINE">{tWork("fieldStatus.OFFLINE")}</option>
        </select>
        <button
          className="inline-flex h-10 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-50"
          onClick={onExport}
        >
          <Download className="h-4 w-4" />
          CSV
        </button>
        <button
          className="inline-flex h-10 items-center gap-1 rounded-md bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={openCreate}
          disabled={userCandidates.length === 0}
        >
          <Plus className="h-4 w-4" />
          {tWork("agents.add")}
        </button>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200">
        <div className="grid min-w-[900px] grid-cols-[minmax(220px,1.2fr)_1fr_130px_120px_110px_96px] bg-neutral-50 px-3 py-2 text-xs font-semibold uppercase text-neutral-500">
          <div>{tWork("agent")}</div>
          <div>{tWork("team")}</div>
          <div>{tWork("status")}</div>
          <div>{tWork("visits")}</div>
          <div>{tWork("progress")}</div>
          <div></div>
        </div>
        {loading ? <div className="p-6 text-center text-sm text-neutral-500">{tWork("agents.loading")}</div> : null}
        {!loading && agents.length === 0 ? <div className="p-6 text-center text-sm text-neutral-500">{tWork("agents.emptyFilter")}</div> : null}
        {agents.map((agent) => (
          <div key={agent.id} className="grid min-w-[900px] grid-cols-[minmax(220px,1.2fr)_1fr_130px_120px_110px_96px] items-center border-t border-neutral-100 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{agent.name}</div>
              <div className="truncate text-xs text-neutral-500">{agent.email ?? agent.employeeCode ?? tWork("noEmail")}</div>
            </div>
            <div className="truncate text-neutral-600">{agent.team?.name ?? tWork("noTeam")}</div>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${fieldStatusClass(agent.fieldStatus)}`} />
              <span>{tWork(`fieldStatus.${agent.fieldStatus}`)}</span>
            </div>
            <div>{agent.completedVisitsToday}/{agent.visitsToday}</div>
            <div>{agent.routeCompletion}%</div>
            <div className="text-right">
              <button
                className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs hover:bg-neutral-50"
                onClick={() => openEdit(agent)}
              >
                <Pencil className="h-3.5 w-3.5" />
                {tWork("edit")}
              </button>
            </div>
          </div>
        ))}
      </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        {actionMessage ? (
          <div
            role={actionMessage.type === "error" ? "alert" : "status"}
            className={`mb-3 rounded-md border p-2 text-sm ${
              actionMessage.type === "success"
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {actionMessage.text}
          </div>
        ) : null}
        {formMode ? (
          <form onSubmit={submitAgent} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{formMode === "edit" ? tWork("agents.editTitle") : tWork("agents.add")}</h2>
                {editingAgent ? <p className="mt-1 text-xs text-neutral-500">{editingAgent.name}</p> : null}
              </div>
              <button
                type="button"
                className="rounded-md border border-neutral-300 p-2 text-neutral-600 hover:bg-neutral-50"
                onClick={() => setFormMode(null)}
                aria-label={tWork("closeForm")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {formError ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{formError}</div> : null}
            {formMode === "create" ? (
              <label className="block">
                <span className="text-sm font-medium">{tWork("user")}</span>
                <select
                  className="mt-1 h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm"
                  value={agentForm.userId}
                  onChange={(event) => setAgentForm((current) => ({ ...current, userId: event.target.value }))}
                >
                  <option value="">{tWork("agents.selectUser")}</option>
                  {userCandidates.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}{user.employeeCode ? ` (${user.employeeCode})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="block">
              <span className="text-sm font-medium">{tWork("team")}</span>
              <select
                className="mt-1 h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm"
                value={agentForm.teamId}
                onChange={(event) => setAgentForm((current) => ({ ...current, teamId: event.target.value }))}
              >
                <option value="">{tWork("noTeam")}</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">{tWork("phone")}</span>
              <input
                className="mt-1 h-10 w-full rounded-md border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-900"
                value={agentForm.phone}
                onChange={(event) => setAgentForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="+994..."
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="inline-flex h-10 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-50"
                onClick={() => setFormMode(null)}
              >
                <X className="h-4 w-4" />
                {tWork("close")}
              </button>
              <button
                type="submit"
                className="inline-flex h-10 items-center gap-1 rounded-md bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saving}
              >
                <Save className="h-4 w-4" />
                {saving ? tWork("saving") : tWork("save")}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <h2 className="text-lg font-semibold">{tWork("agents.management")}</h2>
            <div className="mt-3 space-y-2 text-sm text-neutral-600">
              <div className="rounded-md bg-neutral-50 p-2">{tWork("agents.userHint")}</div>
              <div className="rounded-md bg-neutral-50 p-2">{tWork("agents.editHint")}</div>
              {userCandidates.length === 0 ? (
                <div className="rounded-md bg-amber-50 p-2 text-amber-700">{tWork("agents.noCandidates")}</div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function LeaderboardView({ agents }: { agents: LeaderboardItem[] }) {
  const tWork = useTranslations("fieldForce.workspace")
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <h2 className="text-lg font-semibold">{tWork("leaderboard.title")}</h2>
        <div className="mt-3 space-y-2">
          {agents.map((agent, index) => (
            <div key={agent.id} className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${index < 3 ? "bg-neutral-900 text-white" : "bg-white text-neutral-700"}`}>
                {index + 1}
              </div>
              <div className="min-w-0">
                <div className="truncate font-semibold">{agent.name}</div>
                <div className="truncate text-xs text-neutral-500">{agent.team?.name ?? tWork("noTeam")} · {tWork(`fieldStatus.${agent.fieldStatus}`)}</div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-neutral-600">
                  <span>{tWork("leaderboard.visits", { count: agent.completedVisitsToday })}</span>
                  <span className="font-semibold">{tWork("leaderboard.points", { count: agent.score })}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <h3 className="font-semibold">{tWork("leaderboard.how")}</h3>
        <div className="mt-3 space-y-2 text-sm text-neutral-600">
          <div className="rounded-md bg-neutral-50 p-2">{tWork("leaderboard.ruleVisit")}</div>
          <div className="rounded-md bg-neutral-50 p-2">{tWork("leaderboard.ruleCompletion")}</div>
          <div className="rounded-md bg-neutral-50 p-2">{tWork("leaderboard.ruleOnline")}</div>
          <div className="rounded-md bg-neutral-50 p-2">{tWork("leaderboard.ruleLate")}</div>
        </div>
      </div>
    </section>
  )
}

function ActivityView({ events }: { events: LiveEvent[] }) {
  const tWork = useTranslations("fieldForce.workspace")
  const locale = useLocale()
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{tWork("activity.title")}</h2>
          <p className="mt-1 text-sm text-neutral-500">{tWork("activity.subtitle")}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs text-red-600">
          <Radio className="h-3 w-3 animate-pulse" />
          live
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {events.length === 0 ? <div className="rounded-lg bg-neutral-50 p-6 text-center text-sm text-neutral-500">{tWork("activity.empty")}</div> : null}
        {events.map((event) => (
          <div key={event.id} className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3 text-sm sm:grid-cols-[120px_minmax(0,1fr)_180px]">
            <div className="text-xs text-neutral-500">{formatLocaleDate(event.time, locale, { timeStyle: "short" })}</div>
            <div className="min-w-0">
              <div className="truncate font-medium">{event.agent}</div>
              <div className="truncate text-xs text-neutral-500">{event.customer}</div>
            </div>
            <div className="col-span-2 text-left text-xs font-medium text-neutral-600 sm:col-span-1 sm:text-right">{event.type}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ReportsView({ report, routes, agents }: { report: ReportShape; routes: RouteItem[]; agents: AgentItem[] }) {
  const tWork = useTranslations("fieldForce.workspace")
  return (
    <section className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label={tWork("reports.routes")} value={report.totalRoutes} icon={<Route className="h-4 w-4" />} />
        <MetricCard label={tWork("reports.completion")} value={`${report.completion}%`} icon={<CheckCircle2 className="h-4 w-4" />} />
        <MetricCard label={tWork("reports.onlineAgents")} value={`${report.onlineAgents}/${agents.length}`} icon={<Users className="h-4 w-4" />} />
        <MetricCard label={tWork("reports.late")} value={report.lateAgents} icon={<SlidersHorizontal className="h-4 w-4" />} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <h2 className="text-lg font-semibold">{tWork("reports.routeSummary")}</h2>
          <div className="mt-3 grid gap-2">
            {routes.map((route) => (
              <div key={route.id} className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{route.name}</div>
                    <div className="truncate text-xs text-neutral-500">{route.agent?.name ?? tWork("unassigned")}</div>
                  </div>
                  <div className="text-right text-sm font-semibold">{percent(route.visitedPoints, route.totalPoints)}%</div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                  <div className="h-full rounded-full bg-neutral-900" style={{ width: `${percent(route.visitedPoints, route.totalPoints)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <h2 className="text-lg font-semibold">{tWork("reports.agentSummary")}</h2>
          <div className="mt-3 grid gap-2">
            {agents.map((agent) => (
              <div key={agent.id} className="grid grid-cols-[minmax(0,1fr)_90px_90px] items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{agent.name}</div>
                  <div className="truncate text-xs text-neutral-500">{agent.team?.name ?? tWork("noTeam")}</div>
                </div>
                <div>{agent.completedVisitsToday}/{agent.visitsToday}</div>
                <div className="text-right font-semibold">{agent.routeCompletion}%</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function SettingsView({
  settings,
  savedAt,
  saving,
  actionMessage,
  onChange,
  onSave,
}: {
  settings: SettingsState
  savedAt: Date | null
  saving: boolean
  actionMessage: ActionMessage | null
  onChange: (settings: SettingsState) => void
  onSave: () => Promise<void>
}) {
  const tWork = useTranslations("fieldForce.workspace")
  const locale = useLocale()
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <h2 className="text-lg font-semibold">{tWork("settings.title")}</h2>
        <p className="mt-1 text-sm text-neutral-500">
          {tWork("settings.subtitle")}
        </p>
        {actionMessage ? (
          <div
            role={actionMessage.type === "error" ? "alert" : "status"}
            className={`mt-3 rounded-md border p-2 text-sm ${
              actionMessage.type === "success"
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {actionMessage.text}
          </div>
        ) : null}
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <NumberSetting
            label={tWork("settings.gps")}
            value={settings.gpsRefreshSeconds}
            min={5}
            max={120}
            onChange={(value) => onChange({ ...settings, gpsRefreshSeconds: value })}
          />
          <NumberSetting
            label={tWork("settings.geofence")}
            value={settings.geofenceRadiusM}
            min={30}
            max={1000}
            onChange={(value) => onChange({ ...settings, geofenceRadiusM: value })}
          />
          <NumberSetting
            label={tWork("settings.offlineAfter")}
            value={settings.offlineAfterMinutes}
            min={5}
            max={240}
            onChange={(value) => onChange({ ...settings, offlineAfterMinutes: value })}
          />
        </div>
        <div className="mt-4 grid gap-2">
          <ToggleSetting
            label={tWork("settings.requirePhoto")}
            checked={settings.requirePhotoProof}
            onChange={(checked) => onChange({ ...settings, requirePhotoProof: checked })}
          />
          <ToggleSetting
            label={tWork("settings.requireScan")}
            checked={settings.requireShelfScan}
            onChange={(checked) => onChange({ ...settings, requireShelfScan: checked })}
          />
          <ToggleSetting
            label={tWork("settings.alertLate")}
            checked={settings.alertLateVisits}
            onChange={(checked) => onChange({ ...settings, alertLateVisits: checked })}
          />
        </div>
        <button
          className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? tWork("saving") : tWork("settings.save")}
        </button>
      </div>
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <h3 className="font-semibold">{tWork("settings.connected")}</h3>
        <div className="mt-3 space-y-2 text-sm text-neutral-600">
          <div className="rounded-md bg-neutral-50 p-2">{tWork("settings.connectedMap")}</div>
          <div className="rounded-md bg-neutral-50 p-2">{tWork("settings.connectedApi")}</div>
          <div className="rounded-md bg-neutral-50 p-2">{tWork("settings.connectedOffline")}</div>
          {savedAt ? <div className="rounded-md bg-green-50 p-2 text-green-700">{tWork("settings.savedAt", { value: formatLocaleDate(savedAt, locale, { timeStyle: "short" }) })}</div> : null}
        </div>
      </div>
    </section>
  )
}

function MetricCard({ label, value, icon }: { label: string; value: string | number; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase text-neutral-500">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-semibold text-neutral-900">{value}</div>
    </div>
  )
}

function NumberSetting({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <label className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <span className="text-sm font-medium">{label}</span>
      <input
        className="mt-2 h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function ToggleSetting({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
      <span className="font-medium">{label}</span>
      <input className="h-4 w-4" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}
