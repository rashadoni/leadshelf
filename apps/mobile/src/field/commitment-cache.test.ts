import { describe, expect, it } from "vitest"
import type { FieldCommitmentsData } from "./contracts"
import {
  projectFieldCommitments,
  type FieldCommitmentProjectionOperation,
} from "./commitment-cache"

const createPayload = {
  clientCommitmentId: "commitment-client-1",
  visitId: "visit-1",
  customerId: "clinic-1",
  customerName: "New Clinic",
  customerType: "CLINIC",
  contactId: "doctor-1",
  contactName: "Dr Aliyev",
  productExternalId: "sku-acc-200",
  productName: "ACC 200 mg",
  brandExternalId: "brand-acc",
  brandName: "ACC",
  promisedQuantity: 10,
  unit: "packs",
  dueAt: "2099-07-20T18:00:00.000Z",
  note: null,
  evidenceClientPhotoId: "commitment-photo-1",
}

const createOperation: FieldCommitmentProjectionOperation = {
  clientOpId: "commitment-op-1",
  clientCreatedAt: "2026-07-16T08:00:00.000Z",
  kind: "field.commitment.create",
  payload: createPayload,
  status: "pending",
  detail: null,
}

describe("commitment offline projection", () => {
  it("shows a queued promise immediately with customer context and evidence marker", () => {
    const projected = projectFieldCommitments(null, [createOperation])

    expect(projected.commitments[0]).toMatchObject({
      id: "local:commitment-client-1",
      productName: "ACC 200 mg",
      promisedQuantity: 10,
      status: "OPEN",
      syncState: "PENDING",
      evidenceClientPhotoId: "commitment-photo-1",
      customer: { name: "New Clinic" },
    })
  })

  it("adopts the server id and does not duplicate a refreshed promise", () => {
    const applied = projectFieldCommitments(null, [{
      ...createOperation,
      status: "applied",
      detail: { id: "commitment-server-1", serverId: "commitment-server-1" },
    }])
    expect(applied.commitments[0]?.id).toBe("commitment-server-1")
    expect(applied.commitments[0]?.syncState).toBeUndefined()

    const cached: FieldCommitmentsData = {
      capabilities: applied.capabilities,
      commitments: [{ ...applied.commitments[0]!, customer: { ...applied.commitments[0]!.customer, city: "Baku" } }],
    }
    const refreshed = projectFieldCommitments(cached, [{ ...createOperation, status: "applied", detail: null }])
    expect(refreshed.commitments).toHaveLength(1)
    expect(refreshed.commitments[0]?.customer.city).toBe("Baku")
  })

  it("projects the later fact and exact variance without mutating the promise", () => {
    const created = projectFieldCommitments(null, [{
      ...createOperation,
      status: "applied",
      detail: { serverId: "commitment-server-1" },
    }])
    const projected = projectFieldCommitments(created, [{
      clientOpId: "fulfillment-op-1",
      clientCreatedAt: "2026-07-20T09:00:00.000Z",
      kind: "field.commitment.fulfill",
      payload: {
        commitmentId: "commitment-server-1",
        clientFulfillmentId: "fulfillment-client-1",
        outcome: "PARTIAL",
        actualQuantity: 4.5,
        note: "Only part delivered",
        evidenceClientPhotoId: null,
      },
      status: "pending",
      detail: null,
    }])

    expect(projected.commitments[0]).toMatchObject({
      promisedQuantity: 10,
      status: "PARTIAL",
      syncState: "PENDING",
      fulfillment: {
        actualQuantity: 4.5,
        varianceQuantity: -5.5,
        syncState: "PENDING",
      },
    })
  })

  it("keeps deterministic conflict state visible for recovery", () => {
    const projected = projectFieldCommitments(null, [{ ...createOperation, status: "conflict" }])
    expect(projected.commitments[0]?.syncState).toBe("CONFLICT")
  })
})
