import * as crypto from 'node:crypto'
import type { KeyValue } from '../../shared/types'

const DYNAMIC: Record<string, () => string> = {
  '$uuid': () => crypto.randomUUID(),
  '$guid': () => crypto.randomUUID(),
  '$timestamp': () => String(Math.floor(Date.now() / 1000)),
  '$isoTimestamp': () => new Date().toISOString(),
  '$randomInt': () => String(crypto.randomInt(1000, 10000)),
  '$randomHex': () => crypto.randomBytes(8).toString('hex'),
}

export function interpolate(text: string, vars: KeyValue[]): string {
  const map = new Map<string, string>()
  for (const v of vars) if (v.enabled && v.key) map.set(v.key, v.value)
  return text.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (whole, key: string) => {
    const hit = map.get(key)
    if (hit !== undefined) return hit
    const fn = DYNAMIC[key]
    return fn ? fn() : whole
  })
}
