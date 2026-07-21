import { randomUUID } from "node:crypto"
import { authDb } from "../db/client"
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../auth/jwt"
import { verifyPassword } from "../auth/password"
import { newSessionIds, persistSession, revokeSession, rotateSession } from "../auth/session-store"

// Мобильный вход: orgSlug + employeeCode + PIN (docs/18). PIN — тот же
// Argon2id passwordHash. Токены — JSON bearer (не cookie): RN-клиенту
// нужен полный контроль хранения (secure storage).

export interface MobileDeviceInput {
  id: string // клиентский стабильный id устройства
  platform: string
  deviceName?: string
  pushToken?: string
}

export async function mobileLogin(input: {
  orgSlug: string
  employeeCode: string
  pin: string
  device: MobileDeviceInput
}) {
  const org = await authDb.organization.findFirst({
    where: { slug: { equals: input.orgSlug.trim(), mode: "insensitive" } },
    select: { id: true },
  })
  if (!org) return null

  const user = await authDb.user.findFirst({
    where: {
      organizationId: org.id,
      employeeCode: { equals: input.employeeCode.trim(), mode: "insensitive" },
      isActive: true,
    },
  })
  if (!user?.passwordHash) return null
  if (!(await verifyPassword(user.passwordHash, input.pin))) return null

  // устройство: клиентский id = PK; телефон могли передать другому сотруднику
  await authDb.mobileDevice.upsert({
    where: { id: input.device.id },
    update: {
      userId: user.id,
      platform: input.device.platform,
      deviceName: input.device.deviceName ?? null,
      pushToken: input.device.pushToken ?? null,
      lastSeenAt: new Date(),
    },
    create: {
      id: input.device.id,
      userId: user.id,
      platform: input.device.platform,
      deviceName: input.device.deviceName ?? null,
      pushToken: input.device.pushToken ?? null,
    },
  })

  const ids = newSessionIds()
  const refresh = await signRefreshToken({ sub: user.id, sid: ids.sid, jti: ids.jti })
  await persistSession({
    ids,
    organizationId: user.organizationId,
    userId: user.id,
    refreshToken: refresh,
    deviceId: input.device.id,
    userAgent: `mobile:${input.device.platform}`,
  })
  const access = await signAccessToken({
    sub: user.id,
    org: user.organizationId,
    role: user.role,
    sid: ids.sid,
    did: input.device.id,
  })
  return {
    user: { id: user.id, name: user.name, role: user.role, employeeCode: user.employeeCode },
    tokens: { access, refresh },
  }
}

export async function mobileRefresh(refreshToken: string, deviceId: string) {
  let claims
  try {
    claims = await verifyRefreshToken(refreshToken)
  } catch {
    return null
  }
  const newJti = randomUUID()
  const newRefresh = await signRefreshToken({ sub: claims.sub, sid: claims.sid, jti: newJti })
  const session = await rotateSession({
    sid: claims.sid,
    jti: claims.jti,
    presentedToken: refreshToken,
    newJti,
    newRefreshToken: newRefresh,
    requireDeviceId: deviceId,
  })
  if (!session) return null

  const user = await authDb.user.findFirst({
    where: { id: session.userId, isActive: true },
    select: { id: true, organizationId: true, role: true },
  })
  if (!user) return null

  const access = await signAccessToken({
    sub: user.id,
    org: user.organizationId,
    role: user.role,
    sid: claims.sid,
    did: deviceId,
  })
  return { access, refresh: newRefresh }
}

export async function mobileLogout(refreshToken: string | undefined) {
  if (!refreshToken) return
  try {
    const claims = await verifyRefreshToken(refreshToken)
    await revokeSession(claims.sid, "mobile logout")
  } catch {
    // нечего гасить
  }
}
