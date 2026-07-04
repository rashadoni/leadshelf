import { describe, expect, it } from "vitest"
import { buildAlertMessage, buildMorningDigest, buildPushPayload } from "./events.ts"

describe("alert events", () => {
  it("builds typed alert copy and defaults visit anomalies to critical", () => {
    expect(
      buildAlertMessage({
        kind: "visit.anomaly",
        storeName: "Apteka 1",
        entityTitle: "Geofence breach",
      }),
    ).toEqual({
      title: "Visit anomalies",
      body: "Geofence breach needs review at Apteka 1.",
      severity: "critical",
    })
  })

  it("builds push payload with routing metadata", () => {
    expect(
      buildPushPayload({
        eventId: "event-1",
        alertId: "alert-1",
        kind: "task.overdue",
        entityTitle: "OTC shelf",
      }),
    ).toMatchObject({
      title: "Overdue tasks",
      data: { eventId: "event-1", alertId: "alert-1", kind: "task.overdue" },
    })
  })

  it("summarizes open alerts for the morning digest", () => {
    const digest = buildMorningDigest([
      { kind: "task.overdue", severity: "warning" },
      { kind: "visit.anomaly", severity: "critical" },
      { kind: "stock.gap", severity: "warning" },
    ])
    expect(digest).toMatchObject({
      total: 3,
      critical: 1,
      warning: 2,
      byKind: { "task.overdue": 1, "visit.anomaly": 1, "stock.gap": 1, "import.errors": 0 },
    })
    expect(digest.body).toContain("Overdue tasks: 1")
  })
})
