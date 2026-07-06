import { z } from "zod"

export const DEFAULT_FIELD_FORCE_SETTINGS = {
  gpsRefreshSeconds: 15,
  geofenceRadiusM: 120,
  offlineAfterMinutes: 45,
  requirePhotoProof: true,
  requireShelfScan: true,
  alertLateVisits: true,
} as const

export const fieldForceSettingsSchema = z.object({
  gpsRefreshSeconds: z.coerce.number().int().min(5).max(120),
  geofenceRadiusM: z.coerce.number().int().min(30).max(1000),
  offlineAfterMinutes: z.coerce.number().int().min(5).max(240),
  requirePhotoProof: z.boolean(),
  requireShelfScan: z.boolean(),
  alertLateVisits: z.boolean(),
})

export const fieldForceSettingsPatchSchema = fieldForceSettingsSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "at_least_one_setting_required" },
)

export type FieldForceSettingsState = z.infer<typeof fieldForceSettingsSchema>

export interface FieldForceSettingsRecord {
  gpsRefreshSeconds?: number | null
  geofenceRadiusM?: number | null
  offlineAfterMinutes?: number | null
  requirePhotoProof?: boolean | null
  requireShelfScan?: boolean | null
  alertLateVisits?: boolean | null
  updatedAt?: Date | string | null
}

export function normalizeFieldForceSettings(
  value: Partial<FieldForceSettingsState> | null | undefined,
): FieldForceSettingsState {
  return fieldForceSettingsSchema.parse({
    ...DEFAULT_FIELD_FORCE_SETTINGS,
    ...(value ?? {}),
  })
}

export function shapeFieldForceSettings(row: FieldForceSettingsRecord | null | undefined) {
  const settings = normalizeFieldForceSettings(
    row
      ? {
          gpsRefreshSeconds: row.gpsRefreshSeconds ?? undefined,
          geofenceRadiusM: row.geofenceRadiusM ?? undefined,
          offlineAfterMinutes: row.offlineAfterMinutes ?? undefined,
          requirePhotoProof: row.requirePhotoProof ?? undefined,
          requireShelfScan: row.requireShelfScan ?? undefined,
          alertLateVisits: row.alertLateVisits ?? undefined,
        }
      : null,
  )
  return {
    ...settings,
    updatedAt: row?.updatedAt ?? null,
  }
}

export function offlineCutoffFor(now: Date, settings: Pick<FieldForceSettingsState, "offlineAfterMinutes">) {
  return new Date(now.getTime() - settings.offlineAfterMinutes * 60 * 1000)
}
