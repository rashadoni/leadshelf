import { readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const apiRoot = resolve(process.cwd(), "src/app/api/v1")
const publicRoutes = new Set([
  "mobile/auth/login/route.ts",
  "mobile/auth/logout/route.ts",
  "mobile/auth/refresh/route.ts",
  "mobile/protocol/route.ts",
])
const deviceScopedWorkerDbExceptions = new Set([
  "mobile/sync/ack/route.ts",
])
const isFieldBffRoute = (relativePath: string) => relativePath.startsWith("internal/field/")

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? routeFiles(path) : entry.name === "route.ts" ? [path] : []
  })
}

const routes = routeFiles(apiRoot).map((path) => ({
  path,
  relativePath: relative(apiRoot, path),
  source: readFileSync(path, "utf8"),
}))

describe("v1 API security inventory", () => {
  it("scans the complete route surface", () => {
    expect(routes).toHaveLength(63)
    expect(routes.filter((route) => publicRoutes.has(route.relativePath)).map((route) => route.relativePath).sort())
      .toEqual([...publicRoutes].sort())
  })

  it("requires an access session outside the explicit public allowlist", () => {
    for (const route of routes) {
      if (publicRoutes.has(route.relativePath)) continue
      expect(route.source, route.relativePath).toContain(
        isFieldBffRoute(route.relativePath) ? "requireFieldBffSession(" : "requireApiSession(",
      )
    }
  })

  it("requires a role denial path for every office mutation", () => {
    for (const route of routes) {
      if (route.relativePath.startsWith("mobile/") || isFieldBffRoute(route.relativePath)) continue
      if (!/export async function (POST|PUT|PATCH|DELETE)/.test(route.source)) continue
      expect(route.source, route.relativePath).toContain("forbidden(")
    }
  })

  it("requires organization scope for direct worker DB access", () => {
    for (const route of routes) {
      if (!route.source.includes("workerDb")) continue
      if (deviceScopedWorkerDbExceptions.has(route.relativePath)) {
        expect(route.source, route.relativePath).toContain("session.did")
        continue
      }
      expect(route.source, route.relativePath).toContain("session.org")
    }
  })

  it("keeps media and export routes authenticated and tenant-scoped", () => {
    for (const route of routes.filter((candidate) =>
      candidate.relativePath.includes("/media/") ||
      candidate.relativePath.includes("/photos/") ||
      candidate.relativePath.includes("/export/"),
    )) {
      if (isFieldBffRoute(route.relativePath)) {
        expect(route.source, route.relativePath).toContain("requireFieldBffSession(")
        expect(route.source, route.relativePath).toContain("auth.session")
      } else {
        expect(route.source, route.relativePath).toContain("requireApiSession(")
        expect(route.source, route.relativePath).toContain("session.org")
      }
    }
  })
})
