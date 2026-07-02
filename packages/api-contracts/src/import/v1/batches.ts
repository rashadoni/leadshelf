import { z } from "zod"
import { importBatchStatusSchema, importEntityTypeSchema, importSeveritySchema } from "./shared"

export const importBatchDtoV1 = z.object({
  id: z.string(),
  entityType: importEntityTypeSchema,
  status: importBatchStatusSchema,
  totalRows: z.number().int().nonnegative(),
  errorRows: z.number().int().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type ImportBatchDtoV1 = z.infer<typeof importBatchDtoV1>

export const importErrorDtoV1 = z.object({
  id: z.string(),
  rowNumber: z.number().int().nullable(),
  field: z.string().nullable(),
  reason: z.string(),
  severity: importSeveritySchema,
  suggestedFix: z.string().nullable(),
})
export type ImportErrorDtoV1 = z.infer<typeof importErrorDtoV1>
