import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { protocolMismatchFromHeader } from "@/server/mobile/protocol"
import { getObject } from "@/server/storage/s3"

export const runtime = "nodejs"

// Bearer-медиа для мобильного: те же ключи, что /api/media, но auth по
// заголовку. Тенант-guard: ключ обязан начинаться с {products|photos|videos|frames}/{org}/.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()
  // GET-медиа: валидируем протокол, только если клиент его прислал (тег
  // <img>/<video> не может выставить заголовок) — docs/26.
  const mismatch = protocolMismatchFromHeader(req, { required: false })
  if (mismatch) return mismatch

  const { path } = await params
  const key = path.join("/")
  const allowed =
    key.startsWith(`products/${session.org}/`) ||
    key.startsWith(`photos/${session.org}/`) ||
    key.startsWith(`videos/${session.org}/`) ||
    key.startsWith(`frames/${session.org}/`)
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const object = await getObject(key)
  if (!object) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return new NextResponse(object.body, {
    headers: { "Content-Type": object.contentType, "Cache-Control": "private, max-age=86400" },
  })
}
