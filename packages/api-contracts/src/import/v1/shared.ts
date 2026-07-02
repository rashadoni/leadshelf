import { z } from "zod"

// Общие примитивы staging-контракта catalog-import.v1.
// Контракт ЗАМОРОЖЕН после выхода в прод: изменения -> v2 рядом, не правкой v1.

export const CONTRACT_VERSION = "catalog-import.v1" as const

export const skuSchema = z.string().trim().min(1).max(64)

// Штрих-код строкой: ведущие нули значимы (Excel их съедает — чиним на парсинге).
export const barcodeSchema = z
  .string()
  .trim()
  .regex(/^\d{4,14}$/, "barcode must be 4-14 digits")

// Decimal только строкой: JS float теряет точность на деньгах.
export const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, "decimal as string, dot separator")

export const nonNegativeDecimalStringSchema = decimalStringSchema.refine(
  (v) => !v.startsWith("-"),
  "must be non-negative",
)

// Дата без времени (снапшоты дневные): YYYY-MM-DD.
export const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date as YYYY-MM-DD")

export const productUnitSchema = z.enum(["PCS", "BOX", "KG", "L", "PACK"])

export const importEntityTypeSchema = z.enum([
  "products",
  "prices",
  "stock",
  "sales",
  "assortment",
])
export type ImportEntityType = z.infer<typeof importEntityTypeSchema>

export const importSeveritySchema = z.enum(["error", "warning"])

export const importBatchStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "COMPLETED_WITH_ERRORS",
  "FAILED",
])

/** Позитивное целое в мм/граммах (габариты). */
export const positiveIntSchema = z.number().int().positive()
