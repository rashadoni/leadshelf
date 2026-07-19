import { authDb } from "../db/client"
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../auth/jwt"
import { verifyPassword } from "../auth/password"
import {
  newSessionIds,
  persistSession,
  revokeSession,
  rotateSession,
} from "../auth/session-store"
import { randomUUID } from "node:crypto"

export interface TokenPair {
  access: string
  refresh: string
}

export interface AuthenticatedUser {
  id: string
  organizationId: string
  email: string | null
  name: string
  role: string
}

/**
 * Office login is tenant-qualified. User.email is unique only inside an
 * organization, therefore a global findFirst(email) would authenticate an
 * arbitrary tenant when the same address exists in more than one organization.
 */
export async function login(
  organizationSlug: string,
  email: string,
  password: string,
  userAgent?: string,
): Promise<{ user: AuthenticatedUser; tokens: TokenPair } | null> {
  const user = await authDb.user.findFirst({
    where: {
      organization: {
        slug: { equals: organizationSlug.trim(), mode: "insensitive" },
      },
      email: { equals: email.trim(), mode: "insensitive" },
      isActive: true,
    },
  })
  if (!user?.passwordHash) return null
  if (!(await verifyPassword(user.passwordHash, password))) return null

  const ids = newSessionIds()
  const refresh = await signRefreshToken({ sub: user.id, sid: ids.sid, jti: ids.jti })
  await persistSession({
    ids,
    organizationId: user.organizationId,
    userId: user.id,
    refreshToken: refresh,
    userAgent,
  })
  const access = await signAccessToken({
    sub: user.id,
    org: user.organizationId,
    role: user.role,
    sid: ids.sid,
  })
  return {
    user: {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    tokens: { access, refresh },
  }
}

export async function refresh(refreshToken: string): Promise<TokenPair | null> {
  let claims
  try {
    claims = await verifyRefreshToken(refreshToken)
  } catch {
    return null
  }
  const newJti = randomUUID()
  const newRefresh = await signRefreshToken({
    sub: claims.sub,
    sid: claims.sid,
    jti: newJti,
  })
  const session = await rotateSession({
    sid: claims.sid,
    jti: claims.jti,
    presentedToken: refreshToken,
    newJti,
    newRefreshToken: newRefresh,
  })
  if (!session) return null

  const user = await authDb.user.findFirst({
    where: { id: session.userId, isActive: true },
  })
  if (!user) return null

  const access = await signAccessToken({
    sub: user.id,
    org: user.organizationId,
    role: user.role,
    sid: claims.sid,
  })
  return { access, refresh: newRefresh }
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return
  try {
    const claims = await verifyRefreshToken(refreshToken)
    await revokeSession(claims.sid, "logout")
  } catch {
    // невалидный токен — выходить не из чего
  }
}
