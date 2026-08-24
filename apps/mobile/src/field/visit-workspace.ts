import type {
  FieldVisitActionResult,
  FieldVisitPhoto,
  FieldVisitRequirement,
  FieldVisitWorkspaceData,
  FieldWeekData,
} from "./contracts"
import type { FieldVisitActionPayload } from "./execution-outbox"
import { findFieldVisit, routePointVisitPolicy } from "./visit-cache"

export function localFieldVisitWorkspace(
  week: FieldWeekData | null,
  visitId: string,
  agentId: string,
): FieldVisitWorkspaceData | null {
  const visit = findFieldVisit(week, visitId)
  if (!visit) return null
  const policy = routePointVisitPolicy(week, visit.routePointId)
  return {
    visit: {
      ...visit,
      agentId,
      checkInLat: null,
      checkInLng: null,
      checkOutLat: null,
      checkOutLng: null,
      duration: null,
      nextActionDueAt: null,
      requirementSnapshot: policy ? {
        id: `local-policy-${visit.id}`,
        sourcePolicyId: policy.sourcePolicyId,
        resolvedAt: visit.checkInAt,
        sourcePolicy: policy.sourcePolicyId ? {
          id: policy.sourcePolicyId,
          name: policy.sourcePolicyName ?? policy.sourcePolicyId,
        } : null,
        requirements: policy.requirements,
      } : null,
      actionResults: [],
      photos: [],
      tasks: [],
    },
    reminders: [],
  }
}

export function addOptimisticVisitAction(
  workspace: FieldVisitWorkspaceData,
  payload: FieldVisitActionPayload,
): FieldVisitWorkspaceData {
  if (workspace.visit.actionResults.some((result) => result.id === payload.actionResultId)) return workspace
  const result: FieldVisitActionResult = {
    id: payload.actionResultId,
    requirementId: workspace.visit.requirementSnapshot?.requirements.find(
      (requirement) => requirement.actionKey === payload.actionKey,
    )?.id ?? null,
    actionKey: payload.actionKey,
    status: payload.status,
    evidence: payload.evidence ?? null,
    completedAt: payload.completedAt,
    createdAt: payload.completedAt,
    syncState: "PENDING",
  }
  return {
    ...workspace,
    visit: {
      ...workspace.visit,
      actionResults: [...workspace.visit.actionResults, result],
    },
  }
}

export type FieldVisitActionDraft = {
  waiverReason: string
  presentationMaterial: string
  presentationVersion: string
  presentationTopic: string
  stockProduct: string
  stockState: "AVAILABLE" | "NOT_AVAILABLE" | "UNKNOWN"
  stockQuantity: string
  checklistResult: string
  finalNote: string
  discussedTopics: string
  feedback: string
  nextActionTitle: string
  nextDueDate: string
  nextDueTime: string
  nextPriority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"
}

export type FieldVisitActionDraftIssue =
  | "REQUIRED"
  | "STOCK_QUANTITY"
  | "NEXT_ACTION_DATE"

export function emptyVisitActionDraft(nextDueDate = ""): FieldVisitActionDraft {
  return {
    waiverReason: "",
    presentationMaterial: "",
    presentationVersion: "",
    presentationTopic: "",
    stockProduct: "",
    stockState: "UNKNOWN",
    stockQuantity: "",
    checklistResult: "",
    finalNote: "",
    discussedTopics: "",
    feedback: "",
    nextActionTitle: "",
    nextDueDate,
    nextDueTime: "09:00",
    nextPriority: "MEDIUM",
  }
}

function localDateTimeToIso(dateKey: string, time: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dateMatch || !timeMatch) return null
  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  const local = new Date(year, month - 1, day, hour, minute)
  if (
    local.getFullYear() !== year ||
    local.getMonth() !== month - 1 ||
    local.getDate() !== day ||
    local.getHours() !== hour ||
    local.getMinutes() !== minute
  ) return null
  return local.toISOString()
}

function normalizedTopics(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean)
}

/**
 * Mobile action evidence intentionally follows the web workspace contracts.
 * Keeping the transformations here prevents an offline outbox item from
 * silently degrading a structured presentation, stock check, or follow-up
 * into an opaque note.
 */
export function visitActionDraftIssue(input: {
  actionKey: FieldVisitActionPayload["actionKey"]
  status: FieldVisitActionPayload["status"]
  draft: FieldVisitActionDraft
  afterDateKey?: string
}): FieldVisitActionDraftIssue | null {
  const { actionKey, status, draft } = input
  if (status === "WAIVED") return draft.waiverReason.trim().length >= 2 ? null : "REQUIRED"

  if (actionKey === "PRESENTATION") return draft.presentationMaterial.trim() ? null : "REQUIRED"
  if (actionKey === "STOCK_CHECK") {
    if (!draft.stockProduct.trim()) return "REQUIRED"
    if (!draft.stockQuantity.trim()) return null
    const quantity = Number(draft.stockQuantity)
    return Number.isFinite(quantity) && quantity >= 0 ? null : "STOCK_QUANTITY"
  }
  if (actionKey === "CHECKLIST") return draft.checklistResult.trim() ? null : "REQUIRED"
  if (actionKey === "VISIT_NOTE") {
    return draft.finalNote.trim() || normalizedTopics(draft.discussedTopics).length ? null : "REQUIRED"
  }
  if (actionKey === "FEEDBACK") return draft.feedback.trim() ? null : "REQUIRED"
  if (actionKey === "NEXT_ACTION") {
    if (!draft.nextActionTitle.trim()) return "REQUIRED"
    if (!localDateTimeToIso(draft.nextDueDate, draft.nextDueTime)) return "NEXT_ACTION_DATE"
    if (input.afterDateKey && draft.nextDueDate <= input.afterDateKey) return "NEXT_ACTION_DATE"
  }
  return null
}

export function buildVisitActionEvidence(input: {
  actionKey: FieldVisitActionPayload["actionKey"]
  status: FieldVisitActionPayload["status"]
  draft: FieldVisitActionDraft
  completedAt: string
}): Record<string, unknown> {
  const { actionKey, status, draft } = input
  if (status === "WAIVED") return { reason: draft.waiverReason.trim() }

  if (actionKey === "PRESENTATION") {
    return {
      material: draft.presentationMaterial.trim(),
      version: draft.presentationVersion.trim(),
      topic: draft.presentationTopic.trim(),
      openedAt: input.completedAt,
      completedAt: input.completedAt,
    }
  }
  if (actionKey === "STOCK_CHECK") {
    return {
      product: draft.stockProduct.trim(),
      state: draft.stockState,
      quantity: draft.stockQuantity.trim() ? Number(draft.stockQuantity) : null,
    }
  }
  if (actionKey === "CHECKLIST") return { result: draft.checklistResult.trim() }
  if (actionKey === "VISIT_NOTE") {
    return {
      finalNote: draft.finalNote.trim() || null,
      discussedTopics: normalizedTopics(draft.discussedTopics),
    }
  }
  if (actionKey === "FEEDBACK") return { feedback: draft.feedback.trim() }
  if (actionKey === "NEXT_ACTION") {
    return {
      title: draft.nextActionTitle.trim(),
      dueDate: localDateTimeToIso(draft.nextDueDate, draft.nextDueTime),
      priority: draft.nextPriority,
    }
  }
  return {}
}

export function setVisitWorkspaceSyncState(
  workspace: FieldVisitWorkspaceData,
  syncState: "PENDING" | "CONFLICT" | "REJECTED",
): FieldVisitWorkspaceData {
  return {
    ...workspace,
    visit: { ...workspace.visit, syncState },
  }
}

export function setVisitActionSyncState(
  workspace: FieldVisitWorkspaceData,
  actionResultId: string,
  syncState: FieldVisitActionResult["syncState"],
): FieldVisitWorkspaceData {
  let changed = false
  const actionResults = workspace.visit.actionResults.map((result) => {
    if (result.id !== actionResultId) return result
    changed = true
    return { ...result, syncState }
  })
  return changed ? { ...workspace, visit: { ...workspace.visit, actionResults } } : workspace
}

export function visitRequirementProgress(
  workspace: FieldVisitWorkspaceData,
  requirement: FieldVisitRequirement,
): { completed: number; required: number; satisfied: boolean } {
  const actionCount = workspace.visit.actionResults.filter((result) => (
    result.actionKey === requirement.actionKey &&
    (result.status === "COMPLETED" || result.status === "WAIVED") &&
    result.syncState !== "REJECTED"
  )).length
  const completed = requirement.actionKey === "PHOTO"
    ? Math.max(
      actionCount,
      workspace.visit.photos.filter((photo) => photo.syncState !== "REJECTED").length,
    )
    : actionCount
  return {
    completed,
    required: requirement.minCount,
    satisfied: completed >= requirement.minCount,
  }
}

export function addOptimisticVisitPhoto(
  workspace: FieldVisitWorkspaceData,
  input: { clientPhotoId: string; fileUri: string; category: string | null; takenAt: string },
): FieldVisitWorkspaceData {
  if (workspace.visit.photos.some((photo) => photo.id === input.clientPhotoId)) return workspace
  const photo: FieldVisitPhoto = {
    id: input.clientPhotoId,
    url: input.fileUri,
    thumbnailUrl: null,
    category: input.category,
    status: "LOCAL_PENDING",
    createdAt: input.takenAt,
    localUri: input.fileUri,
    syncState: "PENDING",
  }
  return {
    ...workspace,
    visit: { ...workspace.visit, photos: [photo, ...workspace.visit.photos] },
  }
}

export function setVisitPhotoSyncState(
  workspace: FieldVisitWorkspaceData,
  clientPhotoId: string,
  syncState: FieldVisitPhoto["syncState"],
): FieldVisitWorkspaceData {
  let changed = false
  const photos = workspace.visit.photos.map((photo) => {
    if (photo.id !== clientPhotoId) return photo
    changed = true
    return { ...photo, syncState }
  })
  return changed ? { ...workspace, visit: { ...workspace.visit, photos } } : workspace
}

export function missingRequiredVisitActions(
  workspace: FieldVisitWorkspaceData,
): FieldVisitRequirement[] {
  return (workspace.visit.requirementSnapshot?.requirements ?? []).filter((requirement) => (
    requirement.mode === "REQUIRED" && !visitRequirementProgress(workspace, requirement).satisfied
  ))
}

/**
 * A rescheduled visit is only operationally complete when it has a real,
 * future follow-up. Pending local actions count so an offline agent can queue
 * the action and the checkout in causal order; rejected actions never count.
 */
export function hasFutureVisitNextAction(
  workspace: FieldVisitWorkspaceData,
  afterDateKey: string,
): boolean {
  const after = new Date(afterDateKey + "T23:59:59.999").getTime()
  if (!Number.isFinite(after)) return false
  return workspace.visit.actionResults.some((result) => {
    if (
      result.actionKey !== "NEXT_ACTION" ||
      result.status !== "COMPLETED" ||
      result.syncState === "REJECTED"
    ) return false
    const evidence = result.evidence
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false
    const dueAt = (evidence as Record<string, unknown>).dueDate
    if (typeof dueAt !== "string") return false
    const due = new Date(dueAt).getTime()
    return Number.isFinite(due) && due > after
  })
}

export function mergeServerVisitWorkspace(
  local: FieldVisitWorkspaceData | null,
  server: FieldVisitWorkspaceData,
): FieldVisitWorkspaceData {
  if (!local) return server
  const serverResultIds = new Set(server.visit.actionResults.map((result) => result.id))
  const pendingLocal = local.visit.actionResults.filter((result) => (
    !serverResultIds.has(result.id) && result.syncState === "PENDING"
  ))
  const serverPhotoIds = new Set(server.visit.photos.map((photo) => photo.id))
  const pendingLocalPhotos = local.visit.photos.filter((photo) => (
    !serverPhotoIds.has(photo.id) && photo.syncState === "PENDING"
  ))
  return {
    ...server,
    visit: {
      ...server.visit,
      actionResults: [...server.visit.actionResults, ...pendingLocal],
      photos: [...server.visit.photos, ...pendingLocalPhotos],
      syncState: local.visit.syncState === "PENDING" ? "PENDING" : server.visit.syncState,
    },
  }
}
