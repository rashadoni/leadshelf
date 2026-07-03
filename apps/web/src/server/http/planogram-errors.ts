import { NextResponse } from "next/server"
import { PlanogramRepoError } from "@leadshelf/db"

export function planogramErrorResponse(e: unknown): NextResponse | null {
  if (!(e instanceof PlanogramRepoError)) return null
  const status =
    e.code === "not_found"
      ? 404
      : e.code === "version_conflict"
        ? 409
        : e.code === "placement_rejected" ||
            e.code === "missing_product_dimensions" ||
            e.code === "invalid_shelf"
          ? 422
          : 400
  return NextResponse.json(
    { error: e.code, message: e.message, details: e.details ?? null },
    { status },
  )
}

export const PLANOGRAM_EDIT_ROLES = new Set([
  "OWNER",
  "ADMIN",
  "CATEGORY_MANAGER",
  "MERCHANDISER",
])
