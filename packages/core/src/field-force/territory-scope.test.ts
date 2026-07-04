import { describe, expect, it } from "vitest"
import { buildTerritoryScope, filterStoresByTerritory, isStoreInTerritory } from "./territory-scope.ts"

describe("territory scope", () => {
  it("gives admins all stores", () => {
    const scope = buildTerritoryScope({ role: "ADMIN" })
    expect(isStoreInTerritory(scope, { storeId: "store-a" })).toBe(true)
  })

  it("allows explicit store assignments", () => {
    const scope = buildTerritoryScope({ role: "MERCHANDISER", assignedStoreIds: ["store-a"] })
    expect(isStoreInTerritory(scope, { storeId: "store-a" })).toBe(true)
    expect(isStoreInTerritory(scope, { storeId: "store-b" })).toBe(false)
  })

  it("allows region assignments and filters lists", () => {
    const scope = buildTerritoryScope({ role: "SUPERVISOR", assignedRegionIds: ["region-1"] })
    expect(
      filterStoresByTerritory(scope, [
        { storeId: "store-a", regionId: "region-1" },
        { storeId: "store-b", regionId: "region-2" },
      ]),
    ).toEqual([{ storeId: "store-a", regionId: "region-1" }])
  })
})
