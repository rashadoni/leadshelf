import { describe, expect, it } from "vitest"
import type { TaskRow } from "../sync/ports"
import { groupTasksForWorkQueue } from "./work-queue"

function task(id: string, status: TaskRow["status"], dueAt: string | null): TaskRow {
  return {
    id,
    title: id,
    status,
    dueAt,
    storeId: "store-1",
    planogramVersionId: null,
    updatedAt: "2026-07-11T08:00:00Z",
  }
}

describe("merchandiser task work queue", () => {
  const now = new Date(2026, 6, 11, 12, 0, 0)

  it("puts active work ahead of new and closed tasks", () => {
    const groups = groupTasksForWorkQueue([
      task("done", "COMPLETED", "2026-07-11T09:00:00Z"),
      task("photo", "PHOTO_SUBMITTED", "2026-07-11T10:00:00Z"),
      task("started", "IN_PROGRESS", "2026-07-11T08:00:00Z"),
    ], now)

    expect(groups.active.map((item) => item.id)).toEqual(["started", "photo"])
    expect(groups.closed.map((item) => item.id)).toEqual(["done"])
  })

  it("keeps overdue and today tasks together and future work separate", () => {
    const groups = groupTasksForWorkQueue([
      task("overdue", "NEW", "2026-07-10T12:00:00Z"),
      task("today", "NEW", "2026-07-11T18:00:00Z"),
      task("future", "NEW", "2026-07-12T08:00:00Z"),
      task("unscheduled", "NEW", null),
    ], now)

    expect(groups.today.map((item) => item.id)).toEqual(["overdue", "today"])
    expect(groups.upcoming.map((item) => item.id)).toEqual(["future", "unscheduled"])
  })
})
