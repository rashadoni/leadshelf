import type { NextRequest } from "next/server"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { handleCommercialMediaUpload } from "@/server/mobile/commercial-media-upload-handler"

export const runtime = "nodejs"
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const session = await requireApiSession(req)
  if (!session?.did) return unauthorized()
  return handleCommercialMediaUpload(req, {
    org: session.org,
    sub: session.sub,
    did: session.did,
    role: session.role,
  })
}
