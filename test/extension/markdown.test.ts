import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../../src/webview/state/markdown'

describe('parseMarkdown', () => {
  it('parses headings, paragraphs and lists', () => {
    const blocks = parseMarkdown('# Title\n\nSome text\n\n- one\n- two')
    expect(blocks).toEqual([
      { t: 'h', level: 1, text: 'Title' },
      { t: 'p', text: 'Some text' },
      { t: 'list', items: ['one', 'two'] },
    ])
  })

  it('supports h1-h3 and bold markers', () => {
    const blocks = parseMarkdown('### Deep **bold**')
    expect(blocks[0]).toEqual({ t: 'h', level: 3, text: 'Deep **bold**' })
  })

  it('collects fenced code blocks', () => {
    const blocks = parseMarkdown('before\n```js\nconst a = 1\n```\nafter')
    expect(blocks).toEqual([
      { t: 'p', text: 'before' },
      { t: 'code', text: 'const a = 1' },
      { t: 'p', text: 'after' },
    ])
  })

  it('keeps an unterminated fence as code', () => {
    const blocks = parseMarkdown('```\nline')
    expect(blocks).toEqual([{ t: 'code', text: 'line' }])
  })

  it('normalizes CRLF', () => {
    const blocks = parseMarkdown('a\r\nb\r\n\r\n- x\r\n- y')
    expect(blocks).toEqual([
      { t: 'p', text: 'a' },
      { t: 'p', text: 'b' },
      { t: 'list', items: ['x', 'y'] },
    ])
  })

  it('returns no blocks for empty input', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('   \n\n  ')).toEqual([])
  })
})