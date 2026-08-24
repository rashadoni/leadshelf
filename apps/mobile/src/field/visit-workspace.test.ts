import { describe, expect, it } from "vitest"
import type { FieldVisitWorkspaceData } from "./contracts"
import {
  addOptimisticVisitPhoto,
  addOptimisticVisitAction,
  buildVisitActionEvidence,
  hasFutureVisitNextAction,
  mergeServerVisitWorkspace,
  missingRequiredVisitActions,
  setVisitWorkspaceSyncState,
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

  it("requires a completed future next action when rescheduling", () => {
    const dueToday = addOptimisticVisitAction(workspace, {
      actionResultId: "action-next-today",
      visitId: "visit-1",
      actionKey: "NEXT_ACTION",
      status: "COMPLETED",
      evidence: { title: "Call again", dueDate: "2026-07-15T09:00:00.000Z" },
      completedAt: "2026-07-15T08:20:00.000Z",
    })
    expect(hasFutureVisitNextAction(dueToday, "2026-07-15")).toBe(false)

    const future = addOptimisticVisitAction(workspace, {
      actionResultId: "action-next-future",
      visitId: "visit-1",
      actionKey: "NEXT_ACTION",
      status: "COMPLETED",
      evidence: { title: "Call again", dueDate: "2026-07-16T09:00:00.000Z" },
      completedAt: "2026-07-15T08:20:00.000Z",
    })
    expect(hasFutureVisitNextAction(future, "2026-07-15")).toBe(true)
  })

  it("sends a waiver reason instead of ordinary completed-action evidence", () => {
    expect(buildVisitActionEvidence({
      actionKey: "CHECKLIST",
      status: "WAIVED",
      note: "Customer refused access",
    })).toEqual({ reason: "Customer refused access" })
    expect(buildVisitActionEvidence({
      actionKey: "CHECKLIST",
      status: "COMPLETED",
      note: "Shelf checked",
    })).toEqual({ note: "Shelf checked" })
  })

  it("keeps the workspace visit open after a rejected checkout", () => {
    const checkedIn = {
      ...workspace,
      visit: { ...workspace.visit, status: "CHECKED_IN", checkOutAt: null },
    } as unknown as FieldVisitWorkspaceData
    expect(setVisitWorkspaceSyncState(checkedIn, "REJECTED").visit).toMatchObject({
      status: "CHECKED_IN",
      checkOutAt: null,
      syncState: "REJECTED",
    })
  })
})
