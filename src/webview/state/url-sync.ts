import type { KeyValue } from '../../shared/types'

export function buildUrlFromParams(baseUrl: string, params: KeyValue[]): string {
  const enabled = params.filter((p) => p.enabled && p.key)
  if (enabled.length === 0) return baseUrl
  const qs = enabled
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&')
  return baseUrl.includes('?') ? `${baseUrl}&${qs}` : `${baseUrl}?${qs}`
}

// Make a request's `url` and `params` agree when it's opened, so the URL bar
// shows the query on the FIRST render (not only after the user edits a param).
// A saved request can be one-sided: params filled but url has no query (rebuild
// the url), or url has a query but params empty (parse them back).
export function reconcileUrlParams(url: string, params: KeyValue[]): { url: string; params: KeyValue[] } {
  const hasQuery = url.includes('?')
  const enabled = (params ?? []).filter((p) => p.enabled && p.key)
  if (!hasQuery && enabled.length > 0) {
    return { url: buildUrlFromParams(url, params), params }
  }
  if (hasQuery && (params ?? []).length === 0) {
    const parsed = parseParamsFromUrl(url)
    return { url, params: parsed.params }
  }
  return { url, params: params ?? [] }
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
