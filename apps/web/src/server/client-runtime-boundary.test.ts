import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("client production runtime boundary", () => {
  it("does not query or render demo readiness from the authenticated shell", () => {
    const layout = source("src/app/[locale]/(app)/layout.tsx")
    const shell = source("src/components/shell/dashboard-shell.tsx")
    expect(layout).not.toMatch(/demo|isDemoTenantReady/i)
    expect(shell).not.toMatch(/demoReady|demoTenant/i)
  })

  it("gates synthetic media and readiness through the explicit runtime profile", () => {
    const media = source("src/app/api/media/[...path]/route.ts")
    const readiness = source("src/app/api/ready/route.ts")
    expect(media).toContain("demoMediaFallbackAllowed(runtimeProfile(), key, session.org)")
    expect(media).toContain("safeMediaRead(key, getObject)")
    expect(media).toContain('error: "storage_unavailable"')
    expect(readiness).toContain("runtimeProfile()")
  })

  it("pins production compose to client and exposes no demo copy in client messages", () => {
    const compose = source("../../deploy/docker-compose.prod.yml")
    expect(compose).toContain("LEADSHELF_RUNTIME_PROFILE: client")
    for (const locale of ["ru", "az"]) {
      expect(source(`src/messages/${locale}.json`)).not.toMatch(/demo|демо/i)
    }
  })

  it("keeps the demo stand off the client profile and off public ports", () => {
    const demo = source("../../deploy/docker-compose.demo.yml")
    // Отдельное имя проекта — единственное, что мешает `demo.sh reset` снести
    // тома клиентского прода: compose префиксует их именем проекта.
    expect(demo).toContain("name: leadshelf-demo")
    expect(demo).toContain("LEADSHELF_RUNTIME_PROFILE: demo")
    expect(demo).not.toContain("LEADSHELF_RUNTIME_PROFILE: client")
    // Наружу смотрит только публичный вход caddy; web — строго на loopback,
    // postgres и minio не публикуются вовсе.
    expect(demo).toContain('- "127.0.0.1:${LEADSHELF_DEMO_PORT:-8080}:3000"')
    expect(demo.match(/^ {4}ports:$/gm)).toHaveLength(2)
  })
})
