// OpenAPI 3.x <-> native Collection conversion (best-effort, practical subset).
//
// Export builds paths from each request's URL (method + path), lifting query
// params and non-default headers into `parameters`, and the body into
// `requestBody`. Folders become tags. Import does the reverse: each path+method
// operation becomes a request, grouped into folders by its first tag.
import {
  newId,
  defaultHeaders,
  type Collection,
  type Folder,
  type HttpMethod,
  type KeyValue,
  type RestRequest,
  type RequestBody,
} from '../shared/types'

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

const isHttp = (r: { kind?: string }): boolean => !r.kind || r.kind === 'http'
const opId = (name: string): string => name.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'op'

/** Split a URL into base (scheme+host) and path, tolerant of `{{vars}}`. */
function splitUrl(url: string): { base: string; path: string } {
  const noQuery = (url || '').split('?')[0]
  const m = noQuery.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]+)(\/.*)?$/i)
  if (m) return { base: m[1], path: m[2] || '/' }
  return { base: '', path: noQuery.startsWith('/') ? noQuery : '/' + (noQuery || '') }
}

function allHttpRequests(c: Collection): { req: RestRequest; folder?: string }[] {
  const out: { req: RestRequest; folder?: string }[] = []
  for (const r of c.requests) if (isHttp(r)) out.push({ req: r as RestRequest })
  for (const f of c.folders ?? []) for (const r of f.requests) if (isHttp(r)) out.push({ req: r as RestRequest, folder: f.name })
  return out
}

// ==================== Export: Collection -> OpenAPI ====================

function openApiBody(body: RequestBody): unknown | undefined {
  if (body.mode === 'raw') {
    const ct = body.type === 'json' ? 'application/json' : body.type === 'xml' ? 'application/xml' : 'text/plain'
    let example: unknown = body.text
    if (body.type === 'json') { try { example = JSON.parse(body.text) } catch { /* keep the raw string */ } }
    return { content: { [ct]: { example } } }
  }
  if (body.mode === 'urlencoded' || body.mode === 'formdata') {
    const props: Record<string, unknown> = {}
    for (const i of body.items) if (i.enabled && i.key) props[i.key] = { type: 'string' }
    const ct = body.mode === 'urlencoded' ? 'application/x-www-form-urlencoded' : 'multipart/form-data'
    return { content: { [ct]: { schema: { type: 'object', properties: props } } } }
  }
  if (body.mode === 'graphql') {
    return { content: { 'application/json': { example: { query: body.query, variables: safeJson(body.variables) } } } }
  }
  return undefined
}

function safeJson(s: string): unknown { try { return JSON.parse(s) } catch { return s } }

export function toOpenApi(c: Collection): unknown {
  const paths: Record<string, Record<string, unknown>> = {}
  const servers = new Set<string>()
  for (const { req, folder } of allHttpRequests(c)) {
    const { base, path } = splitUrl(req.url)
    if (base) servers.add(base)
    const op: Record<string, unknown> = {
      summary: req.name,
      operationId: opId(req.name),
      responses: { '200': { description: 'OK' } },
    }
    if (folder) op.tags = [folder]
    const parameters: unknown[] = []
    for (const p of req.params) if (p.enabled && p.key) parameters.push({ name: p.key, in: 'query', required: false, schema: { type: 'string' }, ...(p.value ? { example: p.value } : {}) })
    for (const h of req.headers) if (h.enabled && h.key && h.key.toLowerCase() !== 'content-type') parameters.push({ name: h.key, in: 'header', required: false, schema: { type: 'string' }, ...(h.value ? { example: h.value } : {}) })
    if (parameters.length) op.parameters = parameters
    const rb = openApiBody(req.body)
    if (rb) op.requestBody = rb
    paths[path] = paths[path] || {}
    paths[path][req.method.toLowerCase()] = op
  }
  const doc: Record<string, unknown> = {
    openapi: '3.0.3',
    info: { title: c.name || 'RREQUEST Collection', version: '1.0.0' },
    paths,
  }
  if (servers.size) doc.servers = [...servers].map((url) => ({ url }))
  return doc
}

// ==================== Import: OpenAPI -> Collection ====================

function sampleForType(t: unknown): unknown {
  return t === 'number' || t === 'integer' ? 0 : t === 'boolean' ? false : t === 'array' ? [] : ''
}
function exampleFromSchema(schema: any): unknown {
  if (!schema) return undefined
  if (schema.example !== undefined) return schema.example
  if (schema.type === 'object' && schema.properties) {
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(schema.properties)) o[k] = exampleFromSchema(schema.properties[k]) ?? sampleForType(schema.properties[k]?.type)
    return o
  }
  return sampleForType(schema.type)
}

function bodyFromOpenApi(rb: any): RequestBody {
  const content = rb?.content
  if (!content) return { mode: 'none' }
  if (content['application/json']) {
    const ex = content['application/json'].example ?? exampleFromSchema(content['application/json'].schema)
    return { mode: 'raw', type: 'json', text: ex != null ? JSON.stringify(ex, null, 2) : '' }
  }
  if (content['application/xml']) return { mode: 'raw', type: 'xml', text: String(content['application/xml'].example ?? '') }
  if (content['text/plain']) return { mode: 'raw', type: 'text', text: String(content['text/plain'].example ?? '') }
  if (content['application/x-www-form-urlencoded']) {
    const props = content['application/x-www-form-urlencoded'].schema?.properties ?? {}
    return { mode: 'urlencoded', items: Object.keys(props).map((k) => ({ key: k, value: '', enabled: true })) }
  }
  return { mode: 'none' }
}

function operationToRequest(method: string, path: string, op: any, server: string): RestRequest {
  const params: KeyValue[] = []
  const headers: KeyValue[] = []
  for (const p of op.parameters ?? []) {
    const kv: KeyValue = { key: String(p.name ?? ''), value: p.example != null ? String(p.example) : '', enabled: true }
    if (p.in === 'query') params.push(kv)
    else if (p.in === 'header') headers.push(kv)
  }
  return {
    id: newId(),
    name: op.summary || op.operationId || `${method.toUpperCase()} ${path}`,
    method: method.toUpperCase() as HttpMethod,
    url: server + path,
    params,
    headers: headers.length ? headers : defaultHeaders(),
    body: bodyFromOpenApi(op.requestBody),
    preRequestScript: '',
    testScript: '',
  }
}

export function isOpenApi(parsed: any): boolean {
  return !!parsed && (typeof parsed.openapi === 'string' || typeof parsed.swagger === 'string') && typeof parsed.paths === 'object'
}

export function fromOpenApi(doc: any, workspaceId = ''): Collection {
  const title = doc?.info?.title || 'Imported API'
  const server = String(doc?.servers?.[0]?.url ?? '').replace(/\/$/, '')
  const foldersByTag = new Map<string, Folder>()
  const rootRequests: RestRequest[] = []
  const paths = doc?.paths ?? {}
  for (const path of Object.keys(paths)) {
    const pathItem = paths[path] ?? {}
    for (const method of HTTP_METHODS) {
      const op = pathItem[method]
      if (!op) continue
      const req = operationToRequest(method, path, op, server)
      const tag = Array.isArray(op.tags) && op.tags[0] ? String(op.tags[0]) : undefined
      if (tag) {
        let f = foldersByTag.get(tag)
        if (!f) { f = { id: newId(), name: tag, requests: [] }; foldersByTag.set(tag, f) }
        f.requests.push(req)
      } else {
        rootRequests.push(req)
      }
    }
  }
  return { id: newId(), name: title, workspaceId, requests: rootRequests, folders: [...foldersByTag.values()] }
}
