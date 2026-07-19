export const LEGACY_DATABASE_NAME = "leadshelf.db"
export const ENCRYPTED_DATABASE_NAME = "leadshelf-secure.db"
export const DATABASE_KEY_NAME = "ls.sqlite.key.v1"
export const ENCRYPTION_MARKER_TABLE = "__leadshelf_encryption"

export type EncryptedDatabaseBootstrapPlan =
  | "create-encrypted"
  | "migrate-legacy"
  | "open-encrypted"
  | "missing-key"

export function encryptedDatabaseBootstrapPlan(input: {
  encryptedDatabaseExists: boolean
  legacyDatabaseExists: boolean
  keyExists: boolean
}): EncryptedDatabaseBootstrapPlan {
  if (input.encryptedDatabaseExists && !input.keyExists) return "missing-key"
  if (input.encryptedDatabaseExists) return "open-encrypted"
  if (input.legacyDatabaseExists) return "migrate-legacy"
  return "create-encrypted"
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function normalizeSqlCipherKey(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f\d]{64}$/.test(normalized)) {
    throw new Error("[mobile-db] invalid SQLCipher key material")
  }
  return normalized
}

export function sqlCipherKeyLiteral(key: string): string {
  return `"x'${normalizeSqlCipherKey(key)}'"`
}

export function quoteSqliteString(value: string): string {
  if (value.includes("\0")) throw new Error("[mobile-db] database path contains NUL")
  return `'${value.replaceAll("'", "''")}'`
}

export function quoteSqliteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error("[mobile-db] unsafe SQLite identifier")
  }
  return `"${value}"`
}

export function buildEncryptedAttachSql(databasePath: string, key: string): string {
  return `ATTACH DATABASE ${quoteSqliteString(databasePath)} AS encrypted KEY ${sqlCipherKeyLiteral(key)};`
}
