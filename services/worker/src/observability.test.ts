import { afterEach, describe, expect, it, vi } from "vitest"
import {
  safeOperationalCode,
  writeOperationalLog,
  type OperationalLogDetails,
} from "./observability"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("worker operational logging", () => {
  it("emits one-line JSON and drops fields outside the safe allowlist", () => {
    const sink = vi.spyOn(console, "log").mockImplementation(() => undefined)

    writeOperationalLog("info", "import-worker", "job_completed", {
      jobId: "job-1",
      batchId: "batch-1",
      status: "COMPLETED",
      token: "must-not-leak",
      email: "person@example.com",
    } as unknown as OperationalLogDetails)

    expect(sink).toHaveBeenCalledOnce()
    const line = sink.mock.calls[0]?.[0]
    expect(typeof line).toBe("string")
    const record = JSON.parse(String(line))
    expect(record).toMatchObject({
      level: "info",
      category: "operations",
      component: "import-worker",
      event: "job_completed",
      jobId: "job-1",
      batchId: "batch-1",
      status: "COMPLETED",
    })
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(line).not.toContain("must-not-leak")
    expect(line).not.toContain("person@example.com")
  })

  it("accepts only bounded machine-safe reason codes", () => {
    expect(safeOperationalCode("photo_not_found", "fallback")).toBe("photo_not_found")
    expect(safeOperationalCode("customer person@example.com", "fallback")).toBe("fallback")
    expect(safeOperationalCode("x".repeat(81), "fallback")).toBe("fallback")
  })
})
