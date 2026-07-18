import { randomUUID } from "node:crypto"
import { beforeAll, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { signAccessToken } from "@/server/auth/jwt"

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { eager: true }): Record<string, unknown>
  }
}

const mutationMethods = ["POST", "PUT", "PATCH", "DELETE"] as const
type MutationMethod = (typeof mutationMethods)[number]
type RouteModule = Partial<Record<MutationMethod, unknown>>
type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

const modules = import.meta.glob("../../app/api/v1/**/route.ts", {
  eager: true,
}) as Record<string, RouteModule>

const cases = Object.entries(modules).flatMap(([path, route]) => {
  if (path.includes("/mobile/")) return []
  return mutationMethods.flatMap((method) =>
    typeof route[method] === "function"
      ? [{ path, method, handler: route[method] }]
      : [],
  )
})

const params = {
  id: "rbac-denied",
  agentId: "rbac-denied",
  routeId: "rbac-denied",
  visitId: "rbac-denied",
  planogramId: "rbac-denied",
  versionId: "rbac-denied",
  placementId: "rbac-denied",
  zoneId: "rbac-denied",
  referenceId: "rbac-denied",
  slotId: "rbac-denied",
  reviewId: "rbac-denied",
  taskId: "rbac-denied",
}

let storeStaffToken = ""
let categoryManagerToken = ""

function requiresCategoryManagerDenial(path: string): boolean {
  return path.includes("/field-force/locations/") ||
    path.includes("/field-force/visits/") ||
    path.includes("/orders/")
}

beforeAll(async () => {
  const identity = randomUUID()
  process.env.JWT_SECRET ||= `rbac-matrix-${identity}`
  ;[storeStaffToken, categoryManagerToken] = await Promise.all([
    signAccessToken({
      sub: `rbac-store-${identity}`,
      org: `rbac-org-${identity}`,
      role: "STORE_STAFF",
      sid: `rbac-session-store-${identity}`,
    }),
    signAccessToken({
      sub: `rbac-category-${identity}`,
      org: `rbac-org-${identity}`,
      role: "CATEGORY_MANAGER",
      sid: `rbac-session-category-${identity}`,
    }),
  ])
})

describe("office mutation RBAC matrix", () => {
  it("executes every current office mutation with a role forbidden by its policy", async () => {
    expect(cases).toHaveLength(40)

    for (const testCase of cases) {
      const token = requiresCategoryManagerDenial(testCase.path)
        ? categoryManagerToken
        : storeStaffToken
      const request = new NextRequest("http://localhost/api/v1/rbac-denied", {
        method: testCase.method,
        headers: { authorization: `Bearer ${token}` },
      })
      const handler = testCase.handler as RouteHandler
      const response = await handler(request, { params: Promise.resolve(params) })
      expect(response.status, `${testCase.method} ${testCase.path}`).toBe(403)
      expect(await response.json(), `${testCase.method} ${testCase.path}`).toEqual({
        error: "forbidden",
      })
    }
  })
})
