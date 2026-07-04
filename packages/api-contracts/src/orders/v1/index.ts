import { z } from "zod"

export const orderLineCreateSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive(),
})
export type OrderLineCreate = z.infer<typeof orderLineCreateSchema>

export const orderCreateRequestSchema = z.object({
  storeId: z.string().min(1),
  visitId: z.string().min(1).nullable().optional(),
  lines: z.array(orderLineCreateSchema).min(1).max(200),
})
export type OrderCreateRequest = z.infer<typeof orderCreateRequestSchema>

export const orderSummarySchema = z.object({
  id: z.string(),
  status: z.enum(["DRAFT", "SUBMITTED", "CONFIRMED", "DELIVERED", "CANCELLED"]),
  storeId: z.string(),
  visitId: z.string().nullable(),
  currency: z.string(),
  subtotalCents: z.number().int(),
  discountCents: z.number().int(),
  taxCents: z.number().int(),
  totalCents: z.number().int(),
  invoiceNumber: z.string().nullable(),
  createdAt: z.string(),
})
export type OrderSummary = z.infer<typeof orderSummarySchema>

export const orderCreateResponseSchema = z.object({
  order: orderSummarySchema,
})
export type OrderCreateResponse = z.infer<typeof orderCreateResponseSchema>
