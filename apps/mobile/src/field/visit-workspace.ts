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
