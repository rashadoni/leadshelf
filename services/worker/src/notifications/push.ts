import type { PrismaClient } from "@prisma/client"
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
  input: { limit?: number; sender?: PushSender } = {},
): Promise<{ claimed: number; sent: number; failed: number }> {
  const sender = input.sender ?? new ExpoPushSender()
  const jobs = await claimPendingNotificationDeliveries(prisma, organizationId, { limit: input.limit })
  let sent = 0
  let failed = 0

  for (const job of jobs) {
    try {
      const result = await sender.send(job)
      if (result.ok) {
        if (await markNotificationDeliverySent(prisma, organizationId, job.id)) sent += 1
      } else {
        if (await markNotificationDeliveryFailed(prisma, organizationId, job.id, { error: result.error })) {
          failed += 1
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (await markNotificationDeliveryFailed(prisma, organizationId, job.id, { error: message })) {
        failed += 1
      }
    }
  }

  return { claimed: jobs.length, sent, failed }
}

export async function processPendingNotificationsForAllOrganizations(
  prisma: PrismaClient,
  input: { limitPerOrg?: number; organizationLimit?: number; sender?: PushSender } = {},
): Promise<{ organizations: number; claimed: number; sent: number; failed: number }> {
  const orgs = await prisma.notificationDelivery.findMany({
    where: { status: "PENDING" },
    distinct: ["organizationId"],
    select: { organizationId: true },
    orderBy: { createdAt: "asc" },
    take: input.organizationLimit ?? 100,
  })
  let claimed = 0
  let sent = 0
  let failed = 0

  for (const org of orgs) {
    const result = await processPendingNotificationDeliveries(prisma, org.organizationId, {
      limit: input.limitPerOrg,
      sender: input.sender,
    })
    claimed += result.claimed
    sent += result.sent
    failed += result.failed
  }

  return { organizations: orgs.length, claimed, sent, failed }
}
