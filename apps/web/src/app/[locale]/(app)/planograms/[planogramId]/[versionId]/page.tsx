import { notFound } from "next/navigation"
import { getSession } from "@/server/auth/require-session"
import { getPlanogramEditor } from "@leadshelf/db"
import { tenantDb, workerDb } from "@/server/db/client"
import { PlanogramEditor } from "./planogram-editor"

export default async function PlanogramEditorPage({
  params,
}: {
  params: Promise<{ planogramId: string; versionId: string }>
}) {
  const [{ planogramId, versionId }, session] = await Promise.all([params, getSession()])
  if (!session) return null

  const payload = await getPlanogramEditor(workerDb, session.org, planogramId, versionId)
  if (!payload) notFound()

  const eq = payload.version.equipment[0]
  if (!eq) notFound()

  const db = tenantDb(session.org)
  const [formats, stores] = await Promise.all([
    db.storeFormat.findMany({
      select: { id: true, name: true, _count: { select: { stores: { where: { isActive: true } } } } },
      orderBy: { name: "asc" },
    }),
    db.store.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
  ])

  return (
    <PlanogramEditor
      publishOptions={{
        formats: formats.map((f) => ({ id: f.id, name: f.name, storeCount: f._count.stores })),
        stores,
      }}
      planogram={{ id: payload.planogram.id, name: payload.planogram.name }}
      version={{
        id: payload.version.id,
        versionNumber: payload.version.versionNumber,
        state: payload.version.state,
        revision: payload.version.updatedAt.toISOString(),
      }}
      equipment={{
        name: eq.equipmentVersion.template.name,
        widthMm: eq.equipmentVersion.widthMm,
        heightMm: eq.equipmentVersion.heightMm,
        depthMm: eq.equipmentVersion.depthMm,
        shelves: eq.equipmentVersion.shelves.map((s) => ({
          id: s.id,
          shelfIndex: s.shelfIndex,
          yMm: s.yMm,
          thicknessMm: s.thicknessMm,
          depthMm: s.depthMm,
        })),
      }}
      initialPlacements={payload.version.placements.map((p) => ({
        id: p.id,
        shelfId: p.shelfId ?? "",
        xMm: p.xMm,
        widthMm: p.widthMm,
        heightMm: p.heightMm,
        depthMm: p.depthMm,
        facingsX: p.facingsX,
        facingsY: p.facingsY,
        facingsZ: p.facingsZ,
        product: {
          id: p.product.id,
          sku: p.product.sku,
          name: p.product.name,
          brandName: p.product.brand?.name ?? null,
          imageKey: p.product.images[0]?.url ?? null,
        },
      }))}
    />
  )
}
