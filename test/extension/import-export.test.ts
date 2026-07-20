import { describe, it, expect } from 'vitest'
import { detectFormat, parseImport, serializeExport } from '../../src/extension/import-export'
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
