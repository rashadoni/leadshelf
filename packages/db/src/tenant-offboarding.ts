import { Prisma, type PrismaClient } from "@leadshelf/prisma-client"

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/

export interface TenantOffboardingPreview {
  organization: { id: string; slug: string; name: string }
  rowsByTable: Array<{ table: string; rows: number }>
  totalRows: number
  mediaReferences: string[]
}

export interface DeleteTenantDataInput {
  organizationId: string
  slug: string
  confirmation: string
  approvals: string[]
  backupReceipt: string
  mediaDeletionReceipt: string
  legalHoldCleared: boolean
}

export interface DeleteTenantDataResult {
  organizationId: string
  slug: string
  deletedRowsByTable: Array<{ table: string; rows: number }>
  deletedRows: number
  backupReceipt: string
  mediaDeletionReceipt: string
}

type DatabaseClient = PrismaClient | Prisma.TransactionClient

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`[tenant-offboarding] ${field} обязателен`)
  return normalized
}

function quoteIdentifier(identifier: string): string {
  if (!SAFE_IDENTIFIER.test(identifier)) {
    throw new Error(`[tenant-offboarding] небезопасный DB identifier: ${identifier}`)
  }
  return `"${identifier}"`
}

async function organizationOrThrow(
  prisma: DatabaseClient,
  organizationId: string,
  slug: string,
) {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, slug },
    select: { id: true, slug: true, name: true },
  })
  if (!organization) {
    throw new Error("[tenant-offboarding] organizationId/slug не совпадают")
  }
  return organization
}

async function scopedTables(prisma: DatabaseClient): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ tableName: string }>>(Prisma.sql`
    SELECT DISTINCT columns.table_name AS "tableName"
    FROM information_schema.columns AS columns
    JOIN information_schema.tables AS tables
      ON tables.table_schema = columns.table_schema
     AND tables.table_name = columns.table_name
    WHERE columns.table_schema = current_schema()
      AND columns.column_name = 'organizationId'
      AND tables.table_type = 'BASE TABLE'
    ORDER BY columns.table_name
  `)
  return rows.map(({ tableName }) => {
    quoteIdentifier(tableName)
    return tableName
  })
}

async function countScopedRows(
  prisma: DatabaseClient,
  organizationId: string,
  tables: string[],
): Promise<Array<{ table: string; rows: number }>> {
  const counts: Array<{ table: string; rows: number }> = []
  for (const table of tables) {
    const result = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(table)} WHERE "organizationId" = $1`,
      organizationId,
    )
    counts.push({ table, rows: Number(result[0]?.count ?? 0n) })
  }
  return counts
}

async function mediaReferences(prisma: DatabaseClient, organizationId: string): Promise<string[]> {
  const [proofs, productImages, importArtifacts] = await Promise.all([
    prisma.photoSubmission.findMany({
      where: { organizationId },
      select: { url: true, thumbnailUrl: true },
    }),
    prisma.productImage.findMany({
      where: { product: { organizationId } },
      select: { url: true },
    }),
    prisma.importQueueJob.findMany({
      where: { organizationId },
      select: { storagePath: true },
    }),
  ])
  return [...new Set([
    ...proofs.flatMap((proof) => [proof.url, proof.thumbnailUrl]),
    ...productImages.map((image) => image.url),
    ...importArtifacts.map((artifact) => artifact.storagePath),
  ].filter((value): value is string => Boolean(value?.trim())))]
    .sort((a, b) => a.localeCompare(b))
}

export async function previewTenantOffboarding(
  prisma: PrismaClient,
  input: { organizationId: string; slug: string },
): Promise<TenantOffboardingPreview> {
  const organizationId = required(input.organizationId, "organizationId")
  const slug = required(input.slug, "slug")
  const organization = await organizationOrThrow(prisma, organizationId, slug)
  const tables = await scopedTables(prisma)
  const [rowsByTable, references] = await Promise.all([
    countScopedRows(prisma, organizationId, tables),
    mediaReferences(prisma, organizationId),
  ])
  return {
    organization,
    rowsByTable,
    totalRows: rowsByTable.reduce((sum, row) => sum + row.rows, 0),
    mediaReferences: references,
  }
}

function validateExecution(input: DeleteTenantDataInput): void {
  const expected = `DELETE ${input.slug} ${input.organizationId}`
  if (input.confirmation !== expected) {
    throw new Error(`[tenant-offboarding] confirmation должна точно совпадать: ${expected}`)
  }
  const approvals = new Set(input.approvals.map((value) => value.trim()).filter(Boolean))
  if (approvals.size < 2) {
    throw new Error("[tenant-offboarding] нужны два разных approval ID")
  }
  required(input.backupReceipt, "backupReceipt")
  required(input.mediaDeletionReceipt, "mediaDeletionReceipt")
  if (!input.legalHoldCleared) {
    throw new Error("[tenant-offboarding] legal hold должен быть явно очищен")
  }
}

async function foreignKeyDeletionOrder(
  prisma: DatabaseClient,
  tables: string[],
): Promise<string[]> {
  const tableSet = new Set(tables)
  const edges = await prisma.$queryRaw<Array<{ child: string; parent: string }>>(Prisma.sql`
    SELECT child.relname AS child, parent.relname AS parent
    FROM pg_constraint AS con
    JOIN pg_class AS child ON child.oid = con.conrelid
    JOIN pg_class AS parent ON parent.oid = con.confrelid
    JOIN pg_namespace AS namespace ON namespace.oid = child.relnamespace
    WHERE con.contype = 'f'
      AND namespace.nspname = current_schema()
  `)
  const dependencies = new Map(tables.map((table) => [table, new Set<string>()]))
  for (const { child, parent } of edges) {
    if (child !== parent && tableSet.has(child) && tableSet.has(parent)) {
      dependencies.get(parent)?.add(child)
    }
  }
  const ordered: string[] = []
  const remaining = new Set(tables)
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((table) => [...(dependencies.get(table) ?? [])].every((child) => !remaining.has(child)))
      .sort((a, b) => a.localeCompare(b))
    if (ready.length === 0) {
      throw new Error("[tenant-offboarding] циклические FK между tenant tables")
    }
    for (const table of ready) {
      ordered.push(table)
      remaining.delete(table)
    }
  }
  return ordered
}

export async function deleteTenantData(
  prisma: PrismaClient,
  input: DeleteTenantDataInput,
): Promise<DeleteTenantDataResult> {
  const organizationId = required(input.organizationId, "organizationId")
  const slug = required(input.slug, "slug")
  validateExecution({ ...input, organizationId, slug })

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`)
    await organizationOrThrow(tx, organizationId, slug)
    const tables = await scopedTables(tx)
    const orderedTables = await foreignKeyDeletionOrder(tx, tables)
    const deletedRowsByTable: Array<{ table: string; rows: number }> = []
    for (const table of orderedTables) {
      const rows = await tx.$executeRawUnsafe(
        `DELETE FROM ${quoteIdentifier(table)} WHERE "organizationId" = $1`,
        organizationId,
      )
      deletedRowsByTable.push({ table, rows })
    }
    const deletedOrganizations = await tx.organization.deleteMany({
      where: { id: organizationId, slug },
    })
    if (deletedOrganizations.count !== 1) {
      throw new Error("[tenant-offboarding] organization delete invariant нарушен")
    }
    const residue = await countScopedRows(tx, organizationId, tables)
    if (residue.some(({ rows }) => rows !== 0)) {
      throw new Error("[tenant-offboarding] после удаления остались tenant-scoped rows")
    }
    return {
      organizationId,
      slug,
      deletedRowsByTable,
      deletedRows: deletedRowsByTable.reduce((sum, row) => sum + row.rows, 0) + 1,
      backupReceipt: input.backupReceipt.trim(),
      mediaDeletionReceipt: input.mediaDeletionReceipt.trim(),
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
}
