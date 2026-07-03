import { NextResponse } from "next/server"
import { MOBILE_PROTOCOL_VERSION } from "@/server/mobile/protocol"

export function GET() {
  return NextResponse.json({ protocolVersion: MOBILE_PROTOCOL_VERSION })
}
