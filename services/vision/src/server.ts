import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import {
  VISION_PROTOCOL_VERSION,
  visionHealthResponseSchema,
  visionScanRequestSchema,
  visionScanResponseSchema,
} from "@leadshelf/api-contracts/vision/v1"
import { ReferenceSlotStubProvider, STUB_MODEL_VERSION, STUB_PROVIDER } from "./provider"

const provider = new ReferenceSlotStubProvider()
const port = Number.parseInt(process.env.PORT ?? "4010", 10)

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }
  if (chunks.length === 0) return null
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(
        res,
        200,
        visionHealthResponseSchema.parse({
          ok: true,
          provider: STUB_PROVIDER,
          modelVersion: STUB_MODEL_VERSION,
          protocolVersion: VISION_PROTOCOL_VERSION,
        }),
      )
    }

    if (req.method === "POST" && req.url === "/v1/scan") {
      const parsed = visionScanRequestSchema.safeParse(await readJson(req))
      if (!parsed.success) {
        return sendJson(res, 400, { error: "invalid_request", details: parsed.error.flatten() })
      }
      const result = await provider.scan(parsed.data)
      return sendJson(res, 200, visionScanResponseSchema.parse(result))
    }

    return sendJson(res, 404, { error: "not_found" })
  } catch (error) {
    return sendJson(res, 500, {
      error: "vision_service_error",
      message: error instanceof Error ? error.message : "unknown_error",
    })
  }
})

server.listen(port, () => {
  console.log(`LeadShelf vision service listening on :${port}`)
})
