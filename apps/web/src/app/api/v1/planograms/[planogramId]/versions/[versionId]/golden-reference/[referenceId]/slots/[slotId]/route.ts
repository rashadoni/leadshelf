import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { PLANOGRAM_EDIT_ROLES } from "@/server/http/planogram-errors"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const pct = z.number().min(0).max(100)
const sizePct = z.number().min(0.1).max(100)

const patchSchema = z.object({
  placementId: z.string().min(1).optional(),
  xPct: pct.optional(),
  yPct: pct.optional(),
  widthPct: sizePct.optional(),
  heightPct: sizePct.optional(),
  label: z.string().trim().max(120).optional(),
})

async function findSlot(
  organizationId: string,
  planogramId: string,
  versionId: string,
  referenceId: string,
  slotId: string,
) {
  return workerDb.goldenReferenceSlot.findFirst({
    where: {
      id: slotId,
      goldenReferenceId: referenceId,
      goldenReference: {
        organizationId,
        planogramVersionId: versionId,
        planogramVersion: { planogramId, planogram: { organizationId } },
      },
    },
    select: {
      id: true,
      placementId: true,
      productId: true,
      xPct: true,
      yPct: true,
      widthPct: true,
      heightPct: true,
      label: true,
    },
  })
}

export async function PATCH(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ planogramId: string; versionId: string; referenceId: string; slotId: string }>
  },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()

  const [{ planogramId, versionId, referenceId, slotId }, body] = await Promise.all([
    params,
    req.json().catch(() => null),
  ])
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  const slot = await findSlot(session.org, planogramId, versionId, referenceId, slotId)
  if (!slot) return NextResponse.json({ error: "slot_not_found" }, { status: 404 })

  const next = {
    xPct: parsed.data.xPct ?? slot.xPct,
    yPct: parsed.data.yPct ?? slot.yPct,
    widthPct: parsed.data.widthPct ?? slot.widthPct,
    heightPct: parsed.data.heightPct ?? slot.heightPct,
  }
  if (next.xPct + next.widthPct > 100 || next.yPct + next.heightPct > 100) {
    return NextResponse.json({ error: "slot_out_of_bounds" }, { status: 422 })
  }

  const placement = parsed.data.placementId
    ? await workerDb.planogramPlacement.findFirst({
        where: {
          id: parsed.data.placementId,
          planogramVersionId: versionId,
          planogramVersion: { planogramId, planogram: { organizationId: session.org } },
        },
        select: {
          id: true,
          productId: true,
          product: { select: { sku: true, name: true } },
        },
      })
    : null
  if (parsed.data.placementId && !placement) {
    return NextResponse.json({ error: "placement_not_found" }, { status: 404 })
  }

  const updated = await workerDb.goldenReferenceSlot.update({
    where: { id: slot.id },
    data: {
      placementId: placement?.id ?? undefined,
      productId: placement?.productId ?? undefined,
      label: parsed.data.label,
      xPct: next.xPct,
      yPct: next.yPct,
      widthPct: next.widthPct,
      heightPct: next.heightPct,
    },
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
  })

  return NextResponse.json({
    id: updated.id,
    placementId: updated.placementId,
    productId: updated.productId,
    productSku: updated.product?.sku ?? null,
    productName: updated.product?.name ?? null,
    label: updated.label,
    xPct: updated.xPct,
    yPct: updated.yPct,
    widthPct: updated.widthPct,
    heightPct: updated.heightPct,
  })
}

export async function DELETE(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ planogramId: string; versionId: string; referenceId: string; slotId: string }>
  },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()

  const { planogramId, versionId, referenceId, slotId } = await params
  const slot = await findSlot(session.org, planogramId, versionId, referenceId, slotId)
  if (!slot) return NextResponse.json({ error: "slot_not_found" }, { status: 404 })

  await workerDb.goldenReferenceSlot.delete({ where: { id: slot.id } })
  return NextResponse.json({ ok: true })
}
