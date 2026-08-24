import { HttpError } from "../sync/ports-error"

/**
 * A notification read is intentionally a single-id setter. The server PATCH
 * endpoint scopes it to the authenticated agent and setting isRead:true again
 * is idempotent, so a durable retry cannot accidentally affect other inbox
 * items or toggle this one back to unread.
 */
export type FieldNotificationReadPayload = {
  notificationId: string
}

export type FieldNotificationReadPushOperation = {
  clientOpId: string
  clientCreatedAt?: string
  kind: "field.notification.read"
  payload: FieldNotificationReadPayload
}

export type FieldNotificationReadPushResult = {
  clientOpId: string
  status: "applied" | "already_applied" | "conflict" | "rejected"
  detail?: unknown
}

type FieldNotificationReadApi = {
  markNotificationRead(notificationId: string): Promise<void>
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function validNotificationId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    value.trim() === value
}

export function parseFieldNotificationReadPayload(value: unknown): FieldNotificationReadPayload {
  const payload = record(value)
  if (!payload || !validNotificationId(payload.notificationId)) {
    throw new Error("Invalid field notification read payload")
  }
  return { notificationId: payload.notificationId }
}

export function isFieldNotificationReadPushOperation(
  operation: { kind: string },
): operation is FieldNotificationReadPushOperation {
  return operation.kind === "field.notification.read"
}

export async function sendFieldNotificationReadOperation(
  operation: FieldNotificationReadPushOperation,
  api: FieldNotificationReadApi,
): Promise<FieldNotificationReadPushResult> {
  try {
    // This deliberately sends one id and never falls back to all:true.
    await api.markNotificationRead(operation.payload.notificationId)
    return { clientOpId: operation.clientOpId, status: "applied" }
  } catch (error) {
    // Network errors and retryable server responses stay pending in the shared
    // durable outbox. SyncManager owns attempt counting and backoff.
    if (
      !(error instanceof HttpError) ||
      error.status >= 500 ||
      error.status === 408 ||
      error.status === 429
    ) {
      throw error
    }
    return {
      clientOpId: operation.clientOpId,
      status: error.status === 404 || error.status === 409 ? "conflict" : "rejected",
      detail: error.detail ?? { status: error.status, error: error.message },
    }
  }
}
