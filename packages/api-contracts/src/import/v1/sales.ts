import { z } from "zod"
import {
  barcodeSchema,
  dateOnlySchema,
  decimalStringSchema,
  nonNegativeDecimalStringSchema,
  skuSchema,
} from "./shared"

export const salesImportRowV1 = z
  .object({
    sku: skuSchema.nullable(),
    barcode: barcodeSchema.nullable(),
    date: dateOnlySchema,
    storeCode: z.string().trim().min(1).max(64).nullable(),
    quantity: decimalStringSchema,
    revenue: nonNegativeDecimalStringSchema,
    profit: decimalStringSchema.nullable(),
  })
  .refine((r) => r.sku || r.barcode, { message: "sku or barcode required" })

export type SalesImportRowV1 = z.infer<typeof salesImportRowV1>
