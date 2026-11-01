import type { PrismaClient } from "@leadshelf/prisma-client"
import {
  claimPendingNotificationDeliveries,
  markNotificationDeliveryFailed,
  markNotificationDeliverySent,
  type NotificationDeliveryJob,
} from "@leadshelf/db"

export interface PushSendResult {
  ok: boolean
  providerId?: string | null
  error?: string | null
}

export interface PushSender {
  send(job: NotificationDeliveryJob): Promise<PushSendResult>
}

export function notificationRetryDelayMs(attempts: number, baseMs = 5_000, maxMs = 5 * 60_000): number {
  return Math.min(Math.max(1_000, maxMs), Math.max(1_000, baseMs) * 2 ** Math.max(0, attempts - 1))
}

function permanentPushError(error: string | null | undefined): boolean {
  return Boolean(error && /DeviceNotRegistered|invalid.*token/i.test(error))
}

function boundedInteger(value: number, fallback: number, min: number, max: number): number {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

export class ExpoPushSender implements PushSender {
  constructor(private readonly endpoint = "https://exp.host/--/api/v2/push/send") {}

  async send(job: NotificationDeliveryJob): Promise<PushSendResult> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: job.pushToken,
        title: job.title,
        body: job.body,
        data: job.payload ?? {},
      }),
    })
    const body = (await res.json().catch(() => null)) as ExpoPushResponse | null
    if (!res.ok) {
      return { ok: false, error: body?.errors?.[0]?.message ?? `expo_http_${res.status}` }
    }
    const ticket = Array.isArray(body?.data) ? body.data[0] : body?.data
    if (ticket?.status === "ok") return { ok: true, providerId: ticket.id ?? null }
    return { ok: false, error: ticket?.message ?? ticket?.details?.error ?? "expo_rejected" }
  }
}

interface ExpoPushResponse {
  data?: ExpoPushTicket | ExpoPushTicket[]
  errors?: Array<{ message?: string }>
}

interface ExpoPushTicket {
  status?: "ok" | "error"
  id?: string
  message?: string
  details?: { error?: string }
}

export async function processPendingNotificationDeliveries(
  prisma: PrismaClient,
  organizationId: string,
  input: {
    limit?: number
    sender?: PushSender
    now?: Date
    maxAttempts?: number
    retryBaseMs?: number
    retryMaxMs?: number
    staleAfterMs?: number
  } = {},
): Promise<{ claimed: number; sent: number; retried: number; failed: number }> {
  const sender = input.sender ?? new ExpoPushSender()
  const now = input.now ?? new Date()
  const maxAttempts = boundedInteger(
    input.maxAttempts ?? Number(process.env.LEADSHELF_NOTIFICATION_MAX_ATTEMPTS ?? 3),
    3,
    1,
    20,
  )
  const jobs = await claimPendingNotificationDeliveries(prisma, organizationId, {
    limit: input.limit,
    now,
    maxAttempts,
    staleAfterMs: boundedInteger(
      input.staleAfterMs ?? Number(process.env.LEADSHELF_NOTIFICATION_STALE_MS ?? 15 * 60_000),
      15 * 60_000,
      60_000,
      24 * 60 * 60_000,
    ),
  })
  let sent = 0
  let retried = 0
  let failed = 0

  const markFailure = async (job: NotificationDeliveryJob, error?: string | null) => {
    const willRetry = job.attempts < maxAttempts && !permanentPushError(error)
    const retryAt = willRetry
      ? new Date(now.getTime() + notificationRetryDelayMs(
          job.attempts,
          boundedInteger(input.retryBaseMs ?? Number(process.env.LEADSHELF_NOTIFICATION_RETRY_MS ?? 5_000), 5_000, 1_000, 60 * 60_000),
          boundedInteger(input.retryMaxMs ?? Number(process.env.LEADSHELF_NOTIFICATION_RETRY_MAX_MS ?? 5 * 60_000), 5 * 60_000, 1_000, 24 * 60 * 60_000),
        ))
      : null
    if (await markNotificationDeliveryFailed(prisma, organizationId, job.id, { error, retryAt, failedAt: now })) {
      if (willRetry) retried += 1
      else failed += 1
    }
  }

  for (const job of jobs) {
    try {
      const result = await sender.send(job)
      if (result.ok) {
        if (await markNotificationDeliverySent(prisma, organizationId, job.id, { sentAt: now })) sent += 1
      } else {
        await markFailure(job, result.error)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await markFailure(job, message)
    }
  }

  return { claimed: jobs.length, sent, retried, failed }
}

export async function processPendingNotificationsForAllOrganizations(
  prisma: PrismaClient,
  input: { limitPerOrg?: number; organizationLimit?: number; sender?: PushSender } = {},
): Promise<{ organizations: number; claimed: number; sent: number; retried: number; failed: number }> {
  const orgs = await prisma.notificationDelivery.findMany({
    where: { status: { in: ["PENDING", "SENDING"] } },
    distinct: ["organizationId"],
    select: { organizationId: true },
    orderBy: { createdAt: "asc" },
    take: input.organizationLimit ?? 100,
  })
  let claimed = 0
  let sent = 0
  let retried = 0
  let failed = 0

  for (const org of orgs) {
    const result = await processPendingNotificationDeliveries(prisma, org.organizationId, {
      limit: input.limitPerOrg,
      sender: input.sender,
    })
    claimed += result.claimed
    sent += result.sent
    retried += result.retried
    failed += result.failed
  }

  return { organizations: orgs.length, claimed, sent, retried, failed }
}
