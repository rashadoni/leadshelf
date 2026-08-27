import type { FieldRouteTargetCatalogItem } from "./contracts"
import { HttpError } from "../sync/ports-error"

export type FieldOrganizationQueryOptions = {
  search?: string
  page?: number
  limit?: number
  assignmentState?: "ASSIGNED" | "UNASSIGNED"
  asOf?: string
  status?: "ACTIVE" | "INACTIVE" | "PROSPECT"
  objectType?: string
  organizationKind?: string
}

export function fieldOrganizationQuery(options: FieldOrganizationQueryOptions = {}): string {
  const query = new URLSearchParams({
    page: String(options.page ?? 1),
    limit: String(options.limit ?? 50),
  })
  const search = options.search?.trim()
  if (search) query.set("search", search)
  if (options.assignmentState) query.set("assignmentState", options.assignmentState)
  if (options.asOf) query.set("asOf", options.asOf)
  if (options.status) query.set("status", options.status)
  if (options.objectType) query.set("objectType", options.objectType)
  if (options.organizationKind) query.set("organizationKind", options.organizationKind)
  return query.toString()
}

export function canSearchUnassignedOrganization(search: string): boolean {
  return search.trim().length >= 2
}

export type ExistingOrganizationAssignmentFailure = "denied" | "alreadyAssigned" | "generic"

export function existingOrganizationAssignmentFailure(error: unknown): ExistingOrganizationAssignmentFailure {
  if (!(error instanceof HttpError)) return "generic"
  if (error.status === 403) return "denied"
  if (error.status !== 409 || !error.detail || typeof error.detail !== "object" || Array.isArray(error.detail)) {
    return "generic"
  }
  return (error.detail as { code?: unknown }).code === "MTM_ASSIGNMENT_NOT_UNASSIGNED"
    ? "alreadyAssigned"
    : "generic"
}

export function assignedOrganizationTarget(
  items: readonly FieldRouteTargetCatalogItem[],
  organizationId: string,
): FieldRouteTargetCatalogItem | null {
  return items.find((item) => (
    item.subjectType === "ORGANIZATION" &&
    item.contact === null &&
    item.customer.id === organizationId
  )) ?? null
}
