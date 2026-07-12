import { describe, it, expect } from 'vitest'
import { toNative, fromNative } from '../../src/extension/postman'
import type { Collection } from '../../src/shared/types'

const pm = {
  info: { name: 'API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    { name: 'Get Users', request: {
      method: 'GET',
      header: [{ key: 'Accept', value: 'application/json' }],
      url: { raw: 'https://api.test/users?page=1', query: [{ key: 'page', value: '1' }] },
    } },
    { name: 'Folder', item: [
      { name: 'Create', request: {
        method: 'POST', header: [],
        url: { raw: 'https://api.test/users' },
        body: { mode: 'raw', raw: '{"a":1}' },
      } },
    ] },
  ],
}

describe('toNative', () => {
  it('flattens folders and maps requests', () => {
    const c = toNative(pm)
    expect(c.name).toBe('API')
    expect(c.requests).toHaveLength(2)
    expect(c.requests[0].name).toBe('Get Users')
    expect(c.requests[0].method).toBe('GET')
    expect(c.requests[0].url).toBe('https://api.test/users')
    expect(c.requests[0].params).toEqual([{ key: 'page', value: '1', enabled: true }])
    expect(c.requests[0].headers).toEqual([{ key: 'Accept', value: 'application/json', enabled: true }])
    expect(c.requests[1].name).toBe('Folder / Create')
    expect(c.requests[1].body).toEqual({ mode: 'raw', type: 'text', text: '{"a":1}' })
  })
})

describe('fromNative', () => {
  it('emits a v2.1 collection with flat items', () => {
    const c: Collection = { id: '1', name: 'API', workspaceId: '', requests: [
      { id: 'a', name: 'Get', method: 'GET', url: 'https://api.test/x',
        params: [{ key: 'q', value: '1', enabled: true }],
        headers: [{ key: 'Accept', value: 'json', enabled: true }], body: { mode: 'none' } },
    ] }
    const pmOut = fromNative(c)
    expect(pmOut.info.name).toBe('API')
    expect(pmOut.info.schema).toContain('v2.1.0')
    expect(pmOut.item).toHaveLength(1)
    expect(pmOut.item[0].name).toBe('Get')
    expect(pmOut.item[0].request.method).toBe('GET')
    expect(pmOut.item[0].request.url.raw).toContain('https://api.test/x')
    expect(pmOut.item[0].request.header).toEqual([{ key: 'Accept', value: 'json', disabled: false }])
  })
  it('round-trips method/url/headers', () => {
    const c = toNative(fromNative(toNative(pm)))
    expect(c.requests[0].method).toBe('GET')
    expect(c.requests[0].url).toBe('https://api.test/users')
  })
  it('round-trips disabled headers and params', () => {
    const theCollection: Collection = { id: '1', name: 'API', workspaceId: '', requests: [
      { id: 'a', name: 'Get', method: 'GET', url: 'https://api.test/x',
        params: [{ key: 'q', value: '1', enabled: false }],
        headers: [
          { key: 'A', value: '1', enabled: true },
          { key: 'B', value: '2', enabled: false },
        ],
        body: { mode: 'none' } },
    ] }
    const back = toNative(fromNative(theCollection))
    expect(back.requests[0].headers).toEqual([
      { key: 'A', value: '1', enabled: true },
      { key: 'B', value: '2', enabled: false },
    ])
    expect(back.requests[0].params).toEqual([{ key: 'q', value: '1', enabled: false }])
  })
})
