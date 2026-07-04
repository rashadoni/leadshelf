export interface CreditLimitInput {
  limitCents: number
  usedCents: number
  orderTotalCents: number
  isBlocked?: boolean
  currency?: string
}

export type CreditLimitStatus = "APPROVED" | "EXCEEDED" | "BLOCKED"

export interface CreditLimitResult {
  status: CreditLimitStatus
  limitCents: number
  usedCents: number
  orderTotalCents: number
  projectedUsedCents: number
  availableCents: number
  overLimitCents: number
  currency: string
  errorCode?: "CREDIT_LIMIT_EXCEEDED" | "CREDIT_ACCOUNT_BLOCKED"
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer amount in cents`)
  }
}

export function checkCreditLimit(input: CreditLimitInput): CreditLimitResult {
  assertNonNegativeInteger(input.limitCents, "limitCents")
  assertNonNegativeInteger(input.usedCents, "usedCents")
  assertNonNegativeInteger(input.orderTotalCents, "orderTotalCents")

  const projectedUsedCents = input.usedCents + input.orderTotalCents
  const availableCents = Math.max(0, input.limitCents - input.usedCents)
  const overLimitCents = Math.max(0, projectedUsedCents - input.limitCents)
  const base = {
    limitCents: input.limitCents,
    usedCents: input.usedCents,
    orderTotalCents: input.orderTotalCents,
    projectedUsedCents,
    availableCents,
    overLimitCents,
    currency: input.currency ?? "AZN",
  }

  if (input.isBlocked) {
    return { ...base, status: "BLOCKED", errorCode: "CREDIT_ACCOUNT_BLOCKED" }
  }

  if (overLimitCents > 0) {
    return { ...base, status: "EXCEEDED", errorCode: "CREDIT_LIMIT_EXCEEDED" }
  }

  return { ...base, status: "APPROVED" }
}
