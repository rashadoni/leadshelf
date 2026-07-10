import { describe, expect, it } from "vitest"
import type { MobileTaskStatus } from "@leadshelf/api-contracts/mobile/v1"
import { countOpenTaskStatuses, isOpenTaskStatus, OPEN_TASK_STATUSES } from "./status"

describe("open task status semantics", () => {
  it("matches the office definition of work that is still open", () => {
    expect(OPEN_TASK_STATUSES).toEqual(["NEW", "IN_PROGRESS", "PHOTO_SUBMITTED"])
  })

  it("excludes terminal and expired tasks", () => {
    const statuses: MobileTaskStatus[] = [
      "NEW",
      "IN_PROGRESS",
      "PHOTO_SUBMITTED",
      "COMPLETED",
      "EXPIRED",
      "EMPTY",
    ]

    expect(countOpenTaskStatuses(statuses)).toBe(3)
    expect(isOpenTaskStatus("EXPIRED")).toBe(false)
  })
})

