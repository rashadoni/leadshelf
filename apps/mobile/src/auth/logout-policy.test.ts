import { describe, expect, test } from "vitest"
import { requiresLogoutConfirmation } from "./logout-policy"

describe("logout data policy", () => {
  test("не требует предупреждения для полностью синхронизированного устройства", () => {
    expect(requiresLogoutConfirmation({ unsyncedOperations: 0, unsyncedPhotos: 0 })).toBe(false)
  })

  test("предупреждает о любой несинхронизированной работе", () => {
    expect(requiresLogoutConfirmation({ unsyncedOperations: 1, unsyncedPhotos: 0 })).toBe(true)
    expect(requiresLogoutConfirmation({ unsyncedOperations: 0, unsyncedPhotos: 1 })).toBe(true)
  })
})
