export type TerritoryRole = "OWNER" | "ADMIN" | "SUPERVISOR" | "MERCHANDISER" | "STORE_STAFF" | string

export interface TerritoryScopeInput {
  role: TerritoryRole
  assignedStoreIds?: string[]
  assignedRegionIds?: string[]
}

export interface StoreScopeTarget {
  storeId: string
  regionId?: string | null
}

export interface TerritoryScope {
  allStores: boolean
  storeIds: Set<string>
  regionIds: Set<string>
}

export function buildTerritoryScope(input: TerritoryScopeInput): TerritoryScope {
  const allStores = input.role === "OWNER" || input.role === "ADMIN"
  return {
    allStores,
    storeIds: new Set(input.assignedStoreIds ?? []),
    regionIds: new Set(input.assignedRegionIds ?? []),
  }
}

export function isStoreInTerritory(scope: TerritoryScope, target: StoreScopeTarget): boolean {
  if (scope.allStores) return true
  if (scope.storeIds.has(target.storeId)) return true
  if (target.regionId && scope.regionIds.has(target.regionId)) return true
  return false
}

export function filterStoresByTerritory<T extends StoreScopeTarget>(scope: TerritoryScope, stores: T[]): T[] {
  return stores.filter((store) => isStoreInTerritory(scope, store))
}
