import { describe, it, expect } from 'vitest'
import { buildUrlFromParams, parseParamsFromUrl, reconcileUrlParams } from '../../src/webview/state/url-sync'

describe('url-sync', () => {
  it('builds a query string from enabled params only', () => {
    expect(buildUrlFromParams('https://x/y', [
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '2', enabled: false },
      { key: 'c', value: '3', enabled: true },
    ])).toBe('https://x/y?a=1&c=3')
  })

  it('returns the base url unchanged when no enabled params', () => {
    expect(buildUrlFromParams('https://x/y', [])).toBe('https://x/y')
  })

  it('parses params out of a url with a query string', () => {
    const { base, params } = parseParamsFromUrl('https://x/y?a=1&b=2')
    expect(base).toBe('https://x/y')
    expect(params).toEqual([
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '2', enabled: true },
    ])
  })

  it('round-trips base url with no query', () => {
    const { base, params } = parseParamsFromUrl('https://x/y')
    expect(base).toBe('https://x/y')
    expect(params).toEqual([])
  })

  describe('reconcileUrlParams', () => {
    it('rebuilds a query-less url from populated params (the open bug)', () => {
      const r = reconcileUrlParams('https://x/y', [{ key: 'a', value: '1', enabled: true }])
      expect(r.url).toBe('https://x/y?a=1')
    })
    it('parses params back when url has a query but params are empty', () => {
      const r = reconcileUrlParams('https://x/y?a=1&b=2', [])
      expect(r.params).toEqual([
        { key: 'a', value: '1', enabled: true },
        { key: 'b', value: '2', enabled: true },
      ])
    })
    it('leaves a consistent url+params untouched', () => {
      const params = [{ key: 'a', value: '1', enabled: true }]
      const r = reconcileUrlParams('https://x/y?a=1', params)
      expect(r.url).toBe('https://x/y?a=1')
      expect(r.params).toBe(params)
    })
  })
})
