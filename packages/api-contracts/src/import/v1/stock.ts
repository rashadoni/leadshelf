import { z } from "zod"
import { barcodeSchema, dateOnlySchema, decimalStringSchema, skuSchema } from "./shared"

export const stockImportRowV1 = z
  .object({
    sku: skuSchema.nullable(),
    barcode: barcodeSchema.nullable(),
    date: dateOnlySchema,
    storeCode: z.string().trim().min(1).max(64).nullable(),
    warehouseCode: z.string().trim().min(1).max(64).nullable(),
    quantity: decimalStringSchema,
  })
  .refine((r) => r.sku || r.barcode, { message: "sku or barcode required" })

export type StockImportRowV1 = z.infer<typeof stockImportRowV1>
