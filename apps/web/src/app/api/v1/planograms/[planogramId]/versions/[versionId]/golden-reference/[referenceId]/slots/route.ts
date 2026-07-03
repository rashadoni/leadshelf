import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { PLANOGRAM_EDIT_ROLES } from "@/server/http/planogram-errors"
import { workerDb } from "@/server/db/client"

export const runtime = "nodejs"

const pct = z.number().min(0).max(100)
const sizePct = z.number().min(0.1).max(100)

const createSchema = z.object({
  placementId: z.string().min(1),
  xPct: pct,
  yPct: pct,
  widthPct: sizePct,
  heightPct: sizePct,
  label: z.string().trim().max(120).optional(),
}).refine((data) => data.xPct + data.widthPct <= 100 && data.yPct + data.heightPct <= 100, {
  message: "slot_out_of_bounds",
})

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ planogramId: string; versionId: string; referenceId: string }>
  },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!PLANOGRAM_EDIT_ROLES.has(session.role)) return forbidden()

  const [{ planogramId, versionId, referenceId }, body] = await Promise.all([
    params,
    req.json().catch(() => null),
  ])
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  const [reference, placement] = await Promise.all([
    workerDb.goldenReference.findFirst({
      where: {
        id: referenceId,
        organizationId: session.org,
        planogramVersionId: versionId,
        planogramVersion: { planogramId, planogram: { organizationId: session.org } },
      },
      select: { id: true },
    }),
    workerDb.planogramPlacement.findFirst({
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
    }),
  ])

  if (!reference) return NextResponse.json({ error: "reference_not_found" }, { status: 404 })
  if (!placement) return NextResponse.json({ error: "placement_not_found" }, { status: 404 })

  const slot = await workerDb.goldenReferenceSlot.create({
    data: {
      goldenReferenceId: reference.id,
      placementId: placement.id,
      productId: placement.productId,
      xPct: parsed.data.xPct,
      yPct: parsed.data.yPct,
      widthPct: parsed.data.widthPct,
      heightPct: parsed.data.heightPct,
      label: parsed.data.label || placement.product.name,
    },
  })

  return NextResponse.json(
    {
      id: slot.id,
      placementId: slot.placementId,
      productId: slot.productId,
      productSku: placement.product.sku,
      productName: placement.product.name,
      label: slot.label,
      xPct: slot.xPct,
      yPct: slot.yPct,
      widthPct: slot.widthPct,
      heightPct: slot.heightPct,
    },
    { status: 201 },
  )
}
