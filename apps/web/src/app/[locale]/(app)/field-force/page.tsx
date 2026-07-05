import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { AgentCreateForm } from "./agent-create-form"
import { RouteCreateForm } from "./route-create-form"

function formatDateTime(value: Date | null | undefined): string {
  return value ? value.toLocaleString() : "—"
}

export default async function FieldForcePage() {
  const [t, tNav, session] = await Promise.all([
    getTranslations("fieldForce"),
    getTranslations("nav"),
    getSession(),
  ])
  if (!session) return null

  const db = tenantDb(session.org)
  const [agents, teams, users, stores, routes, visits, tasks] = await Promise.all([
    db.fieldAgent.findMany({
      include: {
        user: { select: { name: true, email: true, employeeCode: true, role: true } },
        team: { select: { name: true } },
        routes: { where: { isActive: true }, select: { id: true } },
        visits: { select: { id: true, status: true }, take: 100 },
        locations: { orderBy: { recordedAt: "desc" }, take: 1, select: { latitude: true, longitude: true, recordedAt: true } },
      },
      orderBy: { user: { name: "asc" } },
      take: 200,
    }),
    db.team.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({
      where: {
        isActive: true,
        fieldAgent: null,
        role: { in: ["MERCHANDISER", "SUPERVISOR", "STORE_STAFF"] },
      },
      select: { id: true, name: true, employeeCode: true },
      orderBy: { name: "asc" },
      take: 100,
    }),
    db.store.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
      take: 300,
    }),
    db.route.findMany({
      include: {
        agent: { select: { user: { select: { name: true } } } },
        stops: {
          orderBy: { sortOrder: "asc" },
          select: { sortOrder: true, store: { select: { name: true, code: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.visit.findMany({
      include: {
        agent: { select: { user: { select: { name: true } } } },
        store: { select: { name: true, code: true } },
        photoSubmissions: {
          orderBy: { takenAt: "desc" },
          take: 3,
          select: {
            id: true,
            takenAt: true,
            qualityScore: true,
            task: { select: { title: true, status: true } },
            humanReviews: {
              orderBy: { createdAt: "desc" },
              take: 2,
              select: { status: true, reason: true, score: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.task.findMany({
      where: { assigneeId: { not: null } },
      include: {
        assignee: { select: { id: true, name: true } },
        store: { select: { name: true, code: true } },
        photoSubmissions: {
          orderBy: { takenAt: "desc" },
          take: 1,
          select: {
            id: true,
            qualityScore: true,
            humanReviews: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { status: true, reason: true, score: true },
            },
          },
        },
      },
      orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
      take: 200,
    }),
  ])
  const tasksByAssignee = new Map<string, typeof tasks>()
  for (const task of tasks) {
    if (!task.assigneeId) continue
    const list = tasksByAssignee.get(task.assigneeId) ?? []
    list.push(task)
    tasksByAssignee.set(task.assigneeId, list)
  }
  const agentWorkload = agents.map((agent) => {
    const assignedTasks = tasksByAssignee.get(agent.userId) ?? []
    return {
      agent,
      assignedTasks,
      openTasks: assignedTasks.filter((task) => !["COMPLETED", "EXPIRED"].includes(task.status)).length,
      submittedTasks: assignedTasks.filter((task) => task.status === "PHOTO_SUBMITTED").length,
      pendingReviews: assignedTasks.reduce(
        (sum, task) =>
          sum +
          task.photoSubmissions.reduce(
            (photoSum, photo) => photoSum + photo.humanReviews.filter((review) => review.status === "PENDING").length,
            0,
          ),
        0,
      ),
    }
  })
  const liveLocations = agents.flatMap((agent) => {
    const location = agent.locations[0]
    return location
      ? [{
          agentId: agent.id,
          name: agent.user.name,
          latitude: location.latitude,
          longitude: location.longitude,
          recordedAt: location.recordedAt,
        }]
      : []
  })
  const latitudes = liveLocations.map((location) => location.latitude)
  const longitudes = liveLocations.map((location) => location.longitude)
  const latMin = Math.min(...latitudes)
  const latMax = Math.max(...latitudes)
  const lngMin = Math.min(...longitudes)
  const lngMax = Math.max(...longitudes)
  const completedVisits = visits.filter((visit) => visit.status === "COMPLETED").length
  const visitsWithProof = visits.filter((visit) => visit.photoSubmissions.length > 0).length
  const openReviews = visits.reduce(
    (sum, visit) =>
      sum +
      visit.photoSubmissions.reduce(
        (photoSum, photo) => photoSum + photo.humanReviews.filter((review) => review.status === "PENDING").length,
        0,
      ),
    0,
  )
  const cleanVisits = visits.filter((visit) => {
    const flags = visit.anomalyFlags as { geofence?: { outside?: boolean } } | null
    return visit.status === "COMPLETED" && flags?.geofence?.outside !== true
  }).length
  const demoVisit = visits.find((visit) => visit.photoSubmissions.length > 0) ?? visits[0]
  const demoProof = demoVisit?.photoSubmissions[0]
  const pointFor = (latitude: number, longitude: number) => ({
    x: liveLocations.length <= 1 ? 50 : 8 + ((longitude - lngMin) / Math.max(lngMax - lngMin, 0.00001)) * 84,
    y: liveLocations.length <= 1 ? 50 : 92 - ((latitude - latMin) / Math.max(latMax - latMin, 0.00001)) * 84,
  })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{tNav("fieldForce")}</h1>
        <span className="text-sm text-neutral-500">{t("subtitle")}</span>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["cards.agents", agents.length],
          ["cards.teams", teams.length],
          ["cards.activeRoutes", routes.filter((route) => route.isActive).length],
          ["cards.completedVisits", completedVisits],
          ["cards.proofs", visitsWithProof],
          ["cards.pendingReviews", openReviews],
          ["cards.assignedTasks", tasks.length],
          ["cards.cleanVisits", cleanVisits],
          ["cards.liveLocations", liveLocations.length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
            <div className="text-xs text-neutral-500">{t(label as never)}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium">{t("officeSnapshot.title")}</h2>
            <p className="mt-1 text-xs text-neutral-500">{t("officeSnapshot.subtitle")}</p>
          </div>
          <span className="rounded bg-neutral-900 px-2 py-1 text-xs font-medium text-white">
            {demoVisit ? t(`visitStatus.${demoVisit.status}`) : t("officeSnapshot.noVisit")}
          </span>
        </div>
        {demoVisit ? (
          <div className="grid gap-3 lg:grid-cols-4">
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <div className="text-xs uppercase text-neutral-500">{t("officeSnapshot.agent")}</div>
              <div className="mt-1 text-sm font-semibold">{demoVisit.agent.user.name}</div>
              <div className="mt-1 text-xs text-neutral-500">
                {demoVisit.store.name}
                {demoVisit.store.code ? ` (${demoVisit.store.code})` : ""}
              </div>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <div className="text-xs uppercase text-neutral-500">{t("officeSnapshot.timing")}</div>
              <div className="mt-1 text-sm font-semibold">{formatDateTime(demoVisit.checkInAt)}</div>
              <div className="mt-1 text-xs text-neutral-500">{t("officeSnapshot.checkout", { value: formatDateTime(demoVisit.checkOutAt) })}</div>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <div className="text-xs uppercase text-neutral-500">{t("officeSnapshot.proof")}</div>
              <div className="mt-1 text-sm font-semibold">
                {demoProof ? t("officeSnapshot.proofReady") : t("officeSnapshot.noProof")}
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                {demoProof?.task?.title ?? t("officeSnapshot.mobileTask")}
              </div>
            </div>
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <div className="text-xs uppercase text-neutral-500">{t("officeSnapshot.review")}</div>
              <div className="mt-1 text-sm font-semibold">
                {demoProof?.humanReviews[0]
                  ? t(`reviewStatus.${demoProof.humanReviews[0].status}` as never)
                  : t("officeSnapshot.noReview")}
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                {openReviews > 0
                  ? `${t("officeSnapshot.pendingCount", { count: openReviews })} · ${t("officeSnapshot.noAnomaly")}`
                  : t("officeSnapshot.noAnomaly")}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-500">
            {t("emptyVisits")}
          </div>
        )}
      </div>

      <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium">{t("workload.title")}</h2>
            <p className="mt-1 text-xs text-neutral-500">{t("workload.subtitle")}</p>
          </div>
          <span className="rounded bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700">
            {t("workload.total", { count: tasks.length })}
          </span>
        </div>
        {agentWorkload.length === 0 ? (
          <div className="rounded-md border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-500">
            {t("emptyAgents")}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {agentWorkload.map(({ agent, assignedTasks, openTasks, submittedTasks, pendingReviews }) => (
              <div key={agent.id} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{agent.user.name}</div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {agent.team?.name ?? t("noTeam")} · {agent.user.employeeCode ?? agent.user.email ?? agent.user.role}
                    </div>
                  </div>
                  <div className="text-right text-xs text-neutral-500">
                    <div className="font-semibold text-neutral-900">{openTasks}</div>
                    <div>{t("workload.open")}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-md border border-neutral-200 bg-white px-2 py-1.5">
                    <div className="font-semibold tabular-nums">{assignedTasks.length}</div>
                    <div className="text-neutral-500">{t("workload.assigned")}</div>
                  </div>
                  <div className="rounded-md border border-neutral-200 bg-white px-2 py-1.5">
                    <div className="font-semibold tabular-nums">{submittedTasks}</div>
                    <div className="text-neutral-500">{t("workload.photoSubmitted")}</div>
                  </div>
                  <div className="rounded-md border border-neutral-200 bg-white px-2 py-1.5">
                    <div className="font-semibold tabular-nums">{pendingReviews}</div>
                    <div className="text-neutral-500">{t("workload.pendingReview")}</div>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {assignedTasks.slice(0, 3).map((task) => (
                    <div key={task.id} className="rounded-md border border-neutral-200 bg-white px-2 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-neutral-900">{task.title}</span>
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">
                          {task.status}
                        </span>
                      </div>
                      <div className="mt-1 text-neutral-500">
                        {task.store.name}
                        {task.store.code ? ` (${task.store.code})` : ""}
                        {task.dueAt ? ` · ${formatDateTime(task.dueAt)}` : ""}
                      </div>
                    </div>
                  ))}
                  {assignedTasks.length === 0 ? (
                    <div className="rounded-md border border-dashed border-neutral-200 bg-white px-2 py-4 text-center text-xs text-neutral-500">
                      {t("workload.noTasks")}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-medium">{t("addAgent")}</h2>
        <AgentCreateForm users={users} teams={teams} />
      </div>

      <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-medium">{t("createRoute")}</h2>
        <RouteCreateForm
          agents={agents.map((agent) => ({ id: agent.id, name: agent.user.name }))}
          stores={stores}
        />
      </div>

      <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">{t("liveMap")}</h2>
          <span className="text-xs text-neutral-500">{t("liveAgents", { count: liveLocations.length })}</span>
        </div>
        {liveLocations.length === 0 ? (
          <div className="rounded-md border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-500">
            {t("noLiveLocations")}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
            <svg viewBox="0 0 100 100" className="h-72 w-full rounded-md border border-neutral-200 bg-neutral-50">
              <defs>
                <pattern id="live-map-grid" width="10" height="10" patternUnits="userSpaceOnUse">
                  <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#e5e5e5" strokeWidth="0.4" />
                </pattern>
              </defs>
              <rect width="100" height="100" fill="url(#live-map-grid)" />
              {liveLocations.map((location) => {
                const point = pointFor(location.latitude, location.longitude)
                return (
                  <g key={location.agentId}>
                    <circle cx={point.x} cy={point.y} r="3.2" fill="#0f172a" />
                    <circle cx={point.x} cy={point.y} r="7" fill="none" stroke="#0f172a" strokeOpacity="0.2" />
                    <text x={Math.min(point.x + 4, 86)} y={Math.max(point.y - 4, 8)} fontSize="3" fill="#404040">
                      {location.name}
                    </text>
                  </g>
                )
              })}
            </svg>
            <div className="space-y-2">
              {liveLocations.map((location) => (
                <div key={location.agentId} className="rounded-md border border-neutral-200 px-3 py-2 text-sm">
                  <div className="font-medium">{location.name}</div>
                  <div className="text-xs text-neutral-500">
                    {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                  </div>
                  <div className="text-xs text-neutral-400">{location.recordedAt.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
              <th className="px-3 py-2">{t("routesTable.route")}</th>
              <th className="px-3 py-2">{t("routesTable.agent")}</th>
              <th className="px-3 py-2">{t("routesTable.stops")}</th>
              <th className="px-3 py-2">{t("routesTable.status")}</th>
            </tr>
          </thead>
          <tbody>
            {routes.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-neutral-500">
                  {t("emptyRoutes")}
                </td>
              </tr>
            ) : (
              routes.map((route) => (
                <tr key={route.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                  <td className="px-3 py-2 font-medium">{route.name}</td>
                  <td className="px-3 py-2 text-neutral-600">{route.agent?.user.name ?? "—"}</td>
                  <td className="max-w-[520px] px-3 py-2 text-xs text-neutral-500">
                    {route.stops
                      .map((stop) => `${stop.sortOrder}. ${stop.store.name}${stop.store.code ? ` (${stop.store.code})` : ""}`)
                      .join(" -> ")}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${route.isActive ? "bg-green-50 text-green-700" : "bg-neutral-100 text-neutral-500"}`}>
                      {route.isActive ? t("active") : t("inactive")}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mb-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
              <th className="px-3 py-2">{t("visitsTable.agent")}</th>
              <th className="px-3 py-2">{t("visitsTable.store")}</th>
              <th className="px-3 py-2">{t("visitsTable.checkIn")}</th>
              <th className="px-3 py-2">{t("visitsTable.checkOut")}</th>
              <th className="px-3 py-2">{t("visitsTable.status")}</th>
              <th className="px-3 py-2">{t("visitsTable.anomaly")}</th>
              <th className="px-3 py-2">{t("visitsTable.proof")}</th>
            </tr>
          </thead>
          <tbody>
            {visits.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-neutral-500">
                  {t("emptyVisits")}
                </td>
              </tr>
            ) : (
              visits.map((visit) => {
                const flags = visit.anomalyFlags as { geofence?: { outside?: boolean; distanceM?: number | null } } | null
                const outside = flags?.geofence?.outside === true
                const proof = visit.photoSubmissions[0]
                return (
                  <tr key={visit.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-3 py-2 font-medium">{visit.agent.user.name}</td>
                    <td className="px-3 py-2 text-neutral-600">
                      {visit.store.name}
                      {visit.store.code ? ` (${visit.store.code})` : ""}
                    </td>
                    <td className="px-3 py-2 text-neutral-500">
                      {formatDateTime(visit.checkInAt)}
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{formatDateTime(visit.checkOutAt)}</td>
                    <td className="px-3 py-2">{t(`visitStatus.${visit.status}`)}</td>
                    <td className="px-3 py-2">
                      {outside ? (
                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-600">
                          {t("geofenceOutside")}
                          {typeof flags?.geofence?.distanceM === "number" ? ` · ${flags.geofence.distanceM}m` : ""}
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-600">
                      {proof ? (
                        <div>
                          <div className="font-medium text-neutral-800">{t("proofSubmitted")}</div>
                          <div className="text-neutral-500">
                            {formatDateTime(proof.takenAt)}
                            {typeof proof.qualityScore === "number" ? ` · ${Math.round(proof.qualityScore * 100)}%` : ""}
                          </div>
                        </div>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
          {t("emptyAgents")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
                <th className="px-3 py-2">{t("table.agent")}</th>
                <th className="px-3 py-2">{t("table.team")}</th>
                <th className="px-3 py-2">{t("table.routes")}</th>
                <th className="px-3 py-2">{t("table.visits")}</th>
                <th className="px-3 py-2">{t("table.tasks")}</th>
                <th className="px-3 py-2">{t("table.lastLocation")}</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const latestLocation = agent.locations[0]
                return (
                  <tr key={agent.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-3 py-2">
                      <div className="font-medium">{agent.user.name}</div>
                      <div className="text-xs text-neutral-500">
                        {agent.user.employeeCode ?? agent.user.email ?? agent.user.role}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{agent.team?.name ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{agent.routes.length}</td>
                    <td className="px-3 py-2 tabular-nums">{agent.visits.length}</td>
                    <td className="px-3 py-2 tabular-nums">{tasksByAssignee.get(agent.userId)?.length ?? 0}</td>
                    <td className="px-3 py-2 text-xs text-neutral-500">
                      {latestLocation
                        ? `${latestLocation.latitude.toFixed(5)}, ${latestLocation.longitude.toFixed(5)} · ${latestLocation.recordedAt.toLocaleString()}`
                        : "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
