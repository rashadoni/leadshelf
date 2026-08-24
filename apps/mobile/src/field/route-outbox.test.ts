import { describe, expect, it, vi } from "vitest"
import { HttpError } from "../sync/ports-error"
import {
  parseFieldRouteCreatePayload,
  parseFieldRoutePublishPayload,
  parseFieldRouteUpdatePayload,
  sendFieldRouteOperation,
} from "./route-outbox"

const points = [{ customerId: "clinic-1", contactId: "doctor-1", plannedTime: null }]

describe("field route outbox", () => {
  it("validates durable create and update payloads", () => {
    expect(parseFieldRouteCreatePayload({
      localRouteId: "local-route-op-1",
      agentId: "agent-1",
      date: "2026-07-15T00:00:00.000Z",
      points,
    }).points[0]?.contactId).toBe("doctor-1")
    expect(parseFieldRouteUpdatePayload({ routeId: "route-1", expectedVersion: 3, points })).toMatchObject({ routeId: "route-1", expectedVersion: 3 })
    expect(() => parseFieldRouteUpdatePayload({ routeId: "route-1", points })).toThrow()
    expect(() => parseFieldRoutePublishPayload({ routeId: "route-1" })).toThrow()
    expect(() => parseFieldRouteUpdatePayload({ routeId: "route-1", points: [{}] })).toThrow()
  })

  it("treats a duplicate create after a lost response as already applied", async () => {
    const api = {
      createRoute: vi.fn().mockRejectedValue(new HttpError(409, "duplicate", {
        code: "ROUTE_DUPLICATE",
        duplicate: { id: "route-existing" },
      })),
      updateRoute: vi.fn(),
      publishRoute: vi.fn(),
      requestRouteChange: vi.fn(),
    }
    const result = await sendFieldRouteOperation({
      clientOpId: "op-create-0001",
      kind: "field.route.create",
      payload: {
        localRouteId: "local-route-op-create-0001",
        agentId: "agent-1",
        date: "2026-07-15T00:00:00.000Z",
        points,
      },
    }, api)
    expect(result).toEqual({
      clientOpId: "op-create-0001",
      status: "already_applied",
      detail: { routeId: "route-existing", duplicate: true },
    })
  })

  it("keeps transient failures retryable and classifies deterministic conflicts", async () => {
    const conflictApi = {
      createRoute: vi.fn(),
      updateRoute: vi.fn().mockRejectedValue(new HttpError(409, "changed", { code: "ROUTE_DUPLICATE" })),
      publishRoute: vi.fn(),
      requestRouteChange: vi.fn(),
    }
    await expect(sendFieldRouteOperation({
      clientOpId: "op-update-0001",
      kind: "field.route.update",
      payload: { routeId: "route-1", expectedVersion: 3, points },
    }, conflictApi)).resolves.toMatchObject({ status: "conflict" })

    const transientApi = {
      createRoute: vi.fn().mockRejectedValue(new HttpError(503, "offline")),
      updateRoute: vi.fn(),
      publishRoute: vi.fn(),
      requestRouteChange: vi.fn(),
    }
    await expect(sendFieldRouteOperation({
      clientOpId: "op-create-0002",
      kind: "field.route.create",
      payload: {
        localRouteId: "local-route-op-create-0002",
        agentId: "agent-1",
        date: "2026-07-15T00:00:00.000Z",
        points,
      },
    }, transientApi)).rejects.toThrow("offline")
  })

  it("dispatches publication and approval requests through the same queue contract", async () => {
    const api = {
      createRoute: vi.fn(),
      updateRoute: vi.fn(),
      publishRoute: vi.fn().mockResolvedValue({ version: 4 }),
      requestRouteChange: vi.fn().mockResolvedValue(undefined),
    }
    await expect(sendFieldRouteOperation({
      clientOpId: "op-publish-0001",
      kind: "field.route.publish",
      payload: { routeId: "route-1", expectedVersion: 3 },
    }, api)).resolves.toMatchObject({ status: "applied", detail: { routeId: "route-1", version: 4 } })
    await expect(sendFieldRouteOperation({
      clientOpId: "op-change-0001",
      kind: "field.route.change-request",
      payload: {
        routeId: "route-1",
        changeType: "ADD_STOP",
        reason: "Urgent doctor visit",
        payload: { customerId: "clinic-1", contactId: "doctor-1" },
      },
    }, api)).resolves.toMatchObject({ status: "applied" })
    expect(api.publishRoute).toHaveBeenCalledWith("route-1", 3)
    expect(api.requestRouteChange).toHaveBeenCalledWith("route-1", expect.objectContaining({ changeType: "ADD_STOP" }))
  })
})
