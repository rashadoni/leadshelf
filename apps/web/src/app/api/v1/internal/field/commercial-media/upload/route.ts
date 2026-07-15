import type { NextRequest } from "next/server"
import { requireFieldBffSession } from "@/server/field-bff/auth"
import { handleCommercialMediaUpload } from "@/server/mobile/commercial-media-upload-handler"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const auth = await requireFieldBffSession(req)
  if (!auth.ok) return auth.response
  return handleCommercialMediaUpload(req, auth.session)
}
