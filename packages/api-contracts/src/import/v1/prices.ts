import { z } from "zod"
import {
  barcodeSchema,
  dateOnlySchema,
  nonNegativeDecimalStringSchema,
  skuSchema,
} from "./shared"

export const priceImportRowV1 = z
  .object({
    sku: skuSchema.nullable(),
    barcode: barcodeSchema.nullable(),
    date: dateOnlySchema,
    // null = цена по всей сети (org-wide)
    storeCode: z.string().trim().min(1).max(64).nullable(),
    price: nonNegativeDecimalStringSchema,
    costPrice: nonNegativeDecimalStringSchema.nullable(),
    currency: z.string().trim().length(3).default("AZN"),
  })
  .refine((r) => r.sku || r.barcode, { message: "sku or barcode required" })

export type PriceImportRowV1 = z.infer<typeof priceImportRowV1>
