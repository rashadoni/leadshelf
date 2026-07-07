import { describe, expect, it } from "vitest"
import { ASSIGNABLE_ROLES, isAssignableRole } from "./assignable-roles"

describe("assignable task roles", () => {
  it("accepts field/execution roles", () => {
    for (const role of ASSIGNABLE_ROLES) expect(isAssignableRole(role)).toBe(true)
    expect(isAssignableRole("FIELD_AGENT")).toBe(true)
    expect(isAssignableRole("MERCHANDISER")).toBe(true)
  })

  it("rejects office roles from being task assignees", () => {
    expect(isAssignableRole("OWNER")).toBe(false)
    expect(isAssignableRole("ADMIN")).toBe(false)
    expect(isAssignableRole("CATEGORY_MANAGER")).toBe(false)
    expect(isAssignableRole("ANALYST")).toBe(false)
  })
})
