import { describe, expect, test } from "vitest"
import { canStorePhoto } from "./photo-storage-policy"

const limits = { maxFiles: 3, maxBytes: 100 }

describe("photo outbox storage policy", () => {
  test("разрешает запись внутри обоих лимитов", () => {
    expect(canStorePhoto({ files: 1, bytes: 40 }, 50, limits)).toEqual({ allowed: true })
  })

  test("останавливает запись сверх лимита файлов", () => {
    expect(canStorePhoto({ files: 3, bytes: 10 }, 1, limits)).toEqual({
      allowed: false,
      reason: "file_count",
    })
  })

  test("останавливает запись сверх лимита байтов", () => {
    expect(canStorePhoto({ files: 1, bytes: 90 }, 11, limits)).toEqual({
      allowed: false,
      reason: "byte_size",
    })
  })

  test("разрешает ровно граничные значения", () => {
    expect(canStorePhoto({ files: 2, bytes: 80 }, 20, limits)).toEqual({ allowed: true })
  })

  test("не принимает неизвестный или отрицательный размер", () => {
    expect(canStorePhoto({ files: 0, bytes: 0 }, Number.NaN, limits)).toEqual({
      allowed: false,
      reason: "byte_size",
    })
    expect(canStorePhoto({ files: 0, bytes: 0 }, -1, limits)).toEqual({
      allowed: false,
      reason: "byte_size",
    })
  })
})
