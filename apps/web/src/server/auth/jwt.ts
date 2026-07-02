import { SignJWT, jwtVerify } from "jose"

// jose: Edge-совместим (WebCrypto) — единственная auth-библиотека,
// которой можно пользоваться в middleware.

const encoder = new TextEncoder()

function secret(): Uint8Array {
  const s = process.env.JWT_SECRET
  if (!s || s === "change-me") {
    throw new Error("JWT_SECRET не задан (apps/web/.env)")
  }
  return encoder.encode(s)
}

export interface AccessClaims {
  sub: string // userId
  org: string // organizationId
  role: string
  sid: string // AuthSession.id
}

export interface RefreshClaims {
  sub: string
  sid: string
  jti: string
}

export async function signAccessToken(c: AccessClaims): Promise<string> {
  return new SignJWT({ typ: "access", org: c.org, role: c.role, sid: c.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.sub)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret())
}

export async function signRefreshToken(c: RefreshClaims): Promise<string> {
  return new SignJWT({ typ: "refresh", sid: c.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(c.sub)
    .setJti(c.jti)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret())
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, secret())
  if (payload.typ !== "access" || !payload.sub) throw new Error("not an access token")
  return {
    sub: payload.sub,
    org: payload.org as string,
    role: payload.role as string,
    sid: payload.sid as string,
  }
}

export async function verifyRefreshToken(token: string): Promise<RefreshClaims> {
  const { payload } = await jwtVerify(token, secret())
  if (payload.typ !== "refresh" || !payload.sub || !payload.jti) {
    throw new Error("not a refresh token")
  }
  return { sub: payload.sub, sid: payload.sid as string, jti: payload.jti }
}
