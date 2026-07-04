export type ProductEventKind =
  | "task.overdue"
  | "visit.anomaly"
  | "stock.gap"
  | "import.errors"
  | "office.digest"
export type AlertSeverity = "info" | "warning" | "critical"

export interface ProductEventInput {
  kind: ProductEventKind
  severity?: AlertSeverity
  storeName?: string | null
  entityTitle?: string | null
  count?: number | null
}

export interface AlertMessage {
  title: string
  body: string
  severity: AlertSeverity
}

export interface DigestAlert {
  kind: ProductEventKind
  severity: AlertSeverity
  storeName?: string | null
}

export interface MorningDigest {
  title: string
  body: string
  total: number
  critical: number
  warning: number
  byKind: Record<ProductEventKind, number>
}

const kindLabels: Record<ProductEventKind, string> = {
  "task.overdue": "Overdue tasks",
  "visit.anomaly": "Visit anomalies",
  "stock.gap": "Stock gaps",
  "import.errors": "Import errors",
  "office.digest": "Morning shelf digest",
}

const emptyKindCounts: Record<ProductEventKind, number> = {
  "task.overdue": 0,
  "visit.anomaly": 0,
  "stock.gap": 0,
  "import.errors": 0,
  "office.digest": 0,
}

export function buildAlertMessage(input: ProductEventInput): AlertMessage {
  const severity = input.severity ?? (input.kind === "visit.anomaly" ? "critical" : "warning")
  const place = input.storeName ? ` at ${input.storeName}` : ""
  const title = kindLabels[input.kind]
  if (input.kind === "task.overdue") {
    return {
      title,
      body: `${input.entityTitle ?? "Execution task"} is overdue${place}.`,
      severity,
    }
  }
  if (input.kind === "visit.anomaly") {
    return {
      title,
      body: `${input.entityTitle ?? "Visit"} needs review${place}.`,
      severity,
    }
  }
  if (input.kind === "stock.gap") {
    return {
      title,
      body: `${input.count ?? 1} assortment item${input.count === 1 ? "" : "s"} have no available stock${place}.`,
      severity,
    }
  }
  if (input.kind === "office.digest") {
    return {
      title,
      body: input.entityTitle ?? "Morning shelf digest is ready.",
      severity,
    }
  }
  return {
    title,
    body: `${input.count ?? 1} import row${input.count === 1 ? "" : "s"} need attention.`,
    severity,
  }
}

export function buildPushPayload(input: ProductEventInput & { eventId: string; alertId?: string | null }) {
  const message = buildAlertMessage(input)
  return {
    title: message.title,
    body: message.body,
    data: {
      eventId: input.eventId,
      alertId: input.alertId ?? null,
      kind: input.kind,
      severity: message.severity,
    },
  }
}

export function buildMorningDigest(alerts: DigestAlert[]): MorningDigest {
  const byKind = { ...emptyKindCounts }
  let critical = 0
  let warning = 0
  for (const alert of alerts) {
    byKind[alert.kind] += 1
    if (alert.severity === "critical") critical += 1
    if (alert.severity === "warning") warning += 1
  }
  const total = alerts.length
  const activeParts = Object.entries(byKind)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kindLabels[kind as ProductEventKind]}: ${count}`)
  return {
    title: "Morning shelf digest",
    body: total === 0 ? "No open shelf alerts." : activeParts.join(" · "),
    total,
    critical,
    warning,
    byKind,
  }
}
