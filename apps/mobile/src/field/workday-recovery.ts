import type {
  FieldWorkdayAction,
  FieldWorkdayData,
  FieldWorkdayStatus,
} from "./contracts"

export type WorkdayRecoveryDetail = {
  code: string | null
  serverStatus: FieldWorkdayStatus | null
  /**
   * Null means an older or malformed response did not provide a server-authoritative
   * recovery action list. An empty array means the server explicitly allows none.
   */
  allowedActions: FieldWorkdayAction[] | null
}

const WORKDAY_STATUSES = new Set<FieldWorkdayStatus>(["STARTED", "PAUSED", "COMPLETED"])
const WORKDAY_ACTIONS = new Set<FieldWorkdayAction>(["START", "PAUSE", "RESUME", "FINISH"])

type WorkdayOutboxStatus = "pending" | "applied" | "conflict" | "rejected"

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function uniqueActions(value: unknown): FieldWorkdayAction[] | null {
  if (!Array.isArray(value)) return null
  const actions: FieldWorkdayAction[] = []
  for (const item of value) {
    if (typeof item !== "string" || !WORKDAY_ACTIONS.has(item as FieldWorkdayAction)) continue
    const action = item as FieldWorkdayAction
    if (!actions.includes(action)) actions.push(action)
  }
  return actions
}

/**
 * Reads the additive LeadDrive conflict payload defensively. This deliberately
 * never derives an action from a client-side state: absent server guidance is
 * represented as null so callers can ask the employee to refresh instead.
 */
export function workdayRecoveryDetail(detail: unknown): WorkdayRecoveryDetail {
  const payload = record(detail)
  const workday = record(payload?.workday)
  const rawStatus = workday?.status
  const serverStatus = typeof rawStatus === "string" && WORKDAY_STATUSES.has(rawStatus as FieldWorkdayStatus)
    ? rawStatus as FieldWorkdayStatus
    : null
  return {
    code: typeof payload?.code === "string" && payload.code.length > 0 ? payload.code : null,
    serverStatus,
    allowedActions: serverStatus ? uniqueActions(payload?.allowedActions) : null,
  }
}

/**
 * A conflict/rejection is not a canonical activity refresh. Keep its
 * `allowedActions` in durable recovery detail for explanation only; the
 * action surface stays locked until the workday endpoint has refreshed it.
 */
export function workdayActionsAfterOutboxResult(
  status: WorkdayOutboxStatus,
  actions: FieldWorkdayAction[],
): FieldWorkdayAction[] {
  return status === "conflict" || status === "rejected" ? [] : actions
}

/**
 * Mirrors the outbox lock into the active Field context immediately, so a
 * user cannot tap a stale optimistic transition while the refresh is in
 * flight. A successful canonical activity response replaces this data.
 */
export function lockWorkdayActionsUntilRefresh(data: FieldWorkdayData): FieldWorkdayData {
  const lock = (workday: FieldWorkdayData["workday"]): FieldWorkdayData["workday"] => workday
    ? { ...workday, availableActions: [] }
    : null
  return {
    ...data,
    workday: lock(data.workday),
    activeWorkday: lock(data.activeWorkday),
    availableActions: [],
  }
}

/**
 * The durable cache can have no local workday yet (for example, a START was
 * rejected while the app was backgrounded). It still must not leave START or
 * any nested action surface enabled before a canonical activity refresh.
 */
export function lockCachedWorkdayActionsUntilRefresh(cache: Record<string, unknown>): Record<string, unknown> {
  const lock = (value: unknown): unknown => {
    const workday = record(value)
    return workday ? { ...workday, availableActions: [] } : value
  }
  return {
    ...cache,
    workday: lock(cache.workday),
    activeWorkday: lock(cache.activeWorkday),
    availableActions: [],
  }
}
