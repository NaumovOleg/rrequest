import { describe, it, expect } from 'vitest'
import { interpolate } from '../../src/extension/scripting/interpolate'
import type { KeyValue } from '../../src/shared/types'

const vars: KeyValue[] = [
  { key: 'base', value: 'https://api.dev', enabled: true },
  { key: 'token', value: 'abc123', enabled: true },
  { key: 'off', value: 'nope', enabled: false },
  { key: '', value: 'blank', enabled: true },
]

describe('interpolate', () => {
  it('replaces a single placeholder', () => {
    expect(interpolate('{{base}}/users', vars)).toBe('https://api.dev/users')
  })
  it('replaces multiple placeholders', () => {
    expect(interpolate('{{base}}?t={{token}}', vars)).toBe('https://api.dev?t=abc123')
  })
  it('tolerates surrounding whitespace in the braces', () => {
    expect(interpolate('{{ base }}/x', vars)).toBe('https://api.dev/x')
  })
  it('leaves unknown placeholders literal', () => {
    expect(interpolate('{{missing}}/x', vars)).toBe('{{missing}}/x')
  })
  it('ignores disabled and empty-key variables', () => {
    expect(interpolate('{{off}}-{{}}', vars)).toBe('{{off}}-{{}}')
  })
  it('passes text through unchanged when no vars', () => {
    expect(interpolate('{{base}}/x', [])).toBe('{{base}}/x')
  })
  it('is single-pass — a substituted value containing braces is not re-expanded', () => {
    const v: KeyValue[] = [
      { key: 'a', value: '{{b}}', enabled: true },
      { key: 'b', value: 'B', enabled: true },
    ]
    expect(interpolate('{{a}}', v)).toBe('{{b}}')
  })
  it('resolves dynamic values even with no env vars', () => {
    const out = interpolate('{{$uuid}}', [])
    expect(out).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(interpolate('{{$timestamp}}', [])).toMatch(/^\d{10}$/)
    expect(interpolate('{{$isoTimestamp}}', [])).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(interpolate('{{$randomInt}}', [])).toMatch(/^\d{4}$/)
    expect(interpolate('{{$randomHex}}', [])).toMatch(/^[0-9a-f]{16}$/)
  })
  it('env vars win over dynamic values', () => {
    const v: KeyValue[] = [{ key: '$uuid', value: 'fixed', enabled: true }]
    expect(interpolate('{{$uuid}}', v)).toBe('fixed')
  })
  it('leaves unknown $-prefixed placeholders literal', () => {
    expect(interpolate('{{$nope}}', [])).toBe('{{$nope}}')
  })
})
