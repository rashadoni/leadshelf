import { describe, expect, it } from "vitest"
import { AuthLostError, HttpError, MobileOperationError } from "../sync/ports-error"
import { routeTargetLoadFailure } from "./route-target-error"

describe("route target load failure", () => {
  it("explains a route scope denial without calling it an internet error", () => {
    expect(routeTargetLoadFailure(new HttpError(
      403,
      "forbidden",
      { code: "MTM_MOBILE_ROUTE_TARGET_SCOPE_DENIED" },
      { operation: "route.targets.load", stage: "http", statusCode: 403, correlationId: "mobile-12345678" },
    ))).toEqual({
      kind: "assignment",
      messageKey: "routeTargetScopeDenied",
      retryable: false,
      correlationId: "mobile-12345678",
    })
  })

  it("keeps a missing route-target service retryable and traceable", () => {
    expect(routeTargetLoadFailure(new HttpError(
      404,
      "not found",
      {},
      { operation: "route.targets.load", stage: "http", statusCode: 404, correlationId: "mobile-87654321" },
    ))).toEqual({
      kind: "service",
      messageKey: "routeTargetServiceUnavailable",
      retryable: true,
      correlationId: "mobile-87654321",
    })
  })

  it("keeps transport and expired-session recovery distinct", () => {
    expect(routeTargetLoadFailure(new MobileOperationError({
      operation: "route.targets.load",
      stage: "network",
      statusCode: null,
      correlationId: "mobile-abcdefgh",
    }))).toMatchObject({ kind: "network", messageKey: "routeTargetNetworkError", retryable: true })
    expect(routeTargetLoadFailure(new AuthLostError())).toMatchObject({ kind: "session", retryable: false })
  })
})
