import { describe, expect, it } from "vitest"
import { splitWorkdayActions } from "./workday-action-layout"

describe("workday action layout", () => {
  it("makes the next safe state transition the primary action", () => {
    expect(splitWorkdayActions(["START"])).toEqual({ primary: "START", secondary: [] })
    expect(splitWorkdayActions(["PAUSE", "FINISH"])).toEqual({ primary: "PAUSE", secondary: ["FINISH"] })
    expect(splitWorkdayActions(["RESUME", "FINISH"])).toEqual({ primary: "RESUME", secondary: ["FINISH"] })
  })

  it("does not invent an action when the server allows none", () => {
    expect(splitWorkdayActions([])).toEqual({ primary: null, secondary: [] })
  })
})
