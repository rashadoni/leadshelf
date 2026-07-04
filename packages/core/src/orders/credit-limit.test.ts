import { describe, expect, it } from "vitest"
import { checkCreditLimit } from "./credit-limit.ts"

describe("credit limit", () => {
  it("approves when projected debt stays within limit", () => {
    expect(checkCreditLimit({ limitCents: 300_000, usedCents: 220_000, orderTotalCents: 80_000 })).toMatchObject({
      status: "APPROVED",
      availableCents: 80_000,
      overLimitCents: 0,
      projectedUsedCents: 300_000,
    })
  })

  it("returns explicit exceedance data for a mobile supervisor dialog", () => {
    expect(checkCreditLimit({ limitCents: 300_000, usedCents: 240_000, orderTotalCents: 80_000 })).toMatchObject({
      status: "EXCEEDED",
      errorCode: "CREDIT_LIMIT_EXCEEDED",
      availableCents: 60_000,
      overLimitCents: 20_000,
      projectedUsedCents: 320_000,
      currency: "AZN",
    })
  })

  it("blocks orders when account is blocked even if amount fits", () => {
    expect(
      checkCreditLimit({ limitCents: 300_000, usedCents: 10_000, orderTotalCents: 5_000, isBlocked: true }),
    ).toMatchObject({
      status: "BLOCKED",
      errorCode: "CREDIT_ACCOUNT_BLOCKED",
      overLimitCents: 0,
    })
  })
})
