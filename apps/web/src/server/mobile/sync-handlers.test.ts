import { beforeEach, describe, expect, it, vi } from "vitest"

const { ackCursors, workerDb } = vi.hoisted(() => ({
  ackCursors: vi.fn(),
  workerDb: {},
}))

vi.mock("@/server/db/client", () => ({ workerDb }))
vi.mock("@leadshelf/db", () => ({
  ackCursors,
  pullChanges: vi.fn(),
  pushOperations: vi.fn(),
  storedCursors: vi.fn(),
}))

import { handleMobileAck } from "./sync-handlers"

const session = { org: "org-1", sub: "agent-1", did: "device-1", role: "FIELD_AGENT" }

describe("shared mobile sync handlers", () => {
  beforeEach(() => vi.clearAllMocks())

  it("accepts null cursors from an empty initial pull and persists only real cursors", async () => {
    const response = await handleMobileAck({
      protocolVersion: 1,
      appliedCursors: {
        tasks: null,
        planogramBundles: "cursor-2",
        routes: null,
        visits: null,
        photoSubmissions: null,
      },
    }, session)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(ackCursors).toHaveBeenCalledWith(workerDb, "device-1", {
      planogramBundles: "cursor-2",
    })
  })
})
