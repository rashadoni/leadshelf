import { describe, expect, it } from "vitest"
import type { FieldVisitWorkspaceData } from "./contracts"
import {
  addOptimisticVisitPhoto,
  addOptimisticVisitAction,
  mergeServerVisitWorkspace,
  missingRequiredVisitActions,
} from "./visit-workspace"

const workspace = {
  visit: {
    id: "visit-1",
    requirementSnapshot: {
      requirements: [{
        id: "requirement-note",
        actionKey: "VISIT_NOTE",
        mode: "REQUIRED",
        minCount: 1,
        conditions: null,
        allowWaiver: false,
      }],
    },
    actionResults: [],
    photos: [],
  },
  reminders: [],
} as unknown as FieldVisitWorkspaceData

describe("field visit workspace", () => {
  it("tracks policy readiness from queued action evidence", () => {
    expect(missingRequiredVisitActions(workspace).map((item) => item.actionKey)).toEqual(["VISIT_NOTE"])
    const next = addOptimisticVisitAction(workspace, {
      actionResultId: "action-local-1",
      visitId: "visit-1",
      actionKey: "VISIT_NOTE",
      status: "COMPLETED",
      evidence: { note: "Discussed launch" },
      completedAt: "2026-07-15T08:20:00.000Z",
    })
    expect(next.visit.actionResults[0]).toMatchObject({
      id: "action-local-1",
      requirementId: "requirement-note",
      syncState: "PENDING",
    })
    expect(missingRequiredVisitActions(next)).toEqual([])
  })

  it("keeps unsent local evidence when refreshing the server workspace", () => {
    const local = addOptimisticVisitAction(workspace, {
      actionResultId: "action-local-1",
      visitId: "visit-1",
      actionKey: "VISIT_NOTE",
      status: "COMPLETED",
      completedAt: "2026-07-15T08:20:00.000Z",
    })
    const merged = mergeServerVisitWorkspace(local, {
      ...workspace,
      visit: { ...workspace.visit, actionResults: [] },
    })
    expect(merged.visit.actionResults.map((result) => result.id)).toEqual(["action-local-1"])
  })

  it("counts queued visit photos and preserves them across a server refresh", () => {
    const photoWorkspace = {
      ...workspace,
      visit: {
        ...workspace.visit,
        requirementSnapshot: {
          requirements: [{
            id: "requirement-photo",
            actionKey: "PHOTO",
            mode: "REQUIRED",
            minCount: 1,
            conditions: null,
            allowWaiver: false,
          }],
        },
        photos: [],
      },
    } as unknown as FieldVisitWorkspaceData
    const local = addOptimisticVisitPhoto(photoWorkspace, {
      clientPhotoId: "mobile-photo-1",
      fileUri: "file:///photo.jpg",
      category: "visit",
      takenAt: "2026-07-15T08:15:00.000Z",
    })
    expect(missingRequiredVisitActions(local)).toEqual([])
    const merged = mergeServerVisitWorkspace(local, photoWorkspace)
    expect(merged.visit.photos[0]).toMatchObject({
      id: "mobile-photo-1",
      syncState: "PENDING",
    })
  })
})
