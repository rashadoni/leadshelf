import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const { queryRaw, checkObjectStorage, getObjectStorageInventory } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  checkObjectStorage: vi.fn(),
  getObjectStorageInventory: vi.fn(),
}))

vi.mock("@/server/db/client", () => ({ authDb: { $queryRaw: queryRaw } }))
vi.mock("@/server/storage/s3", () => ({ checkObjectStorage, getObjectStorageInventory }))

import { GET } from "./route"

describe("operations metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.METRICS_BEARER_TOKEN = "metrics-test-token-with-safe-length"
  })

  it("does not disclose whether the metrics endpoint exists without its bearer token", async () => {
    const response = await GET(new NextRequest("http://localhost/api/metrics"))
    expect(response.status).toBe(404)
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it("exports bounded aggregate readiness, backlog and recent-failure signals", async () => {
    queryRaw
      .mockResolvedValueOnce([{ value: 1024n }])
      .mockResolvedValueOnce([{ status: "FAILED", count: 4n }])
      .mockResolvedValueOnce([{ value: 2n }])
      .mockResolvedValueOnce([{ status: "PENDING", count: 3n }])
      .mockResolvedValueOnce([{ value: 901 }])
      .mockResolvedValueOnce([{ value: 2n }])
      .mockResolvedValueOnce([{ value: 450 }])
      .mockResolvedValueOnce([{ status: "FAILED", count: 1n }])
      .mockResolvedValueOnce([{ status: "FAILED", count: 2n }])
      .mockResolvedValueOnce([{ value: 1_700_000_000 }])
      .mockResolvedValueOnce([{ value: 4n }])
      .mockResolvedValueOnce([{ value: 3n }])
      .mockResolvedValueOnce([{ value: 1n }])
      .mockResolvedValueOnce([{ value: 2n }])
      .mockResolvedValueOnce([{ value: 902 }])
      .mockResolvedValueOnce([{ value: 903 }])
    checkObjectStorage.mockResolvedValue(undefined)
    getObjectStorageInventory.mockResolvedValue({ objects: 8, bytes: 4096, collectedAtMs: Date.now() })

    const response = await GET(new NextRequest("http://localhost/api/metrics", {
      headers: { authorization: "Bearer metrics-test-token-with-safe-length" },
    }))
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0")
    expect(queryRaw).toHaveBeenCalledTimes(16)
    expect(body).toContain("leadshelf_object_storage_ready 1")
    expect(body).toContain("leadshelf_import_oldest_pending_seconds 901")
    expect(body).toContain("leadshelf_import_full_sync_waiting_approval 2")
    expect(body).toContain("leadshelf_import_full_sync_oldest_waiting_approval_seconds 450")
    expect(body).toContain("leadshelf_mobile_outbox_failures_recent 4")
    expect(body).toContain("leadshelf_import_failures_recent 3")
    expect(body).toContain("leadshelf_proof_analysis_failures_recent 1")
    expect(body).toContain("leadshelf_notification_failures_recent 2")
    expect(body).toContain("leadshelf_proof_analysis_oldest_pending_seconds 902")
    expect(body).toContain("leadshelf_notification_oldest_pending_seconds 903")
    expect(body).not.toContain("metrics-test-token")
  })
})
