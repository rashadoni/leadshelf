import { describe, expect, it, vi } from "vitest"
import { collectObjectStorageInventory } from "./s3"

describe("object storage inventory", () => {
  it("paginates the entire bucket and sums actual object bytes", async () => {
    const listPage = vi.fn(async (token?: string) => {
      if (token === undefined) {
        return {
          objects: [{ size: 10 }, { size: 20 }],
          isTruncated: true,
          nextToken: "page-2",
        }
      }
      return {
        objects: [{ size: 30 }, {}, { size: Number.NaN }],
        isTruncated: false,
      }
    })

    await expect(collectObjectStorageInventory(listPage)).resolves.toEqual({
      objects: 5,
      bytes: 60,
    })
    expect(listPage).toHaveBeenNthCalledWith(1, undefined)
    expect(listPage).toHaveBeenNthCalledWith(2, "page-2")
  })

  it("fails closed on a truncated page without a progressing cursor", async () => {
    await expect(collectObjectStorageInventory(async () => ({
      objects: [],
      isTruncated: true,
    }))).rejects.toThrow("object_storage_inventory_cursor_invalid")
  })
})
