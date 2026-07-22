import { NextResponse } from "next/server"
import { authDb } from "@/server/db/client"
import { checkReadiness } from "@/server/health/readiness"
import { checkObjectStorage } from "@/server/storage/s3"
import { configuredAuthLockoutPolicy } from "@/server/security/auth-lockout"
import { runtimeProfile } from "@/server/runtime-profile"
import { configuredProofPrivacyPolicy } from "@/server/security/proof-privacy-policy"

export const dynamic = "force-dynamic"

export async function GET() {
  const readiness = await checkReadiness({
    configuration: async () => {
      runtimeProfile()
      if (!configuredAuthLockoutPolicy()) throw new Error("authentication lockout policy is not configured")
      configuredProofPrivacyPolicy()
    },
    database: async () => {
      await authDb.$queryRaw`SELECT 1`
    },
    objectStorage: checkObjectStorage,
  })

  return NextResponse.json(readiness, {
    status: readiness.status === "ready" ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0" },
  })
}
