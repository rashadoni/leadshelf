import { describe, expect, it } from "vitest"
import {
  calculateLocalDatabaseCapacity,
  formatCapacityBytes,
  photoCapacityLevel,
} from "./capacity"

describe("mobile local capacity diagnostics", () => {
  it("calculates allocated, used and reusable SQLite pages", () => {
    expect(calculateLocalDatabaseCapacity({ pageCount: 100, pageSize: 4096, freePageCount: 25 })).toEqual({
      allocatedBytes: 409_600,
      usedBytes: 307_200,
      freeBytes: 102_400,
    })
    expect(calculateLocalDatabaseCapacity({ pageCount: 2, pageSize: 4096, freePageCount: 99 })).toEqual({
      allocatedBytes: 8_192,
      usedBytes: 0,
      freeBytes: 8_192,
    })
  })

  it("classifies photo capacity against both file and byte limits", () => {
    const limits = { maxFiles: 100, maxBytes: 1_000 }
    expect(photoCapacityLevel({ files: 79, bytes: 799 }, limits)).toBe("ok")
    expect(photoCapacityLevel({ files: 80, bytes: 1 }, limits)).toBe("near_limit")
    expect(photoCapacityLevel({ files: 1, bytes: 1_000 }, limits)).toBe("full")
  })

  it("formats capacity without leaking invalid values", () => {
    expect(formatCapacityBytes(1_048_576)).toBe("1.0 MiB")
    expect(formatCapacityBytes(Number.NaN)).toBe("0 B")
  })
})
