const LEGACY_COMMERCIAL_FIELD_PREFIXES = [
  "/commercial",
  "/shelves",
  "/planograms",
  "/orders",
  "/order-create",
  "/routes/commercial",
  "/tasks",
  "/visit",
  "/dashboard",
] as const

/**
 * LeadDrive Field deliberately does not expose the LeadShelf commercial,
 * shelves, planogram or shelf-task flows. Keep the code available for the
 * LeadShelf variant, but reject accidental deep links in the Field variant.
 */
export function isLegacyCommercialFieldPath(pathname: string): boolean {
  return LEGACY_COMMERCIAL_FIELD_PREFIXES.some((prefix) => (
    pathname === prefix || pathname.startsWith(prefix + "/")
  ))
}
