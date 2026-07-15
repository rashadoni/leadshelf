import { describe, expect, it } from "vitest"
import {
  appendOptimisticFieldLocation,
  applyOptimisticWorkdayAction,
  emptyFieldWorkdayData,
} from "./workday-state"

const point = { latitude: 40.4, longitude: 49.8, accuracy: 10, note: null }

describe("optimistic field workday", () => {
  it("runs start, pause, resume and finish without losing paused time", () => {
    let data = emptyFieldWorkdayData("2026-07-15", "Asia/Baku")
    data = applyOptimisticWorkdayAction(data, "START", {
      ...point,
      workdayId: "workday-1",
      clientEventId: "event-start",
      occurredAt: "2026-07-15T05:00:00.000Z",
    })
    data = applyOptimisticWorkdayAction(data, "PAUSE", {
      ...point,
      workdayId: "workday-1",
      clientEventId: "event-pause",
      occurredAt: "2026-07-15T06:00:00.000Z",
    })
    data = applyOptimisticWorkdayAction(data, "RESUME", {
      ...point,
      workdayId: "workday-1",
      clientEventId: "event-resume",
      occurredAt: "2026-07-15T06:30:00.000Z",
    })
    data = applyOptimisticWorkdayAction(data, "FINISH", {
      ...point,
      workdayId: "workday-1",
      clientEventId: "event-finish",
      occurredAt: "2026-07-15T08:00:00.000Z",
    })

    expect(data.workday).toMatchObject({
      status: "COMPLETED",
      totalPausedSeconds: 1_800,
      workedSeconds: 9_000,
      availableActions: [],
      syncState: "PENDING",
    })
    expect(data.workday?.events.map((event) => event.type)).toEqual(["START", "PAUSE", "RESUME", "FINISH"])
  })

  it("rejects an impossible transition locally", () => {
    const data = emptyFieldWorkdayData("2026-07-15", "Asia/Baku")
    expect(() => applyOptimisticWorkdayAction(data, "PAUSE", {
      ...point,
      workdayId: "missing",
      clientEventId: "event-pause",
      occurredAt: "2026-07-15T06:00:00.000Z",
    })).toThrow("Workday not found")
  })

  it("appends a pending GPS point and updates travelled distance", () => {
    const next = appendOptimisticFieldLocation({
      date: "2026-07-15",
      timezone: "Asia/Baku",
      gpsIntervalSeconds: 30,
      distanceMeters: 0,
      locations: [{
        id: "gps-1",
        clientLocationId: "gps-1",
        latitude: 40.4,
        longitude: 49.8,
        accuracy: 10,
        speed: 0,
        heading: 0,
        altitude: 0,
        battery: null,
        isMoving: false,
        recordedAt: "2026-07-15T05:00:00.000Z",
      }],
    }, {
      clientLocationId: "gps-2",
      latitude: 40.401,
      longitude: 49.8,
      accuracy: 8,
      speed: 1,
      heading: 0,
      altitude: 0,
      battery: null,
      recordedAt: "2026-07-15T05:01:00.000Z",
    })
    expect(next.distanceMeters).toBeGreaterThan(100)
    expect(next.locations.at(-1)).toMatchObject({ id: "gps-2", syncState: "PENDING" })
  })
})
