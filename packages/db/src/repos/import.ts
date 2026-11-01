import type { PrismaClient } from "@leadshelf/prisma-client"

// Parent-path репозиторий (паттерн из Codex-дизайна tenant-клиента):
// ImportError не имеет organizationId, поэтому generic-доступ через tenant
// client заблокирован. Доступ — только через владение батчем.

export interface ListImportErrorsOptions {
  severity?: "error" | "warning"
  limit?: number
  cursor?: string
}

export async function listImportErrorsForBatch(
  prisma: PrismaClient,
  organizationId: string,
  batchId: string,
  opts: ListImportErrorsOptions = {},
) {
  const batch = await prisma.importBatch.findFirst({
    where: { id: batchId, organizationId },
    select: { id: true },
  })
  if (!batch) return null

  const limit = Math.min(opts.limit ?? 50, 200)
  const errors = await prisma.importError.findMany({
    where: { batchId, ...(opts.severity ? { severity: opts.severity } : {}) },
    orderBy: [{ rowNumber: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  })

  const hasMore = errors.length > limit
  const page = hasMore ? errors.slice(0, limit) : errors
  return {
    errors: page,
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  }
}
