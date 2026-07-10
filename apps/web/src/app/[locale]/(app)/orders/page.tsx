import { getLocale, getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { Link } from "@/i18n/navigation"

const ACTIVE_ORDER_STATUSES = new Set(["DRAFT", "SUBMITTED", "CONFIRMED"])

function statusClass(status: string): string {
  if (status === "CONFIRMED") return "bg-emerald-50 text-emerald-700"
  if (status === "DELIVERED") return "bg-sky-50 text-sky-700"
  if (status === "CANCELLED") return "bg-red-50 text-red-700"
  if (status === "SUBMITTED") return "bg-indigo-50 text-indigo-700"
  return "bg-neutral-100 text-neutral-700"
}

function intlLocale(locale: string): string {
  return locale === "ru" ? "ru-RU" : "az-Latn-AZ"
}

function formatDate(value: Date, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value)
}

function formatQuantity(value: number, locale: string): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    maximumFractionDigits: 3,
  }).format(value)
}

function formatMoney(value: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).format(value)
  } catch {
    return `${formatQuantity(value, locale)} ${currency}`
  }
}

function orderReference(id: string, invoiceNumber: string | null): string {
  return invoiceNumber ?? `#${id.slice(-8).toUpperCase()}`
}

export default async function OrdersPage() {
  const [t, locale, session] = await Promise.all([
    getTranslations("orders"),
    getLocale(),
    getSession(),
  ])
  if (!session) return null

  const db = tenantDb(session.org)
  const orders = await db.order.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      status: true,
      currency: true,
      totalAmount: true,
      invoiceNumber: true,
      clientDeviceId: true,
      createdAt: true,
      store: { select: { id: true, name: true, code: true } },
      agent: {
        select: {
          user: { select: { name: true, employeeCode: true } },
        },
      },
      visit: {
        select: {
          id: true,
          routeStop: { select: { route: { select: { name: true } } } },
        },
      },
      lines: {
        orderBy: { id: "asc" },
        select: {
          quantity: true,
          product: { select: { name: true, sku: true } },
        },
      },
    },
  })

  const activeCount = orders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status)).length
  const offlineCount = orders.filter((order) => Boolean(order.clientDeviceId)).length
  const totalsByCurrency = orders.reduce((totals, order) => {
    totals.set(order.currency, (totals.get(order.currency) ?? 0) + Number(order.totalAmount))
    return totals
  }, new Map<string, number>())
  const totalValue = totalsByCurrency.size > 0
    ? [...totalsByCurrency.entries()].map(([currency, value]) => formatMoney(value, currency, locale)).join(" · ")
    : formatMoney(0, "AZN", locale)

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-950">{t("title")}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-600">{t("subtitle")}</p>
      </header>

      <section
        aria-label={t("title")}
        className="grid grid-cols-2 overflow-hidden rounded-xl border border-neutral-200 bg-white lg:grid-cols-4"
      >
        {[
          [t("summary.total"), String(orders.length)],
          [t("summary.active"), String(activeCount)],
          [t("summary.offline"), String(offlineCount)],
          [t("summary.value"), totalValue],
        ].map(([label, value], index) => (
          <div
            key={label}
            className={`px-4 py-3 ${index % 2 === 0 ? "border-r border-neutral-200" : ""} ${index < 2 ? "border-b border-neutral-200 lg:border-b-0" : ""} ${index === 1 ? "lg:border-r" : ""}`}
          >
            <div className="text-xs font-medium text-neutral-500">{label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-neutral-950">{value}</div>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {orders.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="text-base font-semibold text-neutral-900">{t("emptyTitle")}</div>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-neutral-600">{t("emptyHint")}</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-neutral-100 lg:hidden">
              {orders.map((order) => {
                const quantity = order.lines.reduce((sum, line) => sum + Number(line.quantity), 0)
                const agent = order.agent?.user
                const routeName = order.visit?.routeStop?.route.name
                return (
                  <article key={order.id} className="space-y-3 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-neutral-950">
                          {orderReference(order.id, order.invoiceNumber)}
                        </div>
                        <div className="mt-0.5 text-xs text-neutral-500">{formatDate(order.createdAt, locale)}</div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${statusClass(order.status)}`}>
                        {t(`status.${order.status}` as never)}
                      </span>
                    </div>

                    <div>
                      <Link href={`/stores/${order.store.id}`} className="font-medium text-neutral-900 hover:text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                        {order.store.name}
                      </Link>
                      <div className="mt-0.5 text-xs text-neutral-500">
                        {order.store.code ?? "—"} · {agent?.name ?? t("unknownAgent")}
                        {agent?.employeeCode ? ` (${agent.employeeCode})` : ""}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600">
                      <span className="rounded-full bg-neutral-100 px-2 py-1">
                        {order.visit ? t("sourceVisit") : t("sourceDirect")}
                      </span>
                      {order.clientDeviceId ? (
                        <span className="rounded-full bg-indigo-50 px-2 py-1 text-indigo-700">{t("offlineOrigin")}</span>
                      ) : null}
                      {routeName ? <span className="truncate">{routeName}</span> : null}
                    </div>

                    <div className="flex items-end justify-between gap-4 border-t border-neutral-100 pt-3">
                      <div className="min-w-0 text-xs text-neutral-600">
                        <div>{t("lineCount", { count: order.lines.length })} · {t("unitCount", { count: formatQuantity(quantity, locale) })}</div>
                        <div className="mt-1 truncate text-neutral-500">
                          {order.lines.slice(0, 2).map((line) => line.product.name).join(", ")}
                          {order.lines.length > 2 ? "…" : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-base font-semibold tabular-nums text-neutral-950">
                        {formatMoney(Number(order.totalAmount), order.currency, locale)}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-medium text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">{t("table.order")}</th>
                    <th className="px-4 py-3">{t("table.store")}</th>
                    <th className="px-4 py-3">{t("table.agent")}</th>
                    <th className="px-4 py-3">{t("table.source")}</th>
                    <th className="px-4 py-3">{t("table.items")}</th>
                    <th className="px-4 py-3 text-right">{t("table.total")}</th>
                    <th className="px-4 py-3">{t("table.status")}</th>
                    <th className="px-4 py-3">{t("table.createdAt")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {orders.map((order) => {
                    const quantity = order.lines.reduce((sum, line) => sum + Number(line.quantity), 0)
                    const agent = order.agent?.user
                    const routeName = order.visit?.routeStop?.route.name
                    return (
                      <tr key={order.id} className="align-top hover:bg-neutral-50/70">
                        <td className="px-4 py-3 font-medium text-neutral-950">
                          {orderReference(order.id, order.invoiceNumber)}
                          {order.clientDeviceId ? (
                            <div className="mt-1 text-[11px] font-medium text-indigo-700">{t("offlineOrigin")}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/stores/${order.store.id}`} className="font-medium text-neutral-900 hover:text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                            {order.store.name}
                          </Link>
                          <div className="mt-0.5 text-xs text-neutral-500">{order.store.code ?? "—"}</div>
                        </td>
                        <td className="px-4 py-3 text-neutral-700">
                          {agent?.name ?? t("unknownAgent")}
                          {agent?.employeeCode ? <div className="mt-0.5 text-xs text-neutral-500">{agent.employeeCode}</div> : null}
                        </td>
                        <td className="px-4 py-3 text-neutral-700">
                          {order.visit ? t("sourceVisit") : t("sourceDirect")}
                          {routeName ? <div className="mt-0.5 max-w-36 truncate text-xs text-neutral-500">{routeName}</div> : null}
                        </td>
                        <td className="px-4 py-3 text-neutral-700">
                          <div>{t("lineCount", { count: order.lines.length })}</div>
                          <div className="mt-0.5 text-xs text-neutral-500">{t("unitCount", { count: formatQuantity(quantity, locale) })}</div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-neutral-950">
                          {formatMoney(Number(order.totalAmount), order.currency, locale)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusClass(order.status)}`}>
                            {t(`status.${order.status}` as never)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
                          {formatDate(order.createdAt, locale)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {orders.length === 200 ? <p className="text-xs text-neutral-500">{t("recentLimit")}</p> : null}
    </div>
  )
}
