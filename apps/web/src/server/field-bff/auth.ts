import { timingSafeEqual } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { workerDb } from "@/server/db/client"

const PROVIDER = "leaddrive"
const MIN_SHARED_SECRET_LENGTH = 32

export type FieldBffSession = {
  org: string
  sub: string
  did: string
  role: string
}

type FieldPrincipal = {
  organizationSlug: string
  externalAgentId: string
  email: string | null
  name: string
  deviceId: string
  devicePlatform: string
}

type FieldBffAuthResult =
  | { ok: true; session: FieldBffSession }
  | { ok: false; response: NextResponse }

function normalizedHeader(req: NextRequest, name: string, maxLength: number): string | null {
  const value = req.headers.get(name)?.trim()
  if (!value || value.length > maxLength || /[\r\n]/.test(value)) return null
  return value
}

export function hasValidFieldBffToken(authorization: string | null, configuredSecret: string | undefined): boolean {
  if (!configuredSecret || configuredSecret.length < MIN_SHARED_SECRET_LENGTH) return false
  if (!authorization?.startsWith("Bearer ")) return false
  const supplied = authorization.slice("Bearer ".length)
  const expected = Buffer.from(configuredSecret)
  const received = Buffer.from(supplied)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export function parseFieldPrincipal(req: NextRequest): FieldPrincipal | null {
  const organizationSlug = normalizedHeader(req, "x-field-org-slug", 100)
  const externalAgentId = normalizedHeader(req, "x-field-agent-id", 128)
  const name = normalizedHeader(req, "x-field-agent-name", 200)
  const deviceId = normalizedHeader(req, "x-field-device-id", 128)
  const devicePlatform = normalizedHeader(req, "x-field-device-platform", 32) ?? "mobile"
  const emailHeader = normalizedHeader(req, "x-field-agent-email", 320)
  const email = emailHeader?.toLowerCase() ?? null

  if (!organizationSlug || !externalAgentId || !name || !deviceId) return null
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(organizationSlug)) return null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null

  return { organizationSlug, externalAgentId, email, name, deviceId, devicePlatform }
}

function denied(code: string, status: number): FieldBffAuthResult {
  return { ok: false, response: NextResponse.json({ error: code }, { status }) }
}

async function provisionFederatedUser(principal: FieldPrincipal, organizationId: string) {
  if (process.env.FIELD_BFF_AUTO_PROVISION !== "1") return null

  return workerDb.$transaction(async (tx) => {
    const concurrent = await tx.federatedIdentity.findUnique({
      where: {
        organizationId_provider_externalSubject: {
          organizationId,
          provider: PROVIDER,
          externalSubject: principal.externalAgentId,
        },
      },
      select: { user: { select: { id: true, organizationId: true, role: true, isActive: true } } },
    })
    if (concurrent) return concurrent.user

    if (principal.email) {
      const emailOwner = await tx.user.findFirst({
        where: { organizationId, email: principal.email },
        select: { id: true },
      })
      if (emailOwner) return null
    }

    const user = await tx.user.create({
      data: {
        organizationId,
        name: principal.name,
        email: principal.email,
        employeeCode: `leaddrive:${principal.externalAgentId}`,
        role: "FIELD_AGENT",
        isActive: true,
      },
      select: { id: true, organizationId: true, role: true, isActive: true },
    })
    await tx.fieldAgent.create({
      data: {
        organizationId,
        userId: user.id,
        employeeCode: principal.externalAgentId,
      },
    })
    await tx.federatedIdentity.create({
      data: {
        organizationId,
        userId: user.id,
        provider: PROVIDER,
        externalSubject: principal.externalAgentId,
      },
    })
    return user
  })
}

export async function requireFieldBffSession(req: NextRequest): Promise<FieldBffAuthResult> {
  if (!hasValidFieldBffToken(req.headers.get("authorization"), process.env.FIELD_BFF_SHARED_SECRET)) {
    return denied("field_bff_unauthorized", 401)
  }

  const principal = parseFieldPrincipal(req)
  if (!principal) return denied("field_bff_identity_invalid", 400)

  const organization = await workerDb.organization.findUnique({
    where: { slug: principal.organizationSlug },
    select: { id: true },
  })
  if (!organization) return denied("field_bff_organization_not_found", 404)

  const identity = await workerDb.federatedIdentity.findUnique({
    where: {
      organizationId_provider_externalSubject: {
        organizationId: organization.id,
        provider: PROVIDER,
        externalSubject: principal.externalAgentId,
      },
    },
    select: { user: { select: { id: true, organizationId: true, role: true, isActive: true } } },
  })
  let user = identity?.user ?? null
  if (!user) {
    try {
      user = await provisionFederatedUser(principal, organization.id)
    } catch (error) {
      if ((error as { code?: string })?.code !== "P2002") throw error
      const winner = await workerDb.federatedIdentity.findUnique({
        where: {
          organizationId_provider_externalSubject: {
            organizationId: organization.id,
            provider: PROVIDER,
            externalSubject: principal.externalAgentId,
          },
        },
        select: { user: { select: { id: true, organizationId: true, role: true, isActive: true } } },
      })
      user = winner?.user ?? null
    }
  }
  if (!user) return denied("field_bff_identity_unlinked", 403)
  if (user.organizationId !== organization.id) return denied("field_bff_identity_tenant_mismatch", 403)
  if (!user.isActive) return denied("field_bff_user_inactive", 403)

  await workerDb.mobileDevice.upsert({
    where: { id: principal.deviceId },
    update: {
      userId: user.id,
      platform: principal.devicePlatform,
      lastSeenAt: new Date(),
    },
    create: {
      id: principal.deviceId,
      userId: user.id,
      platform: principal.devicePlatform,
    },
  })

  return {
    ok: true,
    session: { org: organization.id, sub: user.id, did: principal.deviceId, role: user.role },
  }
}
