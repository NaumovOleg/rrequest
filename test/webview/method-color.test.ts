import { describe, it, expect } from 'vitest'
import { methodClass } from '../../src/webview/method-color'

describe('methodClass', () => {
  it('maps known methods to rm-method--<METHOD>', () => {
    expect(methodClass('GET')).toBe('rm-method--GET')
    expect(methodClass('POST')).toBe('rm-method--POST')
    expect(methodClass('DELETE')).toBe('rm-method--DELETE')
    expect(methodClass('QUERY')).toBe('rm-method--QUERY')
  })
  it('maps HEAD/OPTIONS to their colors and unknown to rm-method--OTHER', () => {
    expect(methodClass('HEAD')).toBe('rm-method--HEAD')
    expect(methodClass('OPTIONS')).toBe('rm-method--OPTIONS')
    expect(methodClass('WAT' as any)).toBe('rm-method--OTHER')
  })
})
