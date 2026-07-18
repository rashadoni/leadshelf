import type { NextRequest } from "next/server"
import { requireFieldBffSession } from "@/server/field-bff/auth"
import { handleMobilePhotoUpload } from "@/server/mobile/photo-upload-handler"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const auth = await requireFieldBffSession(req)
  if (!auth.ok) return auth.response
  return handleMobilePhotoUpload(req, auth.session)
}
