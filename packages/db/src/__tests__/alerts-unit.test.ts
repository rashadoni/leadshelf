import type { PrismaClient } from "@leadshelf/prisma-client"
import { describe, expect, test, vi } from "vitest"
import { emitProductEvent } from "../repos/alerts.ts"

describe("alerts repo unit behavior", () => {
  test("returns the existing event when concurrent dedupe creation hits a unique conflict", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "event-existing", alert: { id: "alert-existing" } })
    const prisma = {
      productEvent: { findFirst },
      $transaction: vi.fn(async () => {
        throw Object.assign(new Error("unique constraint"), { code: "P2002" })
      }),
    } as unknown as PrismaClient

    await expect(
      emitProductEvent(prisma, "org-a", {
        kind: "stock.gap",
        dedupeKey: "stock.gap:store-a:product-a:2026-07-04",
        payload: { title: "SKU-A" },
      }),
    ).resolves.toEqual({
      eventId: "event-existing",
      alertId: "alert-existing",
      created: false,
    })
    expect(findFirst).toHaveBeenCalledTimes(2)
  })
})
