import { timingSafeEqual } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { authDb } from "@/server/db/client"
import { checkObjectStorage, getObjectStorageInventory } from "@/server/storage/s3"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type StatusCount = { status: string; count: bigint }
type Scalar = { value: bigint | number | null }

function authorized(req: NextRequest): boolean {
  const expected = process.env.METRICS_BEARER_TOKEN
  const actual = req.headers.get("authorization")?.replace(/^Bearer\s+/, "")
  if (!expected || !actual) return false
  const expectedBytes = Buffer.from(expected)
  const actualBytes = Buffer.from(actual)
  return expectedBytes.length === actualBytes.length
    && timingSafeEqual(expectedBytes, actualBytes)
}

function metric(name: string, help: string, value: number, labels?: Record<string, string>): string {
  const renderedLabels = labels
    ? `{${Object.entries(labels).map(([key, item]) => `${key}="${item.replace(/["\\\n]/g, "_")}"`).join(",")}}`
    : ""
  return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name}${renderedLabels} ${value}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new NextResponse("not found", { status: 404 })

  const startedAt = performance.now()
  const [
    databaseSize,
    outbox,
    unresolvedConflicts,
    importQueue,
    oldestImport,
    proofAnalysis,
    notifications,
    latestImport,
    storageReady,
    storageInventory,
  ] = await Promise.all([
    authDb.$queryRaw<Scalar[]>`SELECT pg_database_size(current_database())::bigint AS value`,
    authDb.$queryRaw<StatusCount[]>`SELECT status::text, count(*)::bigint AS count FROM outbox_operations GROUP BY status`,
    authDb.$queryRaw<Scalar[]>`SELECT count(*)::bigint AS value FROM sync_conflicts WHERE "resolvedAt" IS NULL`,
    authDb.$queryRaw<StatusCount[]>`SELECT status::text, count(*)::bigint AS count FROM import_queue_jobs GROUP BY status`,
    authDb.$queryRaw<Scalar[]>`
      SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min("createdAt"))), 0)::double precision AS value
      FROM import_queue_jobs WHERE status IN ('PENDING','PROCESSING')`,
    authDb.$queryRaw<StatusCount[]>`SELECT "analysisStatus"::text AS status, count(*)::bigint AS count FROM photo_submissions GROUP BY "analysisStatus"`,
    authDb.$queryRaw<StatusCount[]>`SELECT status, count(*)::bigint AS count FROM notification_deliveries GROUP BY status`,
    authDb.$queryRaw<Scalar[]>`
      SELECT COALESCE(EXTRACT(EPOCH FROM max("finishedAt")), 0)::double precision AS value
      FROM import_batches WHERE "finishedAt" IS NOT NULL`,
    checkObjectStorage().then(() => 1).catch(() => 0),
    getObjectStorageInventory().catch(() => null),
  ])

  const lines = [
    metric("leadshelf_database_size_bytes", "Current PostgreSQL database size.", Number(databaseSize[0]?.value ?? 0)),
    metric("leadshelf_sync_conflicts_unresolved", "Unresolved mobile sync conflicts.", Number(unresolvedConflicts[0]?.value ?? 0)),
    metric("leadshelf_import_oldest_pending_seconds", "Age of oldest pending or processing import.", Number(oldestImport[0]?.value ?? 0)),
    metric("leadshelf_import_last_success_timestamp_seconds", "Latest finished import UNIX timestamp.", Number(latestImport[0]?.value ?? 0)),
    metric("leadshelf_object_storage_ready", "Object storage dependency readiness.", storageReady),
    metric("leadshelf_object_storage_inventory_ready", "Object storage inventory collection status.", storageInventory ? 1 : 0),
    metric("leadshelf_object_storage_objects", "Objects currently stored in the media bucket.", storageInventory?.objects ?? 0),
    metric("leadshelf_object_storage_bytes", "Bytes currently stored in the media bucket.", storageInventory?.bytes ?? 0),
    metric(
      "leadshelf_object_storage_inventory_age_seconds",
      "Age of the cached object storage inventory.",
      storageInventory ? Math.max(0, (Date.now() - storageInventory.collectedAtMs) / 1000) : 0,
    ),
    metric("leadshelf_metrics_collection_duration_seconds", "Duration of metrics DB/storage collection.", (performance.now() - startedAt) / 1000),
  ]
  for (const row of outbox) {
    lines.push(metric("leadshelf_mobile_outbox_operations", "Server-side mobile outbox operations by status.", Number(row.count), { status: row.status }))
  }
  for (const row of importQueue) {
    lines.push(metric("leadshelf_import_queue_jobs", "Catalog import queue jobs by status.", Number(row.count), { status: row.status }))
  }
  for (const row of proofAnalysis) {
    lines.push(metric("leadshelf_proof_analysis_submissions", "Proof analysis submissions by status.", Number(row.count), { status: row.status }))
  }
  for (const row of notifications) {
    lines.push(metric("leadshelf_notification_deliveries", "Notification deliveries by status.", Number(row.count), { status: row.status }))
  }

  return new NextResponse(`${lines.join("\n")}\n`, {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  })
}
