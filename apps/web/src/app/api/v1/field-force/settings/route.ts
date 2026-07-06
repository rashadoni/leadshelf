import { NextResponse, type NextRequest } from "next/server"
import { workerDb } from "@/server/db/client"
import { requireApiSession, unauthorized, forbidden } from "@/server/http/api-guard"
import { canAdminFieldForce, canReadFieldForce } from "@/server/field-force/permissions"
import {
  fieldForceSettingsPatchSchema,
  normalizeFieldForceSettings,
  shapeFieldForceSettings,
} from "@/server/field-force/settings"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!canReadFieldForce(session.role)) return forbidden()

  const row = await workerDb.fieldForceSetting.findUnique({
    where: { organizationId: session.org },
  })

  return NextResponse.json({
    success: true,
    data: { settings: shapeFieldForceSettings(row) },
  })
}

export async function PUT(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  if (!canAdminFieldForce(session.role)) return forbidden()

  const parsed = fieldForceSettingsPatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", details: parsed.error.flatten() }, { status: 400 })
  }

  const current = await workerDb.fieldForceSetting.findUnique({
    where: { organizationId: session.org },
  })
  const settings = normalizeFieldForceSettings({ ...shapeFieldForceSettings(current), ...parsed.data })
  const row = await workerDb.fieldForceSetting.upsert({
    where: { organizationId: session.org },
    create: {
      organizationId: session.org,
      ...settings,
    },
    update: settings,
  })

  return NextResponse.json({
    success: true,
    data: { settings: shapeFieldForceSettings(row) },
  })
}
