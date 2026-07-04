import { z } from "zod"
import { barcodeSchema, positiveIntSchema, productUnitSchema, skuSchema } from "./shared"

// Строка импорта товара (staging-контракт, НЕ сырые CSV-заголовки —
// алиасы заголовков резолвятся парсером в packages/core).
export const productImportRowV1 = z.object({
  sku: skuSchema,
  name: z.string().trim().min(1).max(512),
  barcode: barcodeSchema.nullable(),
  // Категория: путь "OTC / Обезболивающие / Таблетки" ИЛИ код из 1С.
  categoryPath: z.string().trim().min(1).nullable(),
  categoryCode: z.string().trim().min(1).max(64).nullable(),
  brandName: z.string().trim().min(1).max(256).nullable(),
  supplierName: z.string().trim().min(1).max(256).nullable(),
  manufacturerName: z.string().trim().min(1).max(256).nullable(),
  unit: productUnitSchema,
  widthMm: positiveIntSchema.nullable(),
  heightMm: positiveIntSchema.nullable(),
  depthMm: positiveIntSchema.nullable(),
  weightG: positiveIntSchema.nullable(),
  isSoftPack: z.boolean().default(false),
  externalId: z.string().trim().min(1).max(128).nullable(),
  isActive: z.boolean(),
})

export type ProductImportRowV1 = z.infer<typeof productImportRowV1>
