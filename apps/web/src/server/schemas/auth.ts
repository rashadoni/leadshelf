import { z } from "zod"

export const loginSchema = z.object({
  organizationSlug: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/i),
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
})
