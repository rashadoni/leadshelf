import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { expireOverdueTasks, getTaskSlaSummary } from "@leadshelf/db"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { tenantDb, workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const querySchema = z.object({
  status: z
    .enum(["NEW", "IN_PROGRESS", "PHOTO_SUBMITTED", "COMPLETED", "EXPIRED", "EMPTY"])
    .optional(),
  storeId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 })
  const { status, storeId, limit, cursor } = parsed.data
  await expireOverdueTasks(workerDb, session.org)

  const [tasks, sla] = await Promise.all([
    tenantDb(session.org).task.findMany({
      where: { ...(status ? { status } : {}), ...(storeId ? { storeId } : {}) },
      include: {
        store: { select: { id: true, name: true, code: true } },
        planogramVersion: {
          select: { id: true, versionNumber: true, planogram: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    getTaskSlaSummary(workerDb, session.org),
  ])

  const hasMore = tasks.length > limit
  const page = hasMore ? tasks.slice(0, limit) : tasks
  return NextResponse.json({
    sla,
    tasks: page.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dueAt: t.dueAt?.toISOString() ?? null,
      store: t.store,
      planogram: t.planogramVersion
        ? {
            id: t.planogramVersion.planogram.id,
            name: t.planogramVersion.planogram.name,
            versionId: t.planogramVersion.id,
            versionNumber: t.planogramVersion.versionNumber,
          }
        : null,
      createdAt: t.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  })
}
