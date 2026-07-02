import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  executeAssortmentImport,
  executeProductsImport,
  executeSnapshotsImport,
  readCsvRecords,
  readXlsxRecords,
} from "@leadshelf/worker"
import { canImport, forbidden, requireApiSession, unauthorized } from "@/server/http/api-guard"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"
// импорт до ~10k строк выполняется синхронно; крупные файлы уйдут в очередь
// (pg-boss) следующим срезом — тогда этот роут станет enqueue-only
export const maxDuration = 300

const formSchema = z.object({
  entityType: z.enum(["products", "prices", "stock", "sales", "assortment"]),
  encoding: z.enum(["utf-8", "windows-1251"]).default("utf-8"),
  delimiter: z.enum([",", ";"]).optional(),
})

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!canImport(session)) return forbidden()

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: "multipart_expected" }, { status: 400 })

  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 })
  }
  const parsed = formSchema.safeParse({
    entityType: form.get("entityType"),
    encoding: form.get("encoding") ?? undefined,
    delimiter: form.get("delimiter") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const isXlsx =
    file.name.toLowerCase().endsWith(".xlsx") ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  let rows
  try {
    rows = isXlsx
      ? readXlsxRecords(buffer)
      : readCsvRecords(buffer, {
          encoding: parsed.data.encoding,
          delimiter: parsed.data.delimiter,
        })
  } catch (e) {
    return NextResponse.json(
      { error: "file_parse_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 422 },
    )
  }

  const common = {
    organizationId: session.org,
    rows,
    source: "csv" as const,
    createdById: session.sub,
  }
  const { entityType } = parsed.data
  const summary =
    entityType === "products"
      ? await executeProductsImport(workerDb, common)
      : entityType === "assortment"
        ? await executeAssortmentImport(workerDb, common)
        : await executeSnapshotsImport(workerDb, { ...common, entityType })

  return NextResponse.json(summary, { status: 201 })
}
