import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { AgentCreateForm } from "./agent-create-form"
import { RouteCreateForm } from "./route-create-form"

export default async function FieldForcePage() {
  const [t, tNav, session] = await Promise.all([
    getTranslations("fieldForce"),
    getTranslations("nav"),
    getSession(),
  ])
  if (!session) return null

  const db = tenantDb(session.org)
  const [agents, teams, users, stores, routes] = await Promise.all([
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
  ])

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
          ["cards.activeVisits", agents.reduce((sum, agent) => sum + agent.visits.filter((visit) => visit.status === "IN_PROGRESS").length, 0)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
            <div className="text-xs text-neutral-500">{t(label as never)}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
          </div>
        ))}
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
