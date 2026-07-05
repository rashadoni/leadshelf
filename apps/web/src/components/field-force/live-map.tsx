"use client"

import "leaflet/dist/leaflet.css"
import { useEffect, useMemo, useRef, useState } from "react"
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet"
import L from "leaflet"
import type { LiveMapAgent, MtmFieldStatus } from "./mtm-types"
import { FIELD_STATUS_LABEL_KEYS } from "./mtm-types"

export interface RouteStop {
  orderIndex: number
  status: "VISITED" | "SKIPPED" | "NEXT" | "PENDING"
  latitude: number
  longitude: number
  name: string
  address?: string
  visitedAt?: string
}

interface Props {
  agents: LiveMapAgent[]
  replayTrack?: Array<{ latitude: number; longitude: number; recordedAt: string }>
  showGeofence?: boolean
  geofenceRadius?: number
  plannedRoute?: RouteStop[]
  focusAgentId?: string | null
  etaSeconds?: number | null
}

const statusColors: Record<string, string> = {
  CHECKED_IN: "#22c55e",
  ON_ROAD: "#3b82f6",
  LATE: "#ef4444",
  OFFLINE: "#94a3b8",
}

const statusLabelKeys = FIELD_STATUS_LABEL_KEYS

const routeStopColors: Record<string, string> = {
  VISITED: "#22c55e",
  SKIPPED: "#ef4444",
  NEXT: "#6C63FF",
  PENDING: "#94a3b8",
}

function isMtmFieldStatus(value: string): value is MtmFieldStatus {
  return value in FIELD_STATUS_LABEL_KEYS
}

function agentIcon(name: string, color: string, focused: boolean) {
  const size = focused ? 38 : 32
  const border = focused ? 3.5 : 2.5
  const initial = (name?.charAt(0) || "?").toUpperCase()
  return L.divIcon({
    className: "mtm-agent-marker",
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};border:${border}px solid white;
      display:flex;align-items:center;justify-content:center;
      font:700 14px system-ui,sans-serif;color:white;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
      cursor:pointer;transition:transform 0.2s;
    ">${initial}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function routeStopIcon(orderIndex: number, status: string) {
  const color = routeStopColors[status] || routeStopColors.PENDING
  const opacity = status === "VISITED" ? 0.5 : 1
  return L.divIcon({
    className: "mtm-route-stop-marker",
    html: `<div style="
      width:22px;height:22px;border-radius:50%;
      background:${color};border:2px solid white;opacity:${opacity};
      display:flex;align-items:center;justify-content:center;
      font:700 10px system-ui,sans-serif;color:white;
      box-shadow:0 1px 4px rgba(0,0,0,0.25);
    ">${orderIndex + 1}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

function InvalidateSize() {
  const map = useMap()
  useEffect(() => {
    const t1 = setTimeout(() => map.invalidateSize(), 100)
    const t2 = setTimeout(() => map.invalidateSize(), 500)
    const t3 = setTimeout(() => map.invalidateSize(), 1500)
    const parent = map.getContainer()?.parentElement
    let observer: ResizeObserver | null = null
    if (parent && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => map.invalidateSize())
      observer.observe(parent)
    }
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      observer?.disconnect()
    }
  }, [map])
  return null
}

function FitBounds({
  agents,
  plannedRoute,
  focusAgentId,
}: {
  agents: LiveMapAgent[]
  plannedRoute: RouteStop[]
  focusAgentId: string | null
}) {
  const map = useMap()
  const lastFitRef = useRef("")
  useEffect(() => {
    const selectedAgent = focusAgentId ? agents.find((agent) => agent.agentId === focusAgentId) : null
    const agentsForBounds = plannedRoute.length > 0 && selectedAgent ? [selectedAgent] : agents
    const points: L.LatLngTuple[] = [
      ...agentsForBounds.map((a) => [a.latitude, a.longitude] as L.LatLngTuple),
      ...plannedRoute.map((s) => [s.latitude, s.longitude] as L.LatLngTuple),
    ].filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
    if (points.length < 2) return
    const sig = points.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join("|")
    if (sig === lastFitRef.current) return
    lastFitRef.current = sig
    map.fitBounds(L.latLngBounds(points), { padding: [60, 60] })
  }, [map, agents, plannedRoute, focusAgentId])
  return null
}

function FocusAgent({
  agents,
  focusAgentId,
  plannedRoute,
}: {
  agents: LiveMapAgent[]
  focusAgentId: string | null
  plannedRoute: RouteStop[]
}) {
  const map = useMap()
  useEffect(() => {
    if (!focusAgentId) return
    if (plannedRoute.length > 0) return
    const agent = agents.find((a) => a.agentId === focusAgentId)
    if (agent) map.flyTo([agent.latitude, agent.longitude], 15, { duration: 0.5 })
  }, [map, focusAgentId, agents, plannedRoute.length])
  return null
}

export function FieldForceLiveMap({
  agents,
  replayTrack = [],
  showGeofence = false,
  geofenceRadius = 100,
  plannedRoute = [],
  focusAgentId = null,
  etaSeconds = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const check = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width > 100 && height > 100) setReady(true)
    }
    check()
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => check())
      observer.observe(el)
    }
    const fallback = setTimeout(() => setReady(true), 500)
    return () => {
      observer?.disconnect()
      clearTimeout(fallback)
    }
  }, [])

  const defaultCenter: L.LatLngTuple = useMemo(() => {
    const firstAgent = agents[0]
    if (firstAgent && Number.isFinite(firstAgent.latitude) && Number.isFinite(firstAgent.longitude)) {
      return [firstAgent.latitude, firstAgent.longitude]
    }
    const firstStop = plannedRoute[0]
    if (firstStop) {
      return [firstStop.latitude, firstStop.longitude]
    }
    return [40.4093, 49.8671]
  }, [agents, plannedRoute])

  const routePath: L.LatLngTuple[] = useMemo(
    () =>
      plannedRoute
        .filter((s) => s.status === "NEXT" || s.status === "PENDING")
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((s) => [s.latitude, s.longitude] as L.LatLngTuple),
    [plannedRoute],
  )

  const replayPath: L.LatLngTuple[] = useMemo(
    () => replayTrack.map((p) => [p.latitude, p.longitude] as L.LatLngTuple),
    [replayTrack],
  )

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0 }}>
      {ready ? (
        <MapContainer center={defaultCenter} zoom={12} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
          <InvalidateSize />
          <FitBounds agents={agents} plannedRoute={plannedRoute} focusAgentId={focusAgentId} />
          <FocusAgent agents={agents} focusAgentId={focusAgentId} plannedRoute={plannedRoute} />

          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            subdomains={["a", "b", "c", "d"]}
          />

          {routePath.length >= 2 && (
            <Polyline positions={routePath} pathOptions={{ color: "#6C63FF", weight: 2, opacity: 0.5, dashArray: "6 4" }} />
          )}

          {replayPath.length >= 2 && (
            <Polyline positions={replayPath} pathOptions={{ color: "#f59e0b", weight: 3, opacity: 0.85 }} />
          )}

          {showGeofence &&
            agents.map((a) => (
              <Circle
                key={`geo-${a.agentId}`}
                center={[a.latitude, a.longitude]}
                radius={geofenceRadius}
                pathOptions={{
                  color: statusColors[a.fieldStatus || "OFFLINE"],
                  weight: 1.5,
                  opacity: 0.6,
                  fillColor: statusColors[a.fieldStatus || "OFFLINE"],
                  fillOpacity: 0.08,
                }}
              />
            ))}

          {plannedRoute.map((stop) => (
            <Marker
              key={`stop-${stop.orderIndex}`}
              position={[stop.latitude, stop.longitude]}
              icon={routeStopIcon(stop.orderIndex, stop.status)}
              zIndexOffset={100}
            >
              <Popup>
                <div style={{ fontFamily: "system-ui,sans-serif", minWidth: 140 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    #{stop.orderIndex + 1} {stop.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    Status: {stop.status}
                    {stop.visitedAt ? <> · {new Date(stop.visitedAt).toLocaleTimeString()}</> : null}
                  </div>
                  {stop.address ? <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{stop.address}</div> : null}
                </div>
              </Popup>
            </Marker>
          ))}

          {agents.map((agent) => {
            const status = agent.fieldStatus || (agent.isOnline ? "ON_ROAD" : "OFFLINE")
            const statusKey: MtmFieldStatus | null = isMtmFieldStatus(status) ? status : null
            const color = statusColors[status] ?? statusColors.OFFLINE ?? "#94a3b8"
            const isFocused = agent.agentId === focusAgentId
            return (
              <Marker
                key={agent.agentId}
                position={[agent.latitude, agent.longitude]}
                icon={agentIcon(agent.name, color, isFocused)}
                zIndexOffset={isFocused ? 1000 : 500}
              >
                <Popup>
                  <div style={{ fontFamily: "system-ui,sans-serif", minWidth: 170 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: "#0B0B1E" }}>{agent.name}</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}>
                      {statusKey ? statusLabelKeys[statusKey] : status}
                      {agent.speed && agent.speed > 0 ? ` · ${agent.speed.toFixed(1)} km/h` : ""}
                      {agent.battery ? ` · battery ${agent.battery}%` : ""}
                    </div>
                    {etaSeconds != null && isFocused ? (
                      <div style={{ fontSize: 12, color: "#6C63FF", fontWeight: 600, marginBottom: 2 }}>
                        ETA: {etaSeconds < 60 ? `${etaSeconds}s` : `${Math.round(etaSeconds / 60)} min`}
                      </div>
                    ) : null}
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{new Date(agent.recordedAt).toLocaleTimeString()}</div>
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      ) : (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#94a3b8",
            fontSize: 14,
          }}
        >
          Loading map...
        </div>
      )}
    </div>
  )
}
