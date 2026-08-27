import { afterEach, describe, expect, it } from "vitest"
import { getLocale, setLocale, t } from "../i18n"
import { AuthLostError, HttpError, UpgradeRequiredError } from "../sync/ports-error"
import {
  FIELD_VISIT_ERROR_OVERRIDES,
  fieldErrorMessage,
  fieldErrorMessageForCode,
  fieldErrorMessageKey,
  fieldMessageText,
  fieldRouteConflictMessageData,
} from "./error-message"

const initialLocale = getLocale()

afterEach(() => setLocale(initialLocale))

describe("field error message", () => {
  it("never exposes a raw backend error", () => {
    setLocale("ru")
    expect(fieldErrorMessage(new Error("Route conflicts require draft review"), "fieldDataError"))
      .toBe(t("fieldDataError"))
  })

  it("uses a context-specific mapped API code", () => {
    setLocale("az")
    expect(fieldErrorMessage(
      new HttpError(409, "newer version", { code: "MTM_TASK_VERSION_CONFLICT" }),
      "agentTaskActionFailed",
      { MTM_TASK_VERSION_CONFLICT: "agentTaskConflictHint" },
    )).toBe(t("agentTaskConflictHint"))
  })

  it("keeps transport-wide authentication and upgrade copy localised", () => {
    setLocale("ru")
    expect(fieldErrorMessage(new AuthLostError(), "fieldDataError")).toBe(t("fieldSessionExpired"))
    expect(fieldErrorMessage(new UpgradeRequiredError(), "fieldDataError")).toBe(t("upgradeBody"))
  })

  it("keeps a stored error locale-independent until render", () => {
    const key = fieldErrorMessageKey(new AuthLostError(), "fieldDataError")
    expect(key).toBe("fieldSessionExpired")
    setLocale("az")
    expect(t(key)).toBe("Giriş sessiyası bitdi. Yenidən daxil olun.")
    setLocale("ru")
    expect(t(key)).toBe("Сессия входа завершилась. Войдите снова.")
  })

  it("explains the known visit geofence rejection without exposing backend text", () => {
    setLocale("ru")
    expect(fieldErrorMessageForCode(
      "MTM_VISIT_OUT_OF_ZONE",
      "fieldVisitConflict",
      FIELD_VISIT_ERROR_OVERRIDES,
    )).toBe(t("fieldVisitOutsideAllowedArea"))
  })

  it("keeps route conflict values locale-independent until render", () => {
    const message = fieldRouteConflictMessageData({
      code: "ROUTE_POINT_TIME_CONFLICT",
      conflicts: [{ plannedTime: "2026-08-27T09:30:00.000Z", pointIndexes: [0, 2] }],
    }, "fieldDataError", "UTC")
    expect(message).toEqual({ key: "routeConflictTime", values: { points: "1, 3", time: "09:30" } })
    setLocale("az")
    expect(fieldMessageText(message)).toBe(t("routeConflictTime", message.values))
    setLocale("ru")
    expect(fieldMessageText(message)).toBe(t("routeConflictTime", message.values))
  })
})
