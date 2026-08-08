import type { ReactNode } from 'react'

// Minimal Markdown renderer — no dependency. Covers the pragmatic subset a
// request/collection description needs: headings, bullet lists, code fences,
// inline code, bold, italic, links. Everything else stays as plain text.

export type MdBlock =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'list'; items: string[] }
  | { t: 'code'; text: string }

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const blocks: MdBlock[] = []
  let list: string[] | null = null
  let fence: string[] | null = null
  const flushList = () => {
    if (list) { blocks.push({ t: 'list', items: list }); list = null }
  }
  for (const raw of lines) {
    if (fence) {
      if (raw.trim().startsWith('```')) { blocks.push({ t: 'code', text: fence.join('\n') }); fence = null }
      else fence.push(raw)
      continue
    }
    const trimmed = raw.trim()
    if (trimmed.startsWith('```')) { flushList(); fence = [] }
    else if (!trimmed) flushList()
    else if (/^#{1,3}\s/.test(trimmed)) {
      flushList()
      blocks.push({ t: 'h', level: trimmed.match(/^#+/)![0].length, text: trimmed.replace(/^#+\s*/, '') })
    }
    else if (/^[-*]\s+/.test(trimmed)) {
      list = list ?? []
      list.push(trimmed.replace(/^[-*]\s+/, ''))
    }
    else { flushList(); blocks.push({ t: 'p', text: trimmed }) }
  }
  if (fence) blocks.push({ t: 'code', text: fence.join('\n') })
  flushList()
  return blocks
}

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g

// Inline marks -> React nodes (bold/italic/code/links). The regex has one
// capture group per mark kind; text between matches is plain.
export function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(text.slice(last, idx))
    const [full] = m
    const key = `${keyPrefix}:${k++}`
    if (m[1]) out.push(<code key={key}>{m[1].slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={key}>{m[2].slice(2, -2)}</strong>)
    else if (m[3]) out.push(<em key={key}>{m[3].slice(1, -1)}</em>)
    else if (m[4]) {
      const link = m[4].match(/^\[([^\]]+)\]\(([^)]+)\)/)
      const href = link ? link[2] : '#'
      out.push(<a key={key} href={href}>{link ? link[1] : full}</a>)
    } else out.push(full)
    last = idx + full.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}