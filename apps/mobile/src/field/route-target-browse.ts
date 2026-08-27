import type {
  FieldRouteTargetCatalogData,
  FieldRouteTargetCatalogItem,
  FieldRouteTargetType,
} from "./contracts"

/** A local UI filter, never sent to the API. */
export const ALL_ROUTE_TARGETS_FILTER_ID = "__all_route_targets__"

export type RouteTargetBrowseGroup = {
  targetType: FieldRouteTargetType
  catalog: FieldRouteTargetCatalogData
  items: FieldRouteTargetCatalogItem[]
}

function allCustomersTargetType(types: readonly FieldRouteTargetType[]): FieldRouteTargetType | null {
  return types.find((type) => (
    type.direction !== "DOCTOR" &&
    type.objectType === null &&
    type.organizationKind === null
  )) ?? null
}

/**
 * The browse screen is intentionally small: all assigned customers plus the
 * doctor list. Category chips still expose pharmacies, clinics and any other
 * tenant-specific subset without duplicating those customers in the default
 * feed.
 */
export function initialBrowseTargetTypes(catalog: FieldRouteTargetCatalogData): FieldRouteTargetType[] {
  const customerType = allCustomersTargetType(catalog.targetTypes)
  if (!customerType) {
    return catalog.targetTypes.length > 0 ? catalog.targetTypes : [catalog.targetType]
  }
  const doctorType = catalog.targetTypes.find((type) => type.direction === "DOCTOR") ?? null
  return doctorType && doctorType.id !== customerType.id
    ? [customerType, doctorType]
    : [customerType]
}

/** Keep a target actionable once even if an unusual tenant configuration overlaps filters. */
export function makeRouteTargetBrowseGroups(
  catalogs: readonly FieldRouteTargetCatalogData[],
): RouteTargetBrowseGroup[] {
  const seen = new Set<string>()
  return catalogs.map((catalog) => ({
    targetType: catalog.targetType,
    catalog,
    items: catalog.items.filter((item) => {
      if (seen.has(item.targetKey)) return false
      seen.add(item.targetKey)
      return true
    }),
  }))
}

export function appendRouteTargetBrowsePage(
  groups: readonly RouteTargetBrowseGroup[],
  targetTypeId: string,
  next: FieldRouteTargetCatalogData,
): RouteTargetBrowseGroup[] {
  const seen = new Set(
    groups
      .filter((group) => group.targetType.id !== targetTypeId)
      .flatMap((group) => group.items.map((item) => item.targetKey)),
  )

  return groups.map((group) => {
    if (group.targetType.id !== targetTypeId) return group
    const items = [...group.items]
    for (const item of next.items) {
      if (seen.has(item.targetKey) || items.some((current) => current.targetKey === item.targetKey)) continue
      seen.add(item.targetKey)
      items.push(item)
    }
    return { targetType: group.targetType, catalog: next, items }
  })
}
