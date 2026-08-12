export type MobileVariant = "leadshelf" | "leaddrive-field"

const rawVariant = process.env.EXPO_PUBLIC_MOBILE_VARIANT?.trim().toLowerCase()

export const MOBILE_VARIANT: MobileVariant = rawVariant === "leaddrive-field"
  ? "leaddrive-field"
  : "leadshelf"

export const IS_LEADDRIVE_FIELD = MOBILE_VARIANT === "leaddrive-field"

export const mobileVariant = IS_LEADDRIVE_FIELD
  ? {
      id: MOBILE_VARIANT,
      appName: "LeadDrive Field",
      companyName: "Zeytunpharm",
      organizationSlug: process.env.EXPO_PUBLIC_ORGANIZATION_SLUG?.trim().toLowerCase() || "zeytunpharm",
      apiUrl: process.env.EXPO_PUBLIC_API_URL?.trim() || "https://app.leaddrivecrm.org",
    }
  : {
      id: MOBILE_VARIANT,
      appName: "LeadShelf",
      companyName: "Retail execution",
      organizationSlug: null,
      apiUrl: process.env.EXPO_PUBLIC_API_URL?.trim() || "https://hermescrm.xyz",
    }

export function shelfBffPath(path: "pull" | "push" | "ack" | "photos" | "commercialMedia"): string {
  if (!IS_LEADDRIVE_FIELD) {
    return {
      pull: "/api/v1/mobile/sync/pull",
      push: "/api/v1/mobile/sync/push",
      ack: "/api/v1/mobile/sync/ack",
      photos: "/api/v1/mobile/photos/upload",
      commercialMedia: "/api/v1/mobile/commercial-media/upload",
    }[path]
  }
  return {
    pull: "/api/v1/mtm/mobile/shelf/sync/pull",
    push: "/api/v1/mtm/mobile/shelf/sync/push",
    ack: "/api/v1/mtm/mobile/shelf/sync/ack",
    photos: "/api/v1/mtm/mobile/shelf/photos/upload",
    commercialMedia: "/api/v1/mtm/mobile/shelf/commercial-media/upload",
  }[path]
}
