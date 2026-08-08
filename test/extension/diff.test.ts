import { describe, expect, it } from 'vitest'
import { diffLines } from '../../src/webview/state/diff'

describe('diffLines', () => {
  it('reports identical text as all same', () => {
    const out = diffLines('a\nb\nc', 'a\nb\nc')
    expect(out).toEqual([
      { t: 'same', text: 'a' },
      { t: 'same', text: 'b' },
      { t: 'same', text: 'c' },
    ])
  })

  it('marks a middle insertion/removal around common lines', () => {
    const out = diffLines('a\nx\nc', 'a\nb\nc')
    expect(out).toEqual([
      { t: 'same', text: 'a' },
      { t: 'del', text: 'x' },
      { t: 'add', text: 'b' },
      { t: 'same', text: 'c' },
    ])
  })

  it('handles a pure append (no adds beyond the end)', () => {
    const out = diffLines('a\nb', 'a\nb\nc')
    expect(out).toEqual([
      { t: 'same', text: 'a' },
      { t: 'same', text: 'b' },
      { t: 'add', text: 'c' },
    ])
  })

  it('keeps interleaved identical lines as same', () => {
    const out = diffLines('l1\nkeep\nl2', 'l1\nkeep\nl3')
    expect(out.filter((l) => l.t === 'same').map((l) => l.text)).toEqual(['l1', 'keep'])
  })

  it('falls back to everything-changed past the cell cap', () => {
    const big = 'x\n'.repeat(3000)
    const out = diffLines(big, 'y')
    expect(out[0]).toEqual({ t: 'del', text: 'x' })
    expect(out[out.length - 1]).toEqual({ t: 'add', text: 'y' })
  })
})