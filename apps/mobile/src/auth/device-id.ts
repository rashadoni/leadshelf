import * as Crypto from "expo-crypto"
import { tokenStore } from "./token-store"

/** Стабильный клиентский id устройства: генерится раз, живет в SecureStore. */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await tokenStore.getDeviceId()
  if (existing) return existing
  const id = `dev-${Crypto.randomUUID()}`
  await tokenStore.setDeviceId(id)
  return id
}
