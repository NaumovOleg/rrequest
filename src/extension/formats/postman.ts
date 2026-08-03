import { newId, itemKind, type Collection, type CollectionItem, type Folder, type KeyValue, type RequestBody, type RestRequest, type HttpMethod } from '../../shared/types'

// Postman v2.1 export covers HTTP requests only; gRPC/WebSocket items are skipped.
const httpOnly = (rs: CollectionItem[]): RestRequest[] => rs.filter((r): r is RestRequest => itemKind(r) === 'http')

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

function pmRequestToNative(it: any): RestRequest {
  const r = it.request
  const method = (String(r.method ?? 'GET').toUpperCase()) as HttpMethod
  return {
    id: newId(),
    name: String(it.name ?? 'Request'),
    method: METHODS.includes(method) ? method : 'GET',
    url: pmUrlRaw(r.url),
    params: pmParams(r.url),
    headers: pmHeaders(r.header),
    body: pmBody(r.body),
  }
}

function collectRequests(items: any[], out: RestRequest[]): void {
  for (const it of items ?? []) {
    if (Array.isArray(it.item)) {
      collectRequests(it.item, out)
    } else if (it.request) {
      out.push(pmRequestToNative(it))
    }
  }
}

export function toNative(pm: any): Collection {
  const rootReqs: RestRequest[] = []
  const folders: Folder[] = []
  for (const it of pm?.item ?? []) {
    if (Array.isArray(it.item)) {
      const fReqs: RestRequest[] = []
      collectRequests(it.item, fReqs)
      folders.push({ id: newId(), name: String(it.name ?? 'Folder'), requests: fReqs })
    } else if (it.request) {
      rootReqs.push(pmRequestToNative(it))
    }
  }
  return { id: newId(), name: String(pm?.info?.name ?? 'Imported'), workspaceId: '', requests: rootReqs, folders }
}

function nativeUrl(req: RestRequest): any {
  const enabled = req.params.filter((p) => p.enabled && p.key)
  const all = req.params.filter((p) => p.key)
  const raw = enabled.length
    ? `${req.url}${req.url.includes('?') ? '&' : '?'}${enabled.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&')}`
    : req.url
  const url: any = { raw }
  if (all.length) url.query = all.map((p) => ({ key: p.key, value: p.value, disabled: !p.enabled }))
  return url
}
function nativeBody(body: RequestBody): any {
  if (body.mode === 'raw') return { mode: 'raw', raw: body.text }
  if (body.mode === 'urlencoded') return { mode: 'urlencoded', urlencoded: body.items.map((i) => ({ key: i.key, value: i.value, disabled: !i.enabled })) }
  if (body.mode === 'formdata') return { mode: 'formdata', formdata: body.items.map((i) =>
    i.kind === 'file' ? { key: i.key, type: 'file', src: i.path, disabled: !i.enabled } : { key: i.key, type: 'text', value: i.value, disabled: !i.enabled }) }
  return undefined
}

function nativeRequestItem(r: RestRequest): any {
  const request: any = {
    method: r.method,
    header: r.headers.filter((h) => h.key).map((h) => ({ key: h.key, value: h.value, disabled: !h.enabled })),
    url: nativeUrl(r),
  }
  const body = nativeBody(r.body)
  if (body) request.body = body
  return { name: r.name, request }
}

export function fromNative(c: Collection): any {
  const item: any[] = httpOnly(c.requests).map(nativeRequestItem)
  for (const f of c.folders ?? []) {
    item.push({ name: f.name, item: httpOnly(f.requests).map(nativeRequestItem) })
  }
  return { info: { name: c.name, schema: V21 }, item }
}
