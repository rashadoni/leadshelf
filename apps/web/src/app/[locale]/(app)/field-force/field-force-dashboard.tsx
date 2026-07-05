"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import {
  AlertTriangle,
  Circle,
  Clock,
  Eye,
  EyeOff,
  Flame,
  MapPin,
  Navigation,
  Play,
  Radio,
  RefreshCw,
  WifiOff,
} from "lucide-react"
import type { RouteStop } from "@/components/field-force/live-map"
import type { MtmDashboardAgent as AgentLocation } from "@/components/field-force/mtm-types"
import { FIELD_STATUS_LABEL_KEYS } from "@/components/field-force/mtm-types"

const FieldForceLiveMap = dynamic(
  () => import("@/components/field-force/live-map").then((mod) => mod.FieldForceLiveMap),
  { ssr: false },
)

interface LiveEvent {
  id: string
  type: string
  agent: string
  customer: string
  time: string
}

const STATUS_DOT_CLASS: Record<string, string> = {
  CHECKED_IN: "bg-green-500",
  ON_ROAD: "bg-blue-500",
  LATE: "bg-red-500",
  OFFLINE: "bg-neutral-400",
}

const STATUS_LABELS: Record<string, string> = {
  CHECKED_IN: "На точке",
  ON_ROAD: "В пути",
  LATE: "Опаздывает",
  OFFLINE: "Офлайн",
}

const statusConfig: Record<string, { labelKey: string; dotClass: string }> = Object.fromEntries(
  Object.entries(FIELD_STATUS_LABEL_KEYS).map(([key, labelKey]) => [
    key,
    { labelKey, dotClass: STATUS_DOT_CLASS[key] || "bg-neutral-400" },
  ]),
)
const FALLBACK_STATUS_CONFIG = { labelKey: "offline", dotClass: "bg-neutral-400" }

function formatDateTime(value: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("ru", options ?? { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusM = 6371000
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatLocalDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function pickDisplayRoute(routes: any[]) {
  if (!routes.length) return null
  return (
    routes.find((route) => route.status === "IN_PROGRESS") ??
    routes.find((route) => route.status === "PLANNED") ??
    routes.find((route) => route.status === "COMPLETED") ??
    routes[0]
  )
}

export function FieldForceDashboard() {
  const [agents, setAgents] = useState<AgentLocation[]>([])
  const [statusCounts, setStatusCounts] = useState({ total: 0, checkedIn: 0, onRoad: 0, late: 0, offline: 0 })
  const [liveFeed, setLiveFeed] = useState<LiveEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [activeFilter, setActiveFilter] = useState("all")
  const [showFeed, setShowFeed] = useState(true)
  const [replayAgent, setReplayAgent] = useState<string | null>(null)
  const [replayTrack, setReplayTrack] = useState<any[]>([])
  const [showGeofence, setShowGeofence] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [agentRoute, setAgentRoute] = useState<any>(null)
  const selectedAgentRef = useRef<string | null>(null)

  useEffect(() => {
    selectedAgentRef.current = selectedAgent
  }, [selectedAgent])

  const fetchAgentRoute = useCallback(async (agentId: string) => {
    try {
      const today = formatLocalDate(new Date())
      const res = await fetch(`/api/v1/field-force/routes?agentId=${agentId}&date=${today}`)
      const json = await res.json()
      if (json.success && json.data?.routes?.length > 0) {
        setAgentRoute(pickDisplayRoute(json.data.routes))
      } else {
        const fallbackRes = await fetch(`/api/v1/field-force/routes?agentId=${agentId}&limit=10`)
        const fallbackJson = await fallbackRes.json()
        setAgentRoute(fallbackJson.success ? pickDisplayRoute(fallbackJson.data?.routes ?? []) : null)
      }
    } catch {
      setAgentRoute(null)
    }
  }, [])

  const fetchLocations = useCallback(() => {
    fetch("/api/v1/field-force/locations")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) {
          setAgents(json.data.agentLocations || [])
          setStatusCounts(json.data.statusCounts || { total: 0, checkedIn: 0, onRoad: 0, late: 0, offline: 0 })
          setLiveFeed(json.data.liveFeed || [])
          setLastUpdate(new Date())
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false)
        if (selectedAgentRef.current) fetchAgentRoute(selectedAgentRef.current)
      })
  }, [fetchAgentRoute])

  useEffect(() => {
    fetchLocations()
    const interval = setInterval(fetchLocations, 15000)
    return () => clearInterval(interval)
  }, [fetchLocations])

  const handleReplay = async (agentId: string) => {
    try {
      const res = await fetch(`/api/v1/field-force/locations?agentId=${agentId}`)
      const json = await res.json()
      if (!res.ok || !json.success) return
      setReplayAgent(agentId)
      setReplayTrack(json.data.locations || [])
    } catch {}
  }

  const handleAgentClick = (agentId: string) => {
    if (selectedAgent === agentId) {
      setSelectedAgent(null)
      setAgentRoute(null)
      setReplayAgent(null)
      setReplayTrack([])
    } else {
      setSelectedAgent(agentId)
      fetchAgentRoute(agentId)
      handleReplay(agentId)
    }
  }

  const filteredAgents = agents.filter((agent) => {
    if (activeFilter === "all") return true
    if (activeFilter === "checked_in") return agent.fieldStatus === "CHECKED_IN"
    if (activeFilter === "on_road") return agent.fieldStatus === "ON_ROAD"
    if (activeFilter === "late") return agent.fieldStatus === "LATE"
    if (activeFilter === "offline") return agent.fieldStatus === "OFFLINE"
    return true
  })

  const mapAgents = filteredAgents.filter((agent) => agent.latitude != null && agent.longitude != null) as Array<
    (typeof filteredAgents)[number] & { latitude: number; longitude: number; recordedAt: string }
  >

  const routeStops: RouteStop[] = useMemo(() => {
    if (!agentRoute?.points) return []
    const points = [...agentRoute.points].sort((a: any, b: any) => a.orderIndex - b.orderIndex)
    const firstPendingIdx = points.findIndex((point: any) => point.status === "PENDING")
    return points
      .filter((point: any) => point.customer?.latitude != null && point.customer?.longitude != null)
      .map((point: any) => ({
        orderIndex: point.orderIndex,
        status:
          point.status === "VISITED"
            ? ("VISITED" as const)
            : point.status === "SKIPPED"
              ? ("SKIPPED" as const)
              : point.orderIndex === firstPendingIdx
                ? ("NEXT" as const)
                : ("PENDING" as const),
        latitude: point.customer.latitude,
        longitude: point.customer.longitude,
        name: point.customer.name,
        address: point.customer.address,
        visitedAt: point.visitedAt,
      }))
  }, [agentRoute])

  const etaSeconds = useMemo(() => {
    if (!selectedAgent || !routeStops.length) return null
    const nextStop = routeStops.find((stop) => stop.status === "NEXT")
    if (!nextStop) return null
    const agent = agents.find((item) => item.agentId === selectedAgent)
    if (!agent?.latitude || !agent?.longitude) return null
    const distMeters = calculateDistance(agent.latitude, agent.longitude, nextStop.latitude, nextStop.longitude)
    const speedKmh = agent.speed && agent.speed > 2 ? agent.speed : 30
    return Math.round((distMeters / 1000 / speedKmh) * 3600)
  }, [selectedAgent, routeStops, agents])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Полевая команда</h1>
          <p className="mt-1 text-sm text-neutral-500">Живая карта маршрутов, агентов и визитов.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {lastUpdate ? (
            <span className="flex items-center gap-1 text-xs text-neutral-500">
              <Clock className="h-3 w-3" /> Обновлено: {formatDateTime(lastUpdate, { timeStyle: "short" })}
            </span>
          ) : null}
          <button
            className={`inline-flex items-center rounded-md border px-2.5 py-1.5 text-sm ${showGeofence ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-800"}`}
            onClick={() => setShowGeofence(!showGeofence)}
          >
            <Circle className="mr-1 h-3.5 w-3.5" /> Геозона
          </button>
          <button
            className={`inline-flex items-center rounded-md border px-2.5 py-1.5 text-sm ${showHeatmap ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-800"}`}
            onClick={() => setShowHeatmap(!showHeatmap)}
          >
            <Flame className="mr-1 h-3.5 w-3.5" /> Тепловая карта
          </button>
          <button className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-800" onClick={fetchLocations}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Обновить
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button className={`rounded-md px-3 py-1.5 text-sm ${activeFilter === "all" ? "bg-neutral-900 text-white" : "border border-neutral-300 bg-white"}`} onClick={() => setActiveFilter("all")}>
          Все ({statusCounts.total})
        </button>
        <button className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm ${activeFilter === "checked_in" ? "bg-neutral-900 text-white" : "border border-green-200 bg-white text-green-700"}`} onClick={() => setActiveFilter("checked_in")}>
          <MapPin className="mr-1 h-3 w-3" /> На точке ({statusCounts.checkedIn})
        </button>
        <button className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm ${activeFilter === "on_road" ? "bg-neutral-900 text-white" : "border border-blue-200 bg-white text-blue-700"}`} onClick={() => setActiveFilter("on_road")}>
          <Navigation className="mr-1 h-3 w-3" /> В пути ({statusCounts.onRoad})
        </button>
        <button className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm ${activeFilter === "late" ? "bg-neutral-900 text-white" : "border border-red-200 bg-white text-red-700"}`} onClick={() => setActiveFilter("late")}>
          <AlertTriangle className="mr-1 h-3 w-3" /> Опаздывает ({statusCounts.late})
        </button>
        <button className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm ${activeFilter === "offline" ? "bg-neutral-900 text-white" : "border border-neutral-300 bg-white text-neutral-600"}`} onClick={() => setActiveFilter("offline")}>
          <WifiOff className="mr-1 h-3 w-3" /> Офлайн ({statusCounts.offline})
        </button>
      </div>

      <div className="flex gap-3" style={{ height: "calc(100vh - 280px)", minHeight: 400 }}>
        <div className="relative flex-1 overflow-hidden rounded-lg border border-neutral-200 bg-white" style={{ height: "calc(100vh - 280px)", minHeight: 400 }}>
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-neutral-500">Загрузка карты...</div>
          ) : (
            <FieldForceLiveMap
              agents={mapAgents}
              replayTrack={replayAgent ? replayTrack : []}
              showGeofence={showGeofence}
              plannedRoute={routeStops}
              focusAgentId={selectedAgent}
              etaSeconds={etaSeconds}
            />
          )}
        </div>

        <aside className="w-[280px] flex-shrink-0 space-y-3 overflow-y-auto">
          <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase text-neutral-500">Статус</h4>
            <div className="space-y-2">
              {(["CHECKED_IN", "ON_ROAD", "LATE", "OFFLINE"] as const).map((status) => {
                const cfg = statusConfig[status] ?? FALLBACK_STATUS_CONFIG
                const count =
                  status === "CHECKED_IN"
                    ? statusCounts.checkedIn
                    : status === "ON_ROAD"
                      ? statusCounts.onRoad
                      : status === "LATE"
                        ? statusCounts.late
                        : statusCounts.offline
                return (
                  <div key={status} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${cfg.dotClass}`} />
                      <span className="text-xs">{STATUS_LABELS[status]}</span>
                    </div>
                    <span className="text-sm font-bold">{count}</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <h4 className="text-xs font-semibold uppercase text-neutral-500">Лента</h4>
                <span className="flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">
                  <Radio className="h-2 w-2 animate-pulse" /> live
                </span>
              </div>
              <button className="rounded p-1 text-neutral-500 hover:bg-neutral-100" onClick={() => setShowFeed(!showFeed)}>
                {showFeed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </div>
            {showFeed ? (
              liveFeed.length > 0 ? (
                <div className="max-h-[150px] space-y-1.5 overflow-y-auto">
                  {liveFeed.map((event) => (
                    <div key={event.id} className="flex items-start gap-1.5 text-[10px]">
                      <span className={`mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${event.type === "CHECK_IN" ? "bg-green-500" : event.type === "ALERT" ? "bg-red-500" : "bg-blue-500"}`} />
                      <div>
                        <span className="font-medium">{event.agent}</span>
                        <span className="text-neutral-500"> {event.type === "ALERT" ? "! " : "-> "}{event.customer}</span>
                        <div className="text-neutral-500">{formatDateTime(event.time, { timeStyle: "short" })}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-2 text-center text-[10px] text-neutral-500">Ждём события...</div>
              )
            ) : null}
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase text-neutral-500">Агенты ({filteredAgents.length})</h4>
            <div className="max-h-[300px] space-y-2 overflow-y-auto">
              {filteredAgents.length === 0 ? (
                <div className="py-4 text-center text-[10px] text-neutral-500">Нет агентов под фильтр</div>
              ) : (
                filteredAgents.map((agent) => {
                  const cfg = statusConfig[agent.fieldStatus] ?? statusConfig.OFFLINE ?? FALLBACK_STATUS_CONFIG
                  const isOnline = agent.fieldStatus !== "OFFLINE"
                  const isSelected = selectedAgent === agent.agentId
                  return (
                    <button
                      key={agent.agentId}
                      className={`flex w-full items-center gap-2 rounded-lg p-1 text-left transition-colors ${isSelected ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-neutral-50"}`}
                      onClick={() => handleAgentClick(agent.agentId)}
                    >
                      <span className={`relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${isOnline ? "bg-blue-500 text-white" : "bg-neutral-100 text-neutral-500"}`}>
                        {agent.name?.charAt(0)?.toUpperCase()}
                        {isOnline ? <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-green-500" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{agent.name}</span>
                        <span className="flex items-center gap-1.5 text-[10px]">
                          <span className={`inline-flex items-center gap-0.5 ${isOnline ? "font-medium text-green-600" : "text-neutral-500"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotClass}`} />
                            {STATUS_LABELS[agent.fieldStatus] ?? agent.fieldStatus}
                          </span>
                          {agent.speed != null && agent.speed > 0 ? <span className="text-neutral-500">{agent.speed.toFixed(0)} km/h</span> : null}
                          {agent.routeCompletion && agent.routeCompletion > 0 ? <span className="text-neutral-500">{agent.routeCompletion}%</span> : null}
                          {isSelected && etaSeconds != null && etaSeconds > 0 ? (
                            <span className="font-medium text-blue-600">ETA {etaSeconds < 60 ? "<1m" : etaSeconds < 3600 ? `${Math.round(etaSeconds / 60)}m` : `${(etaSeconds / 3600).toFixed(1)}h`}</span>
                          ) : null}
                        </span>
                      </span>
                      <Play className="h-3 w-3 flex-shrink-0 text-neutral-500" />
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </aside>
      </div>

      {replayAgent ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
          <Play className="h-3 w-3" />
          Replay: {agents.find((agent) => agent.agentId === replayAgent)?.name ?? ""}, точек: {replayTrack.length}
          <button className="ml-auto rounded px-2 py-1 hover:bg-amber-100" onClick={() => { setReplayAgent(null); setReplayTrack([]) }}>Закрыть</button>
        </div>
      ) : null}
    </div>
  )
}
