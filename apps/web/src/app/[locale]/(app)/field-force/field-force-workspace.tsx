"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  Download,
  FileText,
  Map,
  Radio,
  RefreshCw,
  Route,
  Search,
  Settings,
  SlidersHorizontal,
  Trophy,
  Users,
} from "lucide-react"
import { FieldForceDashboard } from "./field-force-dashboard"

type ViewKey = "map" | "routes" | "agents" | "leaderboard" | "activity" | "reports" | "settings"

interface RoutePoint {
  id: string
  customerId: string
  orderIndex: number
  status: "VISITED" | "SKIPPED" | "PENDING"
  plannedTime: string | null
  visitedAt: string | null
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

const TABS: Array<{ key: ViewKey; label: string; description: string; Icon: typeof Map }> = [
  { key: "map", label: "Карта", description: "живое движение", Icon: Map },
  { key: "routes", label: "Маршруты", description: "точки и выполнение", Icon: Route },
  { key: "agents", label: "Агенты", description: "команды и статусы", Icon: Users },
  { key: "leaderboard", label: "Лидерборд", description: "рейтинг исполнения", Icon: Trophy },
  { key: "activity", label: "Активность", description: "события визитов", Icon: Activity },
  { key: "reports", label: "Отчеты", description: "дневная сводка", Icon: FileText },
  { key: "settings", label: "Настройки", description: "демо-политики", Icon: Settings },
]

const ROUTE_STATUS_LABELS: Record<RouteItem["status"], string> = {
  PLANNED: "Запланирован",
  IN_PROGRESS: "В работе",
  COMPLETED: "Завершен",
  CANCELLED: "Отменен",
}

const FIELD_STATUS_LABELS: Record<AgentItem["fieldStatus"], string> = {
  CHECKED_IN: "На точке",
  ON_ROAD: "В пути",
  LATE: "Опаздывает",
  OFFLINE: "Офлайн",
}

const DEFAULT_SETTINGS: SettingsState = {
  gpsRefreshSeconds: 15,
  geofenceRadiusM: 120,
  offlineAfterMinutes: 45,
  requirePhotoProof: true,
  requireShelfScan: true,
  alertLateVisits: true,
}

function formatDate(value: string | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("ru", options ?? { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
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

function readSettings() {
  if (typeof window === "undefined") return DEFAULT_SETTINGS
  const raw = window.localStorage.getItem("leadshelf.field-force.settings")
  if (!raw) return DEFAULT_SETTINGS
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as SettingsState
  } catch {
    return DEFAULT_SETTINGS
  }
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

export function FieldForceWorkspace() {
  const [activeView, setActiveView] = useState<ViewKey>("map")
  const [routes, setRoutes] = useState<RouteItem[]>([])
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [liveFeed, setLiveFeed] = useState<LiveEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)
  const [routeSearch, setRouteSearch] = useState("")
  const [agentSearch, setAgentSearch] = useState("")
  const [routeStatus, setRouteStatus] = useState<"ALL" | RouteItem["status"]>("ALL")
  const [agentStatus, setAgentStatus] = useState<"ALL" | AgentItem["fieldStatus"]>("ALL")
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsState>(() => readSettings())
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [routesRes, agentsRes, locationsRes] = await Promise.all([
        fetch("/api/v1/field-force/routes?limit=200", { cache: "no-store" }),
        fetch("/api/v1/field-force/agents?limit=200", { cache: "no-store" }),
        fetch("/api/v1/field-force/locations", { cache: "no-store" }),
      ])
      const [routesJson, agentsJson, locationsJson] = await Promise.all([
        routesRes.json(),
        agentsRes.json(),
        locationsRes.json(),
      ])
      if (!routesRes.ok || !routesJson.success) throw new Error("routes_failed")
      if (!agentsRes.ok || !agentsJson.success) throw new Error("agents_failed")
      if (!locationsRes.ok || !locationsJson.success) throw new Error("locations_failed")

      const nextRoutes = (routesJson.data?.routes ?? []) as RouteItem[]
      setRoutes(nextRoutes)
      setAgents((agentsJson.data?.agents ?? []) as AgentItem[])
      setLiveFeed((locationsJson.data?.liveFeed ?? []) as LiveEvent[])
      setSelectedRouteId((current) => current ?? nextRoutes[0]?.id ?? null)
      setLastLoadedAt(new Date())
    } catch {
      setError("Не удалось загрузить маршрутный модуль. Проверьте сессию и API field-force.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWorkspace()
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

  const report = useMemo(() => {
    const totalPoints = routes.reduce((sum, route) => sum + route.totalPoints, 0)
    const visitedPoints = routes.reduce((sum, route) => sum + route.visitedPoints, 0)
    return {
      totalRoutes: routes.length,
      inProgressRoutes: routes.filter((route) => route.status === "IN_PROGRESS").length,
      completedRoutes: routes.filter((route) => route.status === "COMPLETED").length,
      plannedRoutes: routes.filter((route) => route.status === "PLANNED").length,
      totalPoints,
      visitedPoints,
      completion: percent(visitedPoints, totalPoints),
      onlineAgents: agents.filter((agent) => agent.isOnline).length,
      lateAgents: agents.filter((agent) => agent.fieldStatus === "LATE").length,
    }
  }, [routes, agents])

  const leaderboard = useMemo(() => {
    return [...agents]
      .map((agent) => ({
        ...agent,
        score:
          agent.completedVisitsToday * 20 +
          agent.routeCompletion +
          (agent.isOnline ? 10 : 0) -
          (agent.fieldStatus === "LATE" ? 20 : 0),
      }))
      .sort((a, b) => b.score - a.score)
  }, [agents])

  const activityEvents = useMemo(() => {
    const routeEvents = routes.flatMap((route) =>
      route.points
        .filter((point) => point.visitedAt)
        .map((point) => ({
          id: `${route.id}-${point.id}`,
          type: point.status === "PENDING" ? "CHECK_IN" : point.status,
          agent: route.agent?.name ?? "Без агента",
          customer: point.customer.name,
          time: point.visitedAt!,
        })),
    )
    return [...liveFeed, ...routeEvents]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 50)
  }, [routes, liveFeed])

  const saveSettings = () => {
    window.localStorage.setItem("leadshelf.field-force.settings", JSON.stringify(settings))
    setSavedAt(new Date())
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Маршрутный модуль</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Карта, маршруты, агенты и контроль исполнения для полевой команды.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {lastLoadedAt ? (
              <span className="text-xs text-neutral-500">Обновлено {formatDate(lastLoadedAt.toISOString(), { timeStyle: "short" })}</span>
            ) : null}
            <button
              className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-800 hover:bg-neutral-50"
              onClick={loadWorkspace}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Обновить
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-4 xl:grid-cols-7">
          {TABS.map(({ key, label, description, Icon }) => {
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
                  <span className="text-sm font-semibold">{label}</span>
                </div>
                <div className={`mt-1 text-xs ${active ? "text-neutral-300" : "text-neutral-500"}`}>{description}</div>
              </button>
            )
          })}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      {activeView === "map" ? <FieldForceDashboard /> : null}
      {activeView === "routes" ? (
        <RoutesView
          filteredRoutes={filteredRoutes}
          routeSearch={routeSearch}
          routeStatus={routeStatus}
          selectedRoute={selectedRoute}
          loading={loading}
          onRouteSearch={setRouteSearch}
          onRouteStatus={setRouteStatus}
          onSelectRoute={setSelectedRouteId}
          onExport={() =>
            downloadCsv(
              "field-routes.csv",
              filteredRoutes.map((route) => ({
                route: route.name,
                agent: route.agent?.name ?? "",
                status: ROUTE_STATUS_LABELS[route.status],
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
          agentSearch={agentSearch}
          agentStatus={agentStatus}
          loading={loading}
          onAgentSearch={setAgentSearch}
          onAgentStatus={setAgentStatus}
          onExport={() =>
            downloadCsv(
              "field-agents.csv",
              filteredAgents.map((agent) => ({
                agent: agent.name,
                email: agent.email ?? "",
                team: agent.team?.name ?? "",
                status: FIELD_STATUS_LABELS[agent.fieldStatus],
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
        <SettingsView settings={settings} savedAt={savedAt} onChange={setSettings} onSave={saveSettings} />
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
  routeSearch,
  routeStatus,
  selectedRoute,
  loading,
  onRouteSearch,
  onRouteStatus,
  onSelectRoute,
  onExport,
}: {
  filteredRoutes: RouteItem[]
  routeSearch: string
  routeStatus: "ALL" | RouteItem["status"]
  selectedRoute: RouteItem | null
  loading: boolean
  onRouteSearch: (value: string) => void
  onRouteStatus: (value: "ALL" | RouteItem["status"]) => void
  onSelectRoute: (id: string) => void
  onExport: () => void
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToolbarSearch value={routeSearch} placeholder="Найти маршрут, агента или торговую точку" onChange={onRouteSearch} />
          <select
            className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm"
            value={routeStatus}
            onChange={(event) => onRouteStatus(event.target.value as "ALL" | RouteItem["status"])}
          >
            <option value="ALL">Все статусы</option>
            <option value="PLANNED">Запланирован</option>
            <option value="IN_PROGRESS">В работе</option>
            <option value="COMPLETED">Завершен</option>
            <option value="CANCELLED">Отменен</option>
          </select>
          <button
            className="inline-flex h-10 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-50"
            onClick={onExport}
          >
            <Download className="h-4 w-4" />
            CSV
          </button>
        </div>

        <div className="mt-3 grid gap-2">
          {loading ? <div className="rounded-lg bg-neutral-50 p-6 text-center text-sm text-neutral-500">Загрузка маршрутов...</div> : null}
          {!loading && filteredRoutes.length === 0 ? (
            <div className="rounded-lg bg-neutral-50 p-6 text-center text-sm text-neutral-500">Маршруты под фильтр не найдены.</div>
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
                        {formatDate(route.date, { dateStyle: "medium" })}
                      </span>
                      <span>{route.agent?.name ?? "Без агента"}</span>
                    </div>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-xs font-medium ${routeStatusClass(route.status)}`}>
                    {ROUTE_STATUS_LABELS[route.status]}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full rounded-full bg-neutral-900" style={{ width: `${completion}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-xs text-neutral-500">
                  <span>{route.visitedPoints}/{route.totalPoints} точек</span>
                  <span>{completion}%</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <h2 className="text-lg font-semibold">Детали маршрута</h2>
        {selectedRoute ? (
          <div className="mt-3 space-y-3">
            <div>
              <div className="text-sm font-semibold">{selectedRoute.name}</div>
              <div className="mt-1 text-xs text-neutral-500">
                {selectedRoute.agent?.name ?? "Без агента"} · {ROUTE_STATUS_LABELS[selectedRoute.status]}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MetricCard label="Точки" value={selectedRoute.totalPoints} />
              <MetricCard label="Выполнено" value={selectedRoute.visitedPoints} />
              <MetricCard label="Прогресс" value={`${percent(selectedRoute.visitedPoints, selectedRoute.totalPoints)}%`} />
            </div>
            <div className="space-y-2">
              {selectedRoute.points.map((point) => (
                <div key={point.id} className="flex gap-2 rounded-lg border border-neutral-100 bg-neutral-50 p-2">
                  <div className={`mt-1 h-2.5 w-2.5 rounded-full ${point.status === "VISITED" ? "bg-green-500" : point.status === "SKIPPED" ? "bg-neutral-400" : "bg-amber-400"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{point.orderIndex + 1}. {point.customer.name}</div>
                    <div className="mt-0.5 truncate text-xs text-neutral-500">{point.customer.address ?? "Адрес не указан"}</div>
                  </div>
                  <div className="text-right text-xs text-neutral-500">
                    {point.visitedAt ? formatDate(point.visitedAt, { timeStyle: "short" }) : point.plannedTime ? formatDate(point.plannedTime, { timeStyle: "short" }) : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-lg bg-neutral-50 p-6 text-center text-sm text-neutral-500">Выберите маршрут слева.</div>
        )}
      </div>
    </section>
  )
}

function AgentsView({
  agents,
  agentSearch,
  agentStatus,
  loading,
  onAgentSearch,
  onAgentStatus,
  onExport,
}: {
  agents: AgentItem[]
  agentSearch: string
  agentStatus: "ALL" | AgentItem["fieldStatus"]
  loading: boolean
  onAgentSearch: (value: string) => void
  onAgentStatus: (value: "ALL" | AgentItem["fieldStatus"]) => void
  onExport: () => void
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarSearch value={agentSearch} placeholder="Найти агента, команду или код" onChange={onAgentSearch} />
        <select
          className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm"
          value={agentStatus}
          onChange={(event) => onAgentStatus(event.target.value as "ALL" | AgentItem["fieldStatus"])}
        >
          <option value="ALL">Все статусы</option>
          <option value="CHECKED_IN">На точке</option>
          <option value="ON_ROAD">В пути</option>
          <option value="LATE">Опаздывает</option>
          <option value="OFFLINE">Офлайн</option>
        </select>
        <button
          className="inline-flex h-10 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-50"
          onClick={onExport}
        >
          <Download className="h-4 w-4" />
          CSV
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200">
        <div className="grid grid-cols-[minmax(220px,1.2fr)_1fr_130px_130px_130px] bg-neutral-50 px-3 py-2 text-xs font-semibold uppercase text-neutral-500">
          <div>Агент</div>
          <div>Команда</div>
          <div>Статус</div>
          <div>Визиты</div>
          <div>Прогресс</div>
        </div>
        {loading ? <div className="p-6 text-center text-sm text-neutral-500">Загрузка агентов...</div> : null}
        {!loading && agents.length === 0 ? <div className="p-6 text-center text-sm text-neutral-500">Агенты под фильтр не найдены.</div> : null}
        {agents.map((agent) => (
          <div key={agent.id} className="grid grid-cols-[minmax(220px,1.2fr)_1fr_130px_130px_130px] items-center border-t border-neutral-100 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{agent.name}</div>
              <div className="truncate text-xs text-neutral-500">{agent.email ?? agent.employeeCode ?? "Без email"}</div>
            </div>
            <div className="truncate text-neutral-600">{agent.team?.name ?? "Без команды"}</div>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${fieldStatusClass(agent.fieldStatus)}`} />
              <span>{FIELD_STATUS_LABELS[agent.fieldStatus]}</span>
            </div>
            <div>{agent.completedVisitsToday}/{agent.visitsToday}</div>
            <div>{agent.routeCompletion}%</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function LeaderboardView({ agents }: { agents: Array<AgentItem & { score: number }> }) {
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <h2 className="text-lg font-semibold">Лидерборд исполнения</h2>
        <div className="mt-3 space-y-2">
          {agents.map((agent, index) => (
            <div key={agent.id} className="grid grid-cols-[48px_minmax(0,1fr)_120px_120px] items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${index < 3 ? "bg-neutral-900 text-white" : "bg-white text-neutral-700"}`}>
                {index + 1}
              </div>
              <div className="min-w-0">
                <div className="truncate font-semibold">{agent.name}</div>
                <div className="truncate text-xs text-neutral-500">{agent.team?.name ?? "Без команды"} · {FIELD_STATUS_LABELS[agent.fieldStatus]}</div>
              </div>
              <div className="text-sm">
                <div className="font-semibold">{agent.completedVisitsToday}</div>
                <div className="text-xs text-neutral-500">визитов</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold">{agent.score}</div>
                <div className="text-xs text-neutral-500">баллов</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <h3 className="font-semibold">Как считается рейтинг</h3>
        <div className="mt-3 space-y-2 text-sm text-neutral-600">
          <div className="rounded-md bg-neutral-50 p-2">+20 баллов за завершенный визит сегодня.</div>
          <div className="rounded-md bg-neutral-50 p-2">+процент выполнения активных точек.</div>
          <div className="rounded-md bg-neutral-50 p-2">+10 баллов, если агент онлайн.</div>
          <div className="rounded-md bg-neutral-50 p-2">-20 баллов, если есть просроченная точка.</div>
        </div>
      </div>
    </section>
  )
}

function ActivityView({ events }: { events: LiveEvent[] }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Журнал активности</h2>
          <p className="mt-1 text-sm text-neutral-500">Последние check-in, check-out и события маршрутов.</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs text-red-600">
          <Radio className="h-3 w-3 animate-pulse" />
          live
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {events.length === 0 ? <div className="rounded-lg bg-neutral-50 p-6 text-center text-sm text-neutral-500">Событий пока нет.</div> : null}
        {events.map((event) => (
          <div key={event.id} className="grid grid-cols-[120px_minmax(0,1fr)_180px] items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3 text-sm">
            <div className="text-xs text-neutral-500">{formatDate(event.time, { timeStyle: "short" })}</div>
            <div className="min-w-0">
              <div className="truncate font-medium">{event.agent}</div>
              <div className="truncate text-xs text-neutral-500">{event.customer}</div>
            </div>
            <div className="text-right text-xs font-medium text-neutral-600">{event.type}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ReportsView({ report, routes, agents }: { report: ReturnType<typeof useReportShape>; routes: RouteItem[]; agents: AgentItem[] }) {
  return (
    <section className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Маршруты" value={report.totalRoutes} icon={<Route className="h-4 w-4" />} />
        <MetricCard label="Выполнение точек" value={`${report.completion}%`} icon={<CheckCircle2 className="h-4 w-4" />} />
        <MetricCard label="Агенты онлайн" value={`${report.onlineAgents}/${agents.length}`} icon={<Users className="h-4 w-4" />} />
        <MetricCard label="Опоздания" value={report.lateAgents} icon={<SlidersHorizontal className="h-4 w-4" />} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <h2 className="text-lg font-semibold">Сводка по маршрутам</h2>
          <div className="mt-3 grid gap-2">
            {routes.map((route) => (
              <div key={route.id} className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{route.name}</div>
                    <div className="truncate text-xs text-neutral-500">{route.agent?.name ?? "Без агента"}</div>
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
          <h2 className="text-lg font-semibold">Сводка по агентам</h2>
          <div className="mt-3 grid gap-2">
            {agents.map((agent) => (
              <div key={agent.id} className="grid grid-cols-[minmax(0,1fr)_90px_90px] items-center gap-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{agent.name}</div>
                  <div className="truncate text-xs text-neutral-500">{agent.team?.name ?? "Без команды"}</div>
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

function useReportShape() {
  return {
    totalRoutes: 0,
    inProgressRoutes: 0,
    completedRoutes: 0,
    plannedRoutes: 0,
    totalPoints: 0,
    visitedPoints: 0,
    completion: 0,
    onlineAgents: 0,
    lateAgents: 0,
  }
}

function SettingsView({
  settings,
  savedAt,
  onChange,
  onSave,
}: {
  settings: SettingsState
  savedAt: Date | null
  onChange: (settings: SettingsState) => void
  onSave: () => void
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <h2 className="text-lg font-semibold">Настройки маршрутов</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Это локальные демо-настройки интерфейса. Серверные политики появятся отдельной моделью настроек.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <NumberSetting
            label="GPS refresh, сек"
            value={settings.gpsRefreshSeconds}
            min={5}
            max={120}
            onChange={(value) => onChange({ ...settings, gpsRefreshSeconds: value })}
          />
          <NumberSetting
            label="Радиус геозоны, м"
            value={settings.geofenceRadiusM}
            min={30}
            max={1000}
            onChange={(value) => onChange({ ...settings, geofenceRadiusM: value })}
          />
          <NumberSetting
            label="Офлайн после, мин"
            value={settings.offlineAfterMinutes}
            min={5}
            max={240}
            onChange={(value) => onChange({ ...settings, offlineAfterMinutes: value })}
          />
        </div>
        <div className="mt-4 grid gap-2">
          <ToggleSetting
            label="Требовать фото-подтверждение визита"
            checked={settings.requirePhotoProof}
            onChange={(checked) => onChange({ ...settings, requirePhotoProof: checked })}
          />
          <ToggleSetting
            label="Требовать сканирование полки в мобильном приложении"
            checked={settings.requireShelfScan}
            onChange={(checked) => onChange({ ...settings, requireShelfScan: checked })}
          />
          <ToggleSetting
            label="Подсвечивать просроченные визиты"
            checked={settings.alertLateVisits}
            onChange={(checked) => onChange({ ...settings, alertLateVisits: checked })}
          />
        </div>
        <button className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700" onClick={onSave}>
          Сохранить демо-настройки
        </button>
      </div>
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <h3 className="font-semibold">Что уже подключено</h3>
        <div className="mt-3 space-y-2 text-sm text-neutral-600">
          <div className="rounded-md bg-neutral-50 p-2">Карта агентов и маршрутов работает через LeadShelf API.</div>
          <div className="rounded-md bg-neutral-50 p-2">Маршруты, агенты, активность и отчеты читают реальные demo-data.</div>
          <div className="rounded-md bg-neutral-50 p-2">Настройки пока сохраняются в браузере для демо.</div>
          {savedAt ? <div className="rounded-md bg-green-50 p-2 text-green-700">Сохранено {formatDate(savedAt.toISOString(), { timeStyle: "short" })}</div> : null}
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
