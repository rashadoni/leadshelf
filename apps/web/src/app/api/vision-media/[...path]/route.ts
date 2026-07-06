import { NextResponse, type NextRequest } from "next/server"
import { getObject } from "@/server/storage/s3"
import { verifyVisionMediaSignature } from "@/server/services/vision-media-url"

export const runtime = "nodejs"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const secret = process.env.VISION_MEDIA_SIGNING_SECRET
  if (!secret) return NextResponse.json({ error: "vision_media_not_configured" }, { status: 404 })

  const { path } = await params
  const key = path.join("/")
  if (!key.startsWith("photos/") && !key.startsWith("frames/")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const expires = Number.parseInt(req.nextUrl.searchParams.get("expires") ?? "", 10)
  const signature = req.nextUrl.searchParams.get("sig") ?? ""
  const valid = verifyVisionMediaSignature({ key, expires, signature, secret })
  if (!valid) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const object = await getObject(key)
  if (!object) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return new NextResponse(object.body, {
    headers: {
      "Content-Type": object.contentType,
      "Cache-Control": "private, max-age=300",
    },
  })
}
