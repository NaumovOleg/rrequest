import { newId, type Collection, type KeyValue, type RequestBody, type RestRequest, type HttpMethod } from '../shared/types'

const V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

function pmUrlRaw(url: any): string {
  if (typeof url === 'string') return url
  if (url && typeof url.raw === 'string') return url.raw.split('?')[0]
  return ''
}
function pmParams(url: any): KeyValue[] {
  if (url && Array.isArray(url.query)) {
    return url.query.map((q: any) => ({ key: String(q.key ?? ''), value: String(q.value ?? ''), enabled: q.disabled !== true }))
  }
  return []
}
function pmHeaders(header: any): KeyValue[] {
  if (!Array.isArray(header)) return []
  return header.map((h: any) => ({ key: String(h.key ?? ''), value: String(h.value ?? ''), enabled: h.disabled !== true }))
}
function pmBody(body: any): RequestBody {
  if (!body || !body.mode) return { mode: 'none' }
  if (body.mode === 'raw') return { mode: 'raw', type: 'text', text: String(body.raw ?? '') }
  if (body.mode === 'urlencoded') {
    return { mode: 'urlencoded', items: (body.urlencoded ?? []).map((i: any) => ({ key: String(i.key ?? ''), value: String(i.value ?? ''), enabled: i.disabled !== true })) }
  }
  if (body.mode === 'formdata') {
    return { mode: 'formdata', items: (body.formdata ?? []).map((i: any) =>
      i.type === 'file'
        ? { kind: 'file', key: String(i.key ?? ''), filename: String(i.src ?? '').split('/').pop() ?? '', path: String(i.src ?? ''), enabled: i.disabled !== true }
        : { kind: 'text', key: String(i.key ?? ''), value: String(i.value ?? ''), enabled: i.disabled !== true }) }
  }
  return { mode: 'none' }
}

function flatten(items: any[], prefix: string, out: RestRequest[]): void {
  for (const it of items ?? []) {
    if (Array.isArray(it.item)) {
      flatten(it.item, prefix ? `${prefix} / ${it.name ?? ''}` : String(it.name ?? ''), out)
    } else if (it.request) {
      const r = it.request
      const method = (String(r.method ?? 'GET').toUpperCase()) as HttpMethod
      out.push({
        id: newId(),
        name: prefix ? `${prefix} / ${it.name ?? ''}` : String(it.name ?? 'Request'),
        method: METHODS.includes(method) ? method : 'GET',
        url: pmUrlRaw(r.url),
        params: pmParams(r.url),
        headers: pmHeaders(r.header),
        body: pmBody(r.body),
      })
    }
  }
}

export function toNative(pm: any): Collection {
  const out: RestRequest[] = []
  flatten(pm?.item ?? [], '', out)
  return { id: newId(), name: String(pm?.info?.name ?? 'Imported'), requests: out }
}

function nativeUrl(req: RestRequest): any {
  const enabled = req.params.filter((p) => p.enabled && p.key)
  const raw = enabled.length
    ? `${req.url}${req.url.includes('?') ? '&' : '?'}${enabled.map((p) => `${p.key}=${p.value}`).join('&')}`
    : req.url
  const url: any = { raw }
  if (enabled.length) url.query = enabled.map((p) => ({ key: p.key, value: p.value }))
  return url
}
function nativeBody(body: RequestBody): any {
  if (body.mode === 'raw') return { mode: 'raw', raw: body.text }
  if (body.mode === 'urlencoded') return { mode: 'urlencoded', urlencoded: body.items.map((i) => ({ key: i.key, value: i.value, disabled: !i.enabled })) }
  if (body.mode === 'formdata') return { mode: 'formdata', formdata: body.items.map((i) =>
    i.kind === 'file' ? { key: i.key, type: 'file', src: i.path, disabled: !i.enabled } : { key: i.key, type: 'text', value: i.value, disabled: !i.enabled }) }
  return undefined
}

export function fromNative(c: Collection): any {
  return {
    info: { name: c.name, schema: V21 },
    item: c.requests.map((r) => {
      const request: any = {
        method: r.method,
        header: r.headers.filter((h) => h.key).map((h) => ({ key: h.key, value: h.value })),
        url: nativeUrl(r),
      }
      const body = nativeBody(r.body)
      if (body) request.body = body
      return { name: r.name, request }
    }),
  }
}
