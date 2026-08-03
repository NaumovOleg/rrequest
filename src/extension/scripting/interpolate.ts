import type { KeyValue } from '../../shared/types'

export function interpolate(text: string, vars: KeyValue[]): string {
  const map = new Map<string, string>()
  for (const v of vars) if (v.enabled && v.key) map.set(v.key, v.value)
  return text.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (whole, key: string) => {
    const hit = map.get(key)
    return hit === undefined ? whole : hit
  })
}
