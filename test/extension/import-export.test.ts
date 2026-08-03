import { describe, it, expect } from 'vitest'
import { detectFormat, parseImport, serializeExport } from '../../src/extension/formats/import-export'
import type { Collection } from '../../src/shared/types'

const native: Collection = { id: 'c1', name: 'N', workspaceId: '', requests: [
  { id: 'r', name: 'x', method: 'GET', url: 'https://a/x', params: [], headers: [], body: { mode: 'none' } },
] }
const pm = { info: { name: 'P', schema: 'v2.1.0' }, item: [{ name: 'x', request: { method: 'GET', url: { raw: 'https://a/x' }, header: [] } }] }

describe('detectFormat', () => {
  it('detects postman by schema/item', () => { expect(detectFormat(pm)).toBe('postman') })
  it('detects native by id+requests', () => { expect(detectFormat(native)).toBe('native') })
  it('returns null for garbage', () => { expect(detectFormat({ nope: 1 })).toBeNull() })
})

describe('parseImport', () => {
  it('imports native JSON as-is', () => {
    const c = parseImport(JSON.stringify(native))
    expect(c.name).toBe('N'); expect((c.requests[0] as any).url).toBe('https://a/x')
  })
  it('imports postman JSON via converter', () => {
    const c = parseImport(JSON.stringify(pm))
    expect(c.name).toBe('P'); expect((c.requests[0] as any).method).toBe('GET')
  })
  it('throws on garbage', () => {
    expect(() => parseImport('{"nope":1}')).toThrow()
    expect(() => parseImport('not json')).toThrow()
  })
})

describe('serializeExport', () => {
  it('native export round-trips', () => {
    const c = JSON.parse(serializeExport(native, 'native')) as Collection
    expect(c.name).toBe('N')
  })
  it('postman export has v2.1 schema', () => {
    const p = JSON.parse(serializeExport(native, 'postman'))
    expect(p.info.schema).toContain('v2.1.0')
  })
})

describe('OpenAPI', () => {
  const coll: Collection = { id: 'c1', name: 'API', workspaceId: '', requests: [
    { id: 'r1', name: 'Create user', method: 'POST', url: 'https://api.example.com/users?verbose=1', params: [{ key: 'verbose', value: '1', enabled: true }], headers: [{ key: 'X-Api-Key', value: 'k', enabled: true }], body: { mode: 'raw', type: 'json', text: '{"name":"a"}' } },
  ], folders: [
    { id: 'f1', name: 'Admin', requests: [{ id: 'r2', name: 'List', method: 'GET', url: 'https://api.example.com/admin', params: [], headers: [], body: { mode: 'none' } }] },
  ] }

  it('exports an OpenAPI 3 doc with paths/methods/server', () => {
    const doc = JSON.parse(serializeExport(coll, 'openapi'))
    expect(doc.openapi).toMatch(/^3\./)
    expect(doc.info.title).toBe('API')
    expect(doc.servers[0].url).toBe('https://api.example.com')
    expect(doc.paths['/users'].post.summary).toBe('Create user')
    expect(doc.paths['/admin'].get.tags).toEqual(['Admin'])
    expect(doc.paths['/users'].post.requestBody.content['application/json'].example).toEqual({ name: 'a' })
  })

  it('detects + imports an OpenAPI doc back into a collection (tags -> folders)', () => {
    const doc = serializeExport(coll, 'openapi')
    expect(detectFormat(JSON.parse(doc))).toBe('openapi')
    const back = parseImport(doc)
    expect(back.name).toBe('API')
    const post = back.requests.find((r) => (r as any).method === 'POST') as any
    expect(post.url).toBe('https://api.example.com/users')
    expect(post.method).toBe('POST')
    const admin = back.folders?.find((f) => f.name === 'Admin')
    expect((admin?.requests[0] as any).method).toBe('GET')
  })
})
