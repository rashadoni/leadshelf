import { afterEach, describe, expect, it } from "vitest"
import { getLocale, setLocale, t } from "../i18n"
import { AuthLostError, HttpError, UpgradeRequiredError } from "../sync/ports-error"
import { FIELD_VISIT_ERROR_OVERRIDES, fieldErrorMessage, fieldErrorMessageForCode } from "./error-message"

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

  it("explains the known visit geofence rejection without exposing backend text", () => {
    setLocale("ru")
    expect(fieldErrorMessageForCode(
      "MTM_VISIT_OUT_OF_ZONE",
      "fieldVisitConflict",
      FIELD_VISIT_ERROR_OVERRIDES,
    )).toBe(t("fieldVisitOutsideAllowedArea"))
  })
})
