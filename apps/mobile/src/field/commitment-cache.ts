import type {
  FieldCommitment,
  FieldCommitmentFulfillment,
  FieldCommitmentsData,
} from "./contracts"
import type {
  FieldCommitmentCreatePayload,
  FieldCommitmentFulfillPayload,
} from "./execution-outbox"

export const FIELD_COMMITMENTS_CACHE_KEY = "field.commitments"

export type FieldCommitmentOutboxStatus = "pending" | "applied" | "conflict" | "rejected"

export type FieldCommitmentProjectionOperation = {
  clientOpId: string
  clientCreatedAt: string
  status: FieldCommitmentOutboxStatus
  detail: unknown
} & (
  | { kind: "field.commitment.create"; payload: FieldCommitmentCreatePayload }
  | { kind: "field.commitment.fulfill"; payload: FieldCommitmentFulfillPayload }
)

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function syncState(status: FieldCommitmentOutboxStatus): FieldCommitment["syncState"] {
  if (status === "pending") return "PENDING"
  if (status === "conflict") return "CONFLICT"
  if (status === "rejected") return "REJECTED"
  return undefined
}

function effectiveStatus(
  dueAt: string,
  fulfillment: FieldCommitmentFulfillment | null,
  now: number,
): FieldCommitment["status"] {
  if (fulfillment) return fulfillment.outcome
  return new Date(dueAt).getTime() < now ? "OVERDUE" : "OPEN"
}

function localCommitment(
  operation: Extract<FieldCommitmentProjectionOperation, { kind: "field.commitment.create" }>,
  now: number,
): FieldCommitment {
  const detail = record(operation.detail)
  const serverId = string(detail?.serverId) ?? string(detail?.id)
  const payload = operation.payload
  const commitment: FieldCommitment = {
    id: serverId ?? `local:${payload.clientCommitmentId}`,
    clientCommitmentId: payload.clientCommitmentId,
    visitId: payload.visitId,
    customerId: payload.customerId,
    contactId: payload.contactId,
    productExternalId: payload.productExternalId,
    productName: payload.productName,
    brandExternalId: payload.brandExternalId,
    brandName: payload.brandName,
    promisedQuantity: payload.promisedQuantity,
    unit: payload.unit,
    dueAt: payload.dueAt,
    note: payload.note,
    submittedAt: operation.clientCreatedAt,
    status: "OPEN",
    customer: {
      id: payload.customerId,
      name: payload.customerName,
      objectType: payload.customerType,
      address: null,
      city: null,
    },
    contact: payload.contactId && payload.contactName ? {
      id: payload.contactId,
      displayName: payload.contactName,
      type: "CONTACT",
      specialtyName: null,
    } : null,
    evidencePhoto: null,
    evidenceClientPhotoId: payload.evidenceClientPhotoId,
    fulfillment: null,
  }
  commitment.status = effectiveStatus(commitment.dueAt, null, now)
  const state = syncState(operation.status)
  if (state) commitment.syncState = state
  return commitment
}

function localFulfillment(
  commitment: FieldCommitment,
  operation: Extract<FieldCommitmentProjectionOperation, { kind: "field.commitment.fulfill" }>,
): FieldCommitmentFulfillment {
  const detail = record(operation.detail)
  const serverId = string(detail?.serverId) ?? string(detail?.id)
  const payload = operation.payload
  const fulfillment: FieldCommitmentFulfillment = {
    id: serverId ?? `local:${payload.clientFulfillmentId}`,
    clientFulfillmentId: payload.clientFulfillmentId,
    outcome: payload.outcome,
    actualQuantity: payload.actualQuantity,
    varianceQuantity: Math.round((payload.actualQuantity - commitment.promisedQuantity) * 100) / 100,
    note: payload.note,
    fulfilledAt: operation.clientCreatedAt,
    evidencePhoto: null,
    evidenceClientPhotoId: payload.evidenceClientPhotoId,
  }
  const state = syncState(operation.status)
  if (state) fulfillment.syncState = state
  return fulfillment
}

/**
 * Replays commitment events over the last server snapshot. Applied operations
 * stay in SQLite for audit/replay, so client ids are the dedupe boundary.
 */
export function projectFieldCommitments(
  cached: FieldCommitmentsData | null,
  operations: FieldCommitmentProjectionOperation[],
  now = Date.now(),
): FieldCommitmentsData {
  const capabilities = cached?.capabilities ?? { create: false, fulfillOwn: false }
  let commitments = [...(cached?.commitments ?? [])]

  for (const operation of operations) {
    if (operation.kind === "field.commitment.create") {
      const existingIndex = commitments.findIndex(
        (item) => item.clientCommitmentId === operation.payload.clientCommitmentId,
      )
      const state = syncState(operation.status)
      if (existingIndex >= 0) {
        const existing = commitments[existingIndex]!
        commitments[existingIndex] = state
          ? { ...existing, syncState: state }
          : { ...existing, syncState: undefined }
      } else {
        commitments.push(localCommitment(operation, now))
      }
      continue
    }

    const commitmentIndex = commitments.findIndex((item) => item.id === operation.payload.commitmentId)
    if (commitmentIndex < 0) continue
    const commitment = commitments[commitmentIndex]!
    if (commitment.fulfillment?.clientFulfillmentId === operation.payload.clientFulfillmentId) {
      const state = syncState(operation.status)
      commitments[commitmentIndex] = {
        ...commitment,
        status: commitment.fulfillment.outcome,
        fulfillment: { ...commitment.fulfillment, syncState: state },
        syncState: state,
      }
      continue
    }

    const detail = record(operation.detail)
    const conflictFulfillment = operation.status === "conflict"
      ? record(detail?.fulfillment)
      : null
    const fulfillment = conflictFulfillment && string(conflictFulfillment.clientFulfillmentId)
      ? {
          id: string(conflictFulfillment.id) ?? `server:${operation.clientOpId}`,
          clientFulfillmentId: string(conflictFulfillment.clientFulfillmentId)!,
          outcome: String(conflictFulfillment.outcome) as FieldCommitmentFulfillment["outcome"],
          actualQuantity: Number(conflictFulfillment.actualQuantity),
          varianceQuantity: Number(conflictFulfillment.varianceQuantity),
          note: typeof conflictFulfillment.note === "string" ? conflictFulfillment.note : null,
          fulfilledAt: string(conflictFulfillment.fulfilledAt) ?? operation.clientCreatedAt,
          evidencePhoto: null,
          syncState: "CONFLICT" as const,
        }
      : localFulfillment(commitment, operation)
    const state = syncState(operation.status)
    commitments[commitmentIndex] = {
      ...commitment,
      fulfillment,
      status: fulfillment.outcome,
      syncState: state,
    }
  }

  commitments = commitments
    .map((commitment) => ({
      ...commitment,
      status: effectiveStatus(commitment.dueAt, commitment.fulfillment, now),
    }))
    .sort((a, b) => {
      const aClosed = a.fulfillment ? 1 : 0
      const bClosed = b.fulfillment ? 1 : 0
      return aClosed - bClosed || a.dueAt.localeCompare(b.dueAt) || b.submittedAt.localeCompare(a.submittedAt)
    })

  return { commitments, capabilities }
}
