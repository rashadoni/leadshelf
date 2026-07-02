import { hash, verify } from "@node-rs/argon2"

// Argon2id, параметры по OWASP-минимуму (19 MiB, t=2, p=1).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTS)
}

export function verifyPassword(hashed: string, password: string): Promise<boolean> {
  return verify(hashed, password).catch(() => false)
}
