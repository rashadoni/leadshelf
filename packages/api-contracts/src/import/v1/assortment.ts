import { z } from "zod"
import { barcodeSchema, dateOnlySchema, skuSchema } from "./shared"

// Ассортимент: формат-уровень (матрица) или точечное исключение (store).
export const assortmentImportRowV1 = z
  .object({
    sku: skuSchema.nullable(),
    barcode: barcodeSchema.nullable(),
    scope: z.enum(["format", "store"]),
    formatName: z.string().trim().min(1).max(256).nullable(),
    storeCode: z.string().trim().min(1).max(64).nullable(),
    isActive: z.boolean(),
    validFrom: dateOnlySchema.nullable(),
    validTo: dateOnlySchema.nullable(),
  })
  .refine((r) => r.sku || r.barcode, { message: "sku or barcode required" })
  .refine((r) => (r.scope === "format" ? !!r.formatName : !!r.storeCode), {
    message: "formatName required for scope=format, storeCode for scope=store",
  })

export type AssortmentImportRowV1 = z.infer<typeof assortmentImportRowV1>
