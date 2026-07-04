import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { getSession } from "@/server/auth/require-session"
import { tenantDb } from "@/server/db/client"
import { EquipmentForm } from "../equipment-form"

export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ templateId: string }>
}) {
  const [{ templateId }, t, session] = await Promise.all([
    params,
    getTranslations("equipment"),
    getSession(),
  ])
  if (!session) return null

  const db = tenantDb(session.org)
  const [template, types] = await Promise.all([
    db.equipmentTemplate.findFirst({
      where: { id: templateId },
      include: {
        type: { select: { id: true, name: true } },
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: {
            shelves: { orderBy: { shelfIndex: "asc" } },
            cells: { orderBy: [{ yMm: "asc" }, { xMm: "asc" }] },
            hooks: { orderBy: [{ yMm: "asc" }, { xMm: "asc" }] },
          },
        },
      },
    }),
    db.equipmentType.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true },
    }),
  ])
  if (!template || !template.versions[0]) notFound()

  const v = template.versions[0]
  const firstShelf = v.shelves[0]

  return (
    <div>
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="text-2xl font-semibold">{template.name}</h1>
        <span className="text-sm text-neutral-500">{template.type.name}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-xs ${
            v.isFrozen ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          v{v.versionNumber} · {v.isFrozen ? t("badge.frozen") : t("badge.draft")}
        </span>
      </div>

      <EquipmentForm
        types={types}
        initial={{
          templateId: template.id,
          name: template.name,
          typeId: template.type.id,
          expectedVersionNumber: v.versionNumber,
          isFrozen: v.isFrozen,
          widthMm: v.widthMm,
          heightMm: v.heightMm,
          depthMm: v.depthMm,
          shelfCount: v.shelves.length || 5,
          shelfThicknessMm: firstShelf?.thicknessMm ?? 20,
          shelfDepthMm: firstShelf?.depthMm ?? v.depthMm,
          bottomOffsetMm: firstShelf?.yMm ?? 50,
          topOffsetMm: 0,
          cells: v.cells,
          hooks: v.hooks,
        }}
      />
    </div>
  )
}
