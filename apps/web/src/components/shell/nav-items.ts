// Единый источник разделов навигации (Phase 0 DoD: пустые разделы).
export const NAV_ITEMS = [
  { key: "overview", href: "/" },
  { key: "catalog", href: "/catalog" },
  { key: "equipmentLibrary", href: "/equipment-library" },
  { key: "stores", href: "/stores" },
  { key: "floorPlans", href: "/floor-plans" },
  { key: "planograms", href: "/planograms" },
  { key: "tasks", href: "/tasks" },
  { key: "reviews", href: "/reviews" },
  { key: "fieldForce", href: "/field-force" },
  { key: "orders", href: "/orders" },
  { key: "analytics", href: "/analytics" },
] as const

export type NavKey = (typeof NAV_ITEMS)[number]["key"]
