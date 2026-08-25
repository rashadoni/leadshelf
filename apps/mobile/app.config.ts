import type { ConfigContext, ExpoConfig } from "expo/config"
import base from "./app.json"

export default ({ config }: ConfigContext): ExpoConfig => {
  const fieldVariant = process.env.EXPO_PUBLIC_MOBILE_VARIANT === "leaddrive-field"
  // These Android prompts are baked into an APK. Release automation can choose
  // the tenant's default language; the in-app switch remains AZ/RU at runtime.
  const permissionLocale = process.env.EXPO_PUBLIC_PERMISSION_LOCALE === "ru" ? "ru" : "az"
  const fieldPermissions = permissionLocale === "ru"
    ? {
        camera: "Разрешите LeadDrive Field делать фото-подтверждения визитов.",
        locationWhenInUse: "Разрешите LeadDrive Field подтвердить визит по GPS, если это требует правило организации.",
        locationAlways: "Разрешите LeadDrive Field записывать GPS только во время активного рабочего дня, если это требует правило организации.",
      }
    : {
        camera: "LeadDrive Field-ə vizit sübutu fotolarını çəkməyə icazə verin.",
        locationWhenInUse: "Təşkilat qaydası tələb edərsə, LeadDrive Field-ə viziti GPS ilə təsdiqləməyə icazə verin.",
        locationAlways: "Təşkilat qaydası tələb edərsə, LeadDrive Field-ə yalnız aktiv iş günü zamanı GPS qeydi aparmağa icazə verin.",
      }
  const expo = base.expo as unknown as ExpoConfig
  const displayName = fieldVariant ? "LeadDrive Field" : expo.name
  const androidPackage = fieldVariant ? "org.leaddrive.field.zeytunpharm" : expo.android?.package
  const scheme = fieldVariant ? "leaddrive-field" : expo.scheme
  const plugins: ExpoConfig["plugins"] = fieldVariant
    ? (expo.plugins ?? [])
      .filter((plugin) => {
        if (typeof plugin === "string") return plugin !== "expo-sensors"
        return !Array.isArray(plugin) || plugin[0] !== "expo-sensors"
      })
      .map((plugin): NonNullable<ExpoConfig["plugins"]>[number] => {
        if (!Array.isArray(plugin)) return plugin
        const [name, options] = plugin
        if (!options || typeof options !== "object") return plugin
        if (name === "expo-camera") {
          return [name, {
            ...options,
            cameraPermission: fieldPermissions.camera,
            // Field currently captures visit photos only. Keep legacy video
            // support isolated and do not request microphone access in Field.
            recordAudioAndroid: false,
          }] as [string, Record<string, unknown>]
        }
        if (name === "expo-location") {
          return [name, {
            ...options,
            locationWhenInUsePermission: fieldPermissions.locationWhenInUse,
            locationAlwaysAndWhenInUsePermission: fieldPermissions.locationAlways,
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
      ...(fieldVariant
        ? {
            // expo-camera and the legacy base manifest can add RECORD_AUDIO.
            // Blocking it is required for the final Android manifest; simply
            // omitting it from `permissions` would not be sufficient.
            blockedPermissions: [
              ...(expo.android?.blockedPermissions ?? []),
              "android.permission.RECORD_AUDIO",
            ],
          }
        : {}),
    },
    extra: {
      ...expo.extra,
      mobileVariant: fieldVariant ? "leaddrive-field" : "leadshelf",
      organizationSlug: fieldVariant
        ? process.env.EXPO_PUBLIC_ORGANIZATION_SLUG || "zeytunpharm"
        : null,
    },
  }
}
