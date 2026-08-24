import { describe, expect, it } from "vitest"
import type { FieldVisitWorkspaceData } from "./contracts"
import {
  addOptimisticVisitPhoto,
  addOptimisticVisitAction,
  buildVisitActionEvidence,
  emptyVisitActionDraft,
  hasFutureVisitNextAction,
  mergeServerVisitWorkspace,
  missingRequiredVisitActions,
  setVisitWorkspaceSyncState,
  visitActionDraftFromEvidence,
  visitActionDraftIssue,
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
    const draft = { ...emptyVisitActionDraft(), waiverReason: "Customer refused access" }
    expect(buildVisitActionEvidence({
      actionKey: "CHECKLIST",
      status: "WAIVED",
      draft,
      completedAt: "2026-07-15T08:20:00.000Z",
    })).toEqual({ reason: "Customer refused access" })
  })

  it("matches the web evidence contracts for every structured visit action", () => {
    const completedAt = "2026-07-15T08:20:00.000Z"
    const draft = {
      ...emptyVisitActionDraft("2026-07-16"),
      presentationMaterial: "Detailing aid",
      presentationVersion: "v2",
      presentationTopic: "Launch",
      stockProduct: "Product A",
      stockState: "AVAILABLE" as const,
      stockQuantity: "12",
      checklistResult: "Shelf and price checked",
      finalNote: "Customer requested a follow-up",
      discussedTopics: "launch, pricing",
      feedback: "Positive",
      nextActionTitle: "Call the buyer",
      nextDueTime: "10:45",
      nextPriority: "HIGH" as const,
    }
    expect(buildVisitActionEvidence({
      actionKey: "PRESENTATION",
      status: "COMPLETED",
      draft,
      completedAt,
    })).toEqual({
      material: "Detailing aid",
      version: "v2",
      topic: "Launch",
      openedAt: completedAt,
      completedAt,
    })
    expect(buildVisitActionEvidence({
      actionKey: "STOCK_CHECK",
      status: "COMPLETED",
      draft,
      completedAt,
    })).toEqual({ product: "Product A", state: "AVAILABLE", quantity: 12 })
    expect(buildVisitActionEvidence({
      actionKey: "CHECKLIST",
      status: "COMPLETED",
      draft,
      completedAt,
    })).toEqual({ result: "Shelf and price checked" })
    expect(buildVisitActionEvidence({
      actionKey: "VISIT_NOTE",
      status: "COMPLETED",
      draft,
      completedAt,
    })).toEqual({
      finalNote: "Customer requested a follow-up",
      discussedTopics: ["launch", "pricing"],
    })
    expect(buildVisitActionEvidence({
      actionKey: "FEEDBACK",
      status: "COMPLETED",
      draft,
      completedAt,
    })).toEqual({ feedback: "Positive" })
    expect(buildVisitActionEvidence({
      actionKey: "NEXT_ACTION",
      status: "COMPLETED",
      draft,
      completedAt,
    })).toEqual({
      title: "Call the buyer",
      dueDate: new Date(2026, 6, 16, 10, 45).toISOString(),
      priority: "HIGH",
    })
    expect(visitActionDraftIssue({
      actionKey: "NEXT_ACTION",
      status: "COMPLETED",
      draft,
      afterDateKey: "2026-07-15",
    })).toBeNull()
    expect(visitActionDraftIssue({
      actionKey: "STOCK_CHECK",
      status: "COMPLETED",
      draft: { ...draft, stockQuantity: "-2" },
    })).toBe("STOCK_QUANTITY")
  })

  it("prefills and replaces a saved mobile follow-up during correction", () => {
    const first = addOptimisticVisitAction(workspace, {
      actionResultId: "action-next",
      visitId: "visit-1",
      actionKey: "NEXT_ACTION",
      status: "COMPLETED",
      evidence: {
        title: "Call doctor",
        dueDate: "2026-07-16T09:30:00.000Z",
        priority: "MEDIUM",
      },
      completedAt: "2026-07-15T08:20:00.000Z",
    })
    const corrected = addOptimisticVisitAction(first, {
      actionResultId: "action-next",
      visitId: "visit-1",
      actionKey: "NEXT_ACTION",
      status: "COMPLETED",
      evidence: {
        title: "Call buyer at 10",
        dueDate: "2026-07-16T10:00:00.000Z",
        priority: "HIGH",
      },
      completedAt: "2026-07-15T08:25:00.000Z",
    })
    expect(corrected.visit.actionResults).toHaveLength(1)
    expect(corrected.visit.actionResults[0]).toMatchObject({
      id: "action-next",
      evidence: {
        title: "Call buyer at 10",
        priority: "HIGH",
      },
      syncState: "PENDING",
    })
    expect(visitActionDraftFromEvidence(
      "NEXT_ACTION",
      corrected.visit.actionResults[0].evidence,
      "2026-07-16",
    )).toMatchObject({
      nextActionTitle: "Call buyer at 10",
      nextPriority: "HIGH",
      nextDueDate: "2026-07-16",
    })
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
