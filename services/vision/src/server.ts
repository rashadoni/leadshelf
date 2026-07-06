import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { pathToFileURL } from "node:url"
import {
  VISION_PROTOCOL_VERSION,
  visionHealthResponseSchema,
  visionScanRequestSchema,
  visionScanResponseSchema,
} from "@leadshelf/api-contracts/vision/v1"
import { createConfiguredVisionProvider, type VisionProvider } from "./provider"

const provider = createConfiguredVisionProvider()
const port = Number.parseInt(process.env.PORT ?? "4010", 10)

export type VisionHttpResult = {
  status: number
  body: unknown
}

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

export async function handleVisionHttpRequest(input: {
  method: string | undefined
  url: string | undefined
  body: unknown
  provider?: VisionProvider
}): Promise<VisionHttpResult> {
  if (input.method === "GET" && input.url === "/health") {
    const activeProvider = input.provider ?? provider
    return {
      status: 200,
      body: visionHealthResponseSchema.parse({
        ok: true,
        provider: activeProvider.metadata.provider,
        modelVersion: activeProvider.metadata.modelVersion,
        protocolVersion: VISION_PROTOCOL_VERSION,
      }),
    }
  }

  if (input.method === "POST" && input.url === "/v1/scan") {
    const parsed = visionScanRequestSchema.safeParse(input.body)
    if (!parsed.success) {
      return {
        status: 400,
        body: { error: "invalid_request", details: parsed.error.flatten() },
      }
    }
    const result = await (input.provider ?? provider).scan(parsed.data)
    return { status: 200, body: visionScanResponseSchema.parse(result) }
  }

  return { status: 404, body: { error: "not_found" } }
}

export function createVisionServer(visionProvider: VisionProvider = provider) {
  return createServer(async (req, res) => {
    try {
      const body = req.method === "POST" ? await readJson(req) : null
      const result = await handleVisionHttpRequest({
        method: req.method,
        url: req.url,
        body,
        provider: visionProvider,
      })
      return sendJson(res, result.status, result.body)
    } catch (error) {
      return sendJson(res, 500, {
        error: "vision_service_error",
        message: error instanceof Error ? error.message : "unknown_error",
      })
    }
  })
}

function isMainModule(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false
}

if (isMainModule()) {
  const server = createVisionServer()
  server.listen(port, () => {
    console.log(`LeadShelf vision service listening on :${port}`)
  })
}
