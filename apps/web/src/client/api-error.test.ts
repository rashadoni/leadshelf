import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import {
  ApiResponseError,
  correlationIdFromResponse,
  formatApiError,
  formatResponseError,
  fetchApiResponse,
  requireApiResponse,
} from "./api-error"

function response(status: number, correlationId?: string): Response {
  return new Response(null, {
    status,
    headers: correlationId ? { "x-correlation-id": correlationId } : undefined,
  })
}

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return tsxFiles(path)
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : []
  })
}

describe("client API errors", () => {
  it("accepts only safe support correlation IDs", () => {
    expect(correlationIdFromResponse(response(500, "trace_01:retry"))).toBe("trace_01:retry")
    expect(correlationIdFromResponse(response(500, "secret token value"))).toBeNull()
    expect(correlationIdFromResponse(response(500))).toBeNull()
  })

  it("keeps successful and explicitly accepted responses", () => {
    expect(() => requireApiResponse(response(204))).not.toThrow()
    expect(() => requireApiResponse(response(409), [409])).not.toThrow()
  })

  it("throws status and support code for an API failure", () => {
    expect(() => requireApiResponse(response(503, "trace-503"))).toThrowError(
      expect.objectContaining({
        name: "ApiResponseError",
        status: 503,
        correlationId: "trace-503",
      }),
    )
  })

  it("formats response and caught errors without exposing response bodies", () => {
    const failed = response(500, "trace-500")
    expect(formatResponseError(failed, "Failed.", (code) => `Support: ${code}.`)).toBe(
      "Failed. Support: trace-500.",
    )
    const error = new ApiResponseError(failed)
    expect(formatApiError(error, "Failed.", (code) => `Support: ${code}.`)).toBe(
      "Failed. Support: trace-500.",
    )
    expect(formatApiError(new Error("private details"), "Failed.", (code) => code)).toBe(
      "Failed.",
    )
  })

  it("converts a network exception into a safe synthetic 503", async () => {
    const result = await fetchApiResponse("/api/test", undefined, async () => {
      throw new Error("private network details")
    })
    expect(result.status).toBe(503)
    await expect(result.json()).resolves.toEqual({ error: "network_unavailable" })
    expect(result.headers.get("x-correlation-id")).toBeNull()
  })

  it("keeps every client fetch path behind the shared error contract", () => {
    const root = process.cwd()
    const unprotected = tsxFiles(resolve(root, "src"))
      .filter((path) => {
        const source = readFileSync(path, "utf8")
        const callsApi = /\b(?:fetch|fetchApiResponse)\s*\(/.test(source)
        return source.startsWith('"use client"') && callsApi && !source.includes("@/client/api-error")
      })
      .map((path) => relative(root, path))
      .sort()

    expect(unprotected).toEqual([])
  })
})
