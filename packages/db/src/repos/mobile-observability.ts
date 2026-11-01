import type { PrismaClient } from "@leadshelf/prisma-client"

type OperationRow = {
  deviceId: string
  clientOpId: string
  kind: string
  status: string
  result: unknown
  error: string | null
  createdAt: Date
  processedAt: Date | null
}

type DeviceRow = {
  id: string
  platform: string
  deviceName: string | null
  lastSeenAt: Date
  user: { name: string; employeeCode: string | null }
}

export interface MobileExecutionHealth {
  periodHours: number
  devices: number
  staleDevices: number
  processedOps: number
  actionableOps: number
  conflicts: number
  rejectedOrders: number
  p50LatencyMs: number | null
  p95LatencyMs: number | null
  alerts: Array<"conflicts_growing" | "order_failures_growing">
  operations: Array<{
    clientTrace: string
    kind: string
    outcome: "conflict" | "rejected"
    reason: string | null
    processedAt: Date
    latencyMs: number | null
    agentName: string
    employeeCode: string | null
    platform: string
    deviceName: string | null
  }>
}

function resultRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function resultStatus(operation: OperationRow): "conflict" | "rejected" | "ok" {
  const status = resultRecord(operation.result)?.status
  if (status === "conflict") return "conflict"
  if (status === "rejected" || operation.status === "FAILED") return "rejected"
  return "ok"
}

function safeReason(operation: OperationRow): string | null {
  const result = resultRecord(operation.result)
  const detail = result?.detail
  if (typeof detail === "string") return detail.slice(0, 80)
  const detailRecord = resultRecord(detail)
  for (const key of ["code", "reason", "serverStatus"]) {
    const value = detailRecord?.[key]
    if (typeof value === "string") return value.slice(0, 80)
  }
  return operation.error?.slice(0, 80) ?? null
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? null
}

export function buildMobileExecutionHealth(input: {
  devices: DeviceRow[]
  operations: OperationRow[]
  now: Date
  periodHours?: number
  staleAfterMinutes?: number
}): MobileExecutionHealth {
  const periodHours = input.periodHours ?? 24
  const periodMs = periodHours * 60 * 60 * 1000
  const currentStart = input.now.getTime() - periodMs
  const previousStart = currentStart - periodMs
  const current = input.operations.filter((operation) => (operation.processedAt ?? operation.createdAt).getTime() >= currentStart)
  const previous = input.operations.filter((operation) => {
    const time = (operation.processedAt ?? operation.createdAt).getTime()
    return time >= previousStart && time < currentStart
  })
  const currentIssues = current.filter((operation) => resultStatus(operation) !== "ok")
  const conflicts = currentIssues.filter((operation) => resultStatus(operation) === "conflict")
  const rejectedOrders = currentIssues.filter(
    (operation) => operation.kind === "order.create" && resultStatus(operation) === "rejected",
  )
  const previousConflicts = previous.filter((operation) => resultStatus(operation) === "conflict").length
  const previousRejectedOrders = previous.filter(
    (operation) => operation.kind === "order.create" && resultStatus(operation) === "rejected",
  ).length
  const latencies = current.flatMap((operation) => {
    if (!operation.processedAt) return []
    return [Math.max(0, operation.processedAt.getTime() - operation.createdAt.getTime())]
  })
  const staleCutoff = input.now.getTime() - (input.staleAfterMinutes ?? 45) * 60 * 1000
  const staleDevices = input.devices.filter((device) => device.lastSeenAt.getTime() < staleCutoff).length
  const alerts: MobileExecutionHealth["alerts"] = []
  if (conflicts.length >= 2 && conflicts.length > previousConflicts) alerts.push("conflicts_growing")
  if (rejectedOrders.length > 0 && rejectedOrders.length > previousRejectedOrders) alerts.push("order_failures_growing")
  const devicesById = new Map(input.devices.map((device) => [device.id, device]))

  return {
    periodHours,
    devices: input.devices.length,
    staleDevices,
    processedOps: current.length,
    actionableOps: currentIssues.length,
    conflicts: conflicts.length,
    rejectedOrders: rejectedOrders.length,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    alerts,
    operations: currentIssues.slice(0, 25).map((operation) => {
      const device = devicesById.get(operation.deviceId)
      return {
        clientTrace: operation.clientOpId.slice(-10).toUpperCase(),
        kind: operation.kind,
        outcome: resultStatus(operation) as "conflict" | "rejected",
        reason: safeReason(operation),
        processedAt: operation.processedAt ?? operation.createdAt,
        latencyMs: operation.processedAt
          ? Math.max(0, operation.processedAt.getTime() - operation.createdAt.getTime())
          : null,
        agentName: device?.user.name ?? "—",
        employeeCode: device?.user.employeeCode ?? null,
        platform: device?.platform ?? "—",
        deviceName: device?.deviceName ?? null,
      }
    }),
  }
}

export async function getMobileExecutionHealth(
  prisma: PrismaClient,
  organizationId: string,
  now = new Date(),
): Promise<MobileExecutionHealth> {
  const devices = await prisma.mobileDevice.findMany({
    where: { user: { organizationId } },
    select: {
      id: true,
      platform: true,
      deviceName: true,
      lastSeenAt: true,
      user: { select: { name: true, employeeCode: true } },
    },
  })
  const operations = devices.length
    ? await prisma.outboxOperation.findMany({
        where: {
          deviceId: { in: devices.map((device) => device.id) },
          OR: [
            { processedAt: { gte: new Date(now.getTime() - 48 * 60 * 60 * 1000) } },
            { processedAt: null, createdAt: { gte: new Date(now.getTime() - 48 * 60 * 60 * 1000) } },
          ],
        },
        orderBy: [{ processedAt: "desc" }, { createdAt: "desc" }],
        select: {
          deviceId: true,
          clientOpId: true,
          kind: true,
          status: true,
          result: true,
          error: true,
          createdAt: true,
          processedAt: true,
        },
      })
    : []
  return buildMobileExecutionHealth({ devices, operations, now })
}
