import { describe, expect, it } from "vitest"
import {
  lockCachedWorkdayActionsUntilRefresh,
  lockWorkdayActionsUntilRefresh,
  workdayActionsAfterOutboxResult,
  workdayRecoveryDetail,
} from "./workday-recovery"
import { applyOptimisticWorkdayAction, emptyFieldWorkdayData } from "./workday-state"

describe("workdayRecoveryDetail", () => {
  it("keeps the server state and allowed actions from a Workforce conflict", () => {
    expect(workdayRecoveryDetail({
      code: "MTM_WORKDAY_NOT_RUNNING",
      workday: { id: "workday-1", status: "PAUSED" },
      allowedActions: ["RESUME", "FINISH"],
    })).toEqual({
      code: "MTM_WORKDAY_NOT_RUNNING",
      serverStatus: "PAUSED",
      allowedActions: ["RESUME", "FINISH"],
    })
  })

  it("does not invent recovery actions for an older response without them", () => {
    expect(workdayRecoveryDetail({
      code: "MTM_WORKDAY_ACTIVE",
      workday: { id: "workday-1", status: "STARTED" },
    })).toEqual({
      code: "MTM_WORKDAY_ACTIVE",
      serverStatus: "STARTED",
      allowedActions: null,
    })
  })

  it("fails closed for malformed state/action data", () => {
    expect(workdayRecoveryDetail({
      code: "MTM_WORKDAY_BAD",
      workday: { status: "UNKNOWN" },
      allowedActions: ["PAUSE", "DELETE", "PAUSE", 1],
    })).toEqual({
      code: "MTM_WORKDAY_BAD",
      serverStatus: null,
      allowedActions: null,
    })
  })

  it("removes unknown and duplicate actions without changing the server order", () => {
    expect(workdayRecoveryDetail({
      workday: { status: "STARTED" },
      allowedActions: ["FINISH", "DELETE", "PAUSE", "FINISH"],
    })).toEqual({
      code: null,
      serverStatus: "STARTED",
      allowedActions: ["FINISH", "PAUSE"],
    })
  })

  it("keeps recovery actions informational until a canonical refresh", () => {
    let data = emptyFieldWorkdayData("2026-07-15", "Asia/Baku")
    data = applyOptimisticWorkdayAction(data, "START", {
      workdayId: "workday-1",
      clientEventId: "event-start",
      occurredAt: "2026-07-15T05:00:00.000Z",
      latitude: null,
      longitude: null,
      accuracy: null,
      note: null,
    })
    data = applyOptimisticWorkdayAction(data, "PAUSE", {
      workdayId: "workday-1",
      clientEventId: "event-pause",
      occurredAt: "2026-07-15T06:00:00.000Z",
      latitude: null,
      longitude: null,
      accuracy: null,
      note: null,
    })

    expect(workdayActionsAfterOutboxResult("conflict", ["RESUME", "FINISH"])).toEqual([])
    expect(workdayActionsAfterOutboxResult("rejected", ["RESUME", "FINISH"])).toEqual([])
    expect(workdayActionsAfterOutboxResult("applied", ["RESUME", "FINISH"])).toEqual(["RESUME", "FINISH"])
    const locked = lockWorkdayActionsUntilRefresh(data)
    expect(locked.availableActions).toEqual([])
    expect(locked.workday?.availableActions).toEqual([])
    expect(() => applyOptimisticWorkdayAction(locked, "RESUME", {
      workdayId: "workday-1",
      clientEventId: "event-resume",
      occurredAt: "2026-07-15T06:30:00.000Z",
      latitude: null,
      longitude: null,
      accuracy: null,
      note: null,
    })).toThrow("Workday action is not available")
  })

  it("locks a cached START even when a rejected event has no workday payload", () => {
    expect(lockCachedWorkdayActionsUntilRefresh({
      availableActions: ["START"],
      workday: null,
      activeWorkday: null,
    })).toEqual({
      availableActions: [],
      workday: null,
      activeWorkday: null,
    })
  })
})
