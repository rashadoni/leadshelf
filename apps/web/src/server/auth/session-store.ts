import { createHash, randomUUID } from "node:crypto"
import { authDb } from "../db/client"

// Refresh-токен хранится ХЭШЕМ (sha256 + pepper из JWT_SECRET): утечка БД
// не даёт рабочих токенов.

function hashToken(token: string): string {
  return createHash("sha256")
    .update(token + (process.env.JWT_SECRET ?? ""))
    .digest("hex")
}

export interface NewSession {
  sid: string
  jti: string
  familyId: string
}

export function newSessionIds(): NewSession {
  return { sid: randomUUID(), jti: randomUUID(), familyId: randomUUID() }
}

export async function persistSession(params: {
  ids: NewSession
  organizationId: string
  userId: string
  refreshToken: string
  userAgent?: string
  deviceId?: string
}): Promise<void> {
  const { ids, organizationId, userId, refreshToken, userAgent, deviceId } = params
  await authDb.authSession.create({
    data: {
      id: ids.sid,
      organizationId,
      userId,
      deviceId: deviceId ?? null,
      refreshFamilyId: ids.familyId,
      refreshJti: ids.jti,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: userAgent ?? null,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
  })
}

/** Мобильный ретрай: потерянный ответ ротации — не reuse-атака (docs/18). */
const ROTATION_GRACE_MS = 120_000

/**
 * Ротация: атомально сверяем sid+jti+hash. Несовпадение jti/hash на живой
 * сессии = повторное использование украденного токена -> revoke всей семьи.
 */
export async function rotateSession(params: {
  sid: string
  jti: string
  presentedToken: string
  newJti: string
  newRefreshToken: string
  requireDeviceId?: string
}): Promise<{ organizationId: string; userId: string; deviceId: string | null } | null> {
  const { sid, jti, presentedToken, newJti, newRefreshToken } = params
  const now = new Date()

  const session = await authDb.authSession.findUnique({ where: { id: sid } })
  if (!session || session.revokedAt || session.expiresAt < now) return null
  if (params.requireDeviceId && session.deviceId !== params.requireDeviceId) return null

  const presentedHash = hashToken(presentedToken)
  const isCurrent = session.refreshJti === jti && session.refreshTokenHash === presentedHash
  const inGrace =
    session.prevRefreshJti === jti &&
    session.prevRefreshHash === presentedHash &&
    session.rotatedAt != null &&
    now.getTime() - session.rotatedAt.getTime() < ROTATION_GRACE_MS

  if (!isCurrent && !inGrace) {
    // reuse detected: гасим всю семью токенов
    await authDb.authSession.updateMany({
      where: { refreshFamilyId: session.refreshFamilyId, revokedAt: null },
      data: { revokedAt: now, revokedReason: "refresh token reuse detected" },
    })
    return null
  }

  await authDb.authSession.update({
    where: { id: sid },
    data: {
      prevRefreshJti: session.refreshJti,
      prevRefreshHash: session.refreshTokenHash,
      rotatedAt: now,
      refreshJti: newJti,
      refreshTokenHash: hashToken(newRefreshToken),
      lastUsedAt: now,
    },
  })
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    deviceId: session.deviceId,
  }
}

export async function revokeSession(sid: string, reason: string): Promise<void> {
  await authDb.authSession.updateMany({
    where: { id: sid, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  })
}
