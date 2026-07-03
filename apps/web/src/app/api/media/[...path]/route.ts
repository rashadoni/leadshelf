import { NextResponse, type NextRequest } from "next/server"
import { requireApiSession, unauthorized } from "@/server/http/api-guard"
import { getObject } from "@/server/storage/s3"

export const runtime = "nodejs"

// Media-proxy: бакет наружу не торчит (docs/12), файлы отдает приложение.
// КРИТИЧНО: ключ обязан начинаться с products/{org сессии}/ — иначе один
// тенант читал бы фото другого по прямой ссылке.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const session = await requireApiSession(req)
  if (!session) return unauthorized()

  const { path } = await params
  const key = path.join("/")
  if (!key.startsWith(`products/${session.org}/`)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const object = await getObject(key)
  if (!object) return NextResponse.json({ error: "not_found" }, { status: 404 })

  return new NextResponse(object.body, {
    headers: {
      "Content-Type": object.contentType,
      "Cache-Control": "private, max-age=86400",
    },
  })
}
