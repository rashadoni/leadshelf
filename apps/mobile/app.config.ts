import type { ConfigContext, ExpoConfig } from "expo/config"
import base from "./app.json"

export default ({ config }: ConfigContext): ExpoConfig => {
  const fieldVariant = process.env.EXPO_PUBLIC_MOBILE_VARIANT === "leaddrive-field"
  const expo = base.expo as unknown as ExpoConfig
  const displayName = fieldVariant ? "LeadDrive Field" : expo.name
  const androidPackage = fieldVariant ? "org.leaddrive.field.zeytunpharm" : expo.android?.package
  const scheme = fieldVariant ? "leaddrive-field" : expo.scheme
  const plugins: ExpoConfig["plugins"] = fieldVariant
    ? (expo.plugins ?? []).map((plugin): NonNullable<ExpoConfig["plugins"]>[number] => {
        if (!Array.isArray(plugin)) return plugin
        const [name, options] = plugin
        if (!options || typeof options !== "object") return plugin
        if (name === "expo-camera") {
          return [name, {
            ...options,
            cameraPermission: "Allow LeadDrive Field to scan product barcodes and capture visit and shelf proof photos.",
          }] as [string, Record<string, unknown>]
        }
        if (name === "expo-location") {
          return [name, {
            ...options,
            locationWhenInUsePermission: "Allow LeadDrive Field to verify visits and record your route during an active workday.",
            locationAlwaysAndWhenInUsePermission: "Allow LeadDrive Field to record your route only while your workday is active.",
          }] as [string, Record<string, unknown>]
        }
        if (name === "expo-sensors") {
          return [name, {
            ...options,
            motionPermission: "Allow LeadDrive Field to use the tilt sensor to guide level shelf photos.",
          }] as [string, Record<string, unknown>]
        }
        return plugin
      })
    : expo.plugins

  return {
    ...config,
    ...expo,
    name: displayName,
    slug: fieldVariant ? "leaddrive-field-zeytunpharm" : expo.slug,
    scheme,
    plugins,
    android: {
      ...(expo.android ?? {}),
      package: androidPackage,
    },
    extra: {
      ...expo.extra,
      mobileVariant: fieldVariant ? "leaddrive-field" : "leadshelf",
      organizationSlug: fieldVariant
        ? process.env.EXPO_PUBLIC_ORGANIZATION_SLUG || "zeytun"
        : null,
    },
  }
}
