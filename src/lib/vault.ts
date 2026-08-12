/**
 * Browser-side key vault. The Linear API key is encrypted with AES-GCM under
 * a **non-extractable** CryptoKey that lives only in this origin's IndexedDB —
 * the key material can never be read out, only used, so the token is not
 * recoverable by inspecting storage. It is decrypted into memory per session
 * and sent to exactly one place: https://api.linear.app/graphql.
 */
import { kvDel, kvGet, kvSet } from './idb'

const KEY_SLOT = 'vault.key'
const TOKEN_SLOT = 'vault.token'

interface TokenRecord {
  iv: Uint8Array<ArrayBuffer>
  ct: ArrayBuffer
}

async function aesKey(createIfMissing: boolean): Promise<CryptoKey | null> {
  const existing = await kvGet<CryptoKey>(KEY_SLOT)
  if (existing) return existing
  if (!createIfMissing) return null
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  await kvSet(KEY_SLOT, key)
  return key
}

export async function saveToken(token: string): Promise<void> {
  const key = (await aesKey(true))!
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(token),
  )
  await kvSet(TOKEN_SLOT, { iv, ct } satisfies TokenRecord)
}

export async function loadToken(): Promise<string | null> {
  const key = await aesKey(false)
  const rec = await kvGet<TokenRecord>(TOKEN_SLOT)
  if (!key || !rec) return null
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.ct)
    return new TextDecoder().decode(pt)
  } catch {
    return null
  }
}

export async function clearToken(): Promise<void> {
  await kvDel(TOKEN_SLOT)
  await kvDel(KEY_SLOT)
}
