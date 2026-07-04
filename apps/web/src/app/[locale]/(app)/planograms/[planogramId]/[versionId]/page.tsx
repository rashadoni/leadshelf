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
  const [formats, stores, categories, brands, suppliers, versionHistory, goldenReferences, goldenPhotoCandidates] = await Promise.all([
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
    db.category.findMany({ orderBy: { normalizedPath: "asc" }, select: { id: true, normalizedPath: true, name: true }, take: 500 }),
    db.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
    workerDb.planogramVersion.findMany({
      where: { planogramId, planogram: { organizationId: session.org } },
      select: {
        id: true,
        versionNumber: true,
        state: true,
        createdAt: true,
        publishedAt: true,
        placements: {
          select: {
            productId: true,
            shelfId: true,
            xMm: true,
            widthMm: true,
            heightMm: true,
            depthMm: true,
            facingsX: true,
            facingsY: true,
            facingsZ: true,
            product: { select: { sku: true, name: true } },
          },
          orderBy: [{ shelfId: "asc" }, { xMm: "asc" }],
        },
      },
      orderBy: { versionNumber: "asc" },
    }),
    db.goldenReference.findMany({
      where: { planogramVersionId: versionId },
      select: {
        id: true,
        imageUrl: true,
        status: true,
        createdAt: true,
        slots: {
          select: {
            id: true,
            placementId: true,
            productId: true,
            label: true,
            xPct: true,
            yPct: true,
            widthPct: true,
            heightPct: true,
            product: { select: { sku: true, name: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.photoSubmission.findMany({
      where: { task: { planogramVersionId: versionId } },
      select: {
        id: true,
        url: true,
        takenAt: true,
        qualityScore: true,
        store: { select: { name: true, code: true } },
        user: { select: { name: true } },
      },
      orderBy: { takenAt: "desc" },
      take: 20,
    }),
  ])

  return (
    <PlanogramEditor
      publishOptions={{
        formats: formats.map((f) => ({ id: f.id, name: f.name, storeCount: f._count.stores })),
        stores,
      }}
      autoPlacementOptions={{
        categories: categories.map((category) => ({
          id: category.id,
          name: category.normalizedPath || category.name,
        })),
        brands,
        suppliers,
      }}
      planogram={{ id: payload.planogram.id, name: payload.planogram.name }}
      version={{
        id: payload.version.id,
        versionNumber: payload.version.versionNumber,
        state: payload.version.state,
        revision: payload.version.updatedAt.toISOString(),
      }}
      initialZones={payload.version.zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        color: zone.color,
        xMm: zone.xMm,
        yMm: zone.yMm,
        widthMm: zone.widthMm,
        heightMm: zone.heightMm,
      }))}
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
      versionHistory={versionHistory.map((item) => ({
        id: item.id,
        versionNumber: item.versionNumber,
        state: item.state,
        createdAt: item.createdAt.toISOString(),
        publishedAt: item.publishedAt?.toISOString() ?? null,
        placements: item.placements.map((placement) => ({
          productId: placement.productId,
          productSku: placement.product.sku,
          productName: placement.product.name,
          shelfId: placement.shelfId ?? "",
          xMm: placement.xMm,
          widthMm: placement.widthMm,
          heightMm: placement.heightMm,
          depthMm: placement.depthMm,
          facingsX: placement.facingsX,
          facingsY: placement.facingsY,
          facingsZ: placement.facingsZ,
        })),
      }))}
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
      goldenReferences={goldenReferences.map((ref) => ({
        id: ref.id,
        imageUrl: ref.imageUrl,
        status: ref.status,
        createdAt: ref.createdAt.toISOString(),
        slots: ref.slots.map((slot) => ({
          id: slot.id,
          placementId: slot.placementId,
          productId: slot.productId,
          productSku: slot.product?.sku ?? null,
          productName: slot.product?.name ?? null,
          label: slot.label,
          xPct: slot.xPct,
          yPct: slot.yPct,
          widthPct: slot.widthPct,
          heightPct: slot.heightPct,
        })),
      }))}
      goldenPhotoCandidates={goldenPhotoCandidates.map((photo) => ({
        id: photo.id,
        imageUrl: photo.url,
        takenAt: photo.takenAt.toISOString(),
        qualityScore: photo.qualityScore,
        storeName: photo.store.code ? `${photo.store.name} (${photo.store.code})` : photo.store.name,
        userName: photo.user.name,
      }))}
    />
  )
}
