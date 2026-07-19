import type { PushOperation, PushResult } from "@leadshelf/db"

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/

export interface MobileOperationLog {
  timestamp: string
  level: "info"
  event: "mobile_operation_processed"
  correlationId?: string
  organizationId: string
  deviceId: string
  opId: string
  kind: string
  status: PushResult["status"]
}

function safe(value: string | null | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && SAFE_ID.test(normalized) ? normalized : undefined
}

export function buildMobileOperationLogs(
  operations: PushOperation[],
  results: PushResult[],
  context: { organizationId: string; deviceId: string; correlationId?: string | null },
  now = new Date(),
): MobileOperationLog[] {
  const operationsById = new Map(operations.map((operation) => [operation.clientOpId, operation]))
  return results.flatMap((result) => {
    const operation = operationsById.get(result.clientOpId)
    const opId = safe(result.clientOpId)
    const kind = safe(operation?.kind)
    if (!operation || !opId || !kind) return []
    return [{
      timestamp: now.toISOString(),
      level: "info" as const,
      event: "mobile_operation_processed" as const,
      ...(safe(context.correlationId) ? { correlationId: safe(context.correlationId) } : {}),
      organizationId: context.organizationId,
      deviceId: context.deviceId,
      opId,
      kind,
      status: result.status,
    }]
  })
}

export function writeMobileOperationLogs(
  operations: PushOperation[],
  results: PushResult[],
  context: { organizationId: string; deviceId: string; correlationId?: string | null },
  sink: (line: string) => void = console.info,
): void {
  for (const event of buildMobileOperationLogs(operations, results, context)) {
    sink(JSON.stringify(event))
  }
}
