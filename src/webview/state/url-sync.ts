import type { KeyValue } from '../../shared/types'

export function buildUrlFromParams(baseUrl: string, params: KeyValue[]): string {
  const enabled = params.filter((p) => p.enabled && p.key)
  if (enabled.length === 0) return baseUrl
  const qs = enabled
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&')
  return baseUrl.includes('?') ? `${baseUrl}&${qs}` : `${baseUrl}?${qs}`
}

export function parseParamsFromUrl(url: string): { base: string; params: KeyValue[] } {
  const i = url.indexOf('?')
  if (i < 0) return { base: url, params: [] }
  const base = url.slice(0, i)
  const params: KeyValue[] = []
  for (const pair of url.slice(i + 1).split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq))
    const value = eq < 0 ? '' : decodeURIComponent(pair.slice(eq + 1))
    params.push({ key, value, enabled: true })
  }
  return { base, params }
}
