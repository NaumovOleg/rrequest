// No-code checks: serialize rows of assertions into a pm.test script that the
// existing sandbox executes, and parse them back out of the script text.

export type CheckRow = {
  id: string
  target: 'status' | 'header' | 'json' | 'time'
  selector: string
  op: 'eq' | 'lt' | 'gt'
  value: string
}

export const MARKER = '// rrequest:checks '

export function compileChecks(rows: CheckRow[]): string {
  if (rows.length === 0) return ''
  const parts: string[] = [`${MARKER}${JSON.stringify(rows.map(({ target, selector, op, value }) => ({ target, selector, op, value })))}`]
  parts.push(`const __v = (path) => {
  let cur = pm.response.json()
  for (const key of path.split('.')) {
    if (cur === undefined || cur === null) return undefined
    cur = cur[key]
  }
  return cur
}`)
  for (const r of rows) {
    const value = JSON.stringify(r.value)
    switch (r.target) {
      case 'status':
        parts.push(`pm.test("Status is ${esc(r.value)}", () => { pm.expect(pm.response.code).${opFor(r.op)}(Number(${value})) })`)
        break
      case 'header':
        parts.push(`pm.test("Header ${esc(r.selector)} is ${esc(r.value)}", () => { const h = pm.response.headers.find((x) => x.key.toLowerCase() === ${JSON.stringify(r.selector.toLowerCase())}); pm.expect(h ? h.value : undefined).${opFor(r.op)}(${value}) })`)
        break
      case 'json':
        parts.push(`pm.test("JSON ${esc(r.selector)} is ${esc(r.value)}", () => { const v = __v(${JSON.stringify(r.selector)}); const expected = Number(${value}); pm.expect(typeof v === 'number' ? v : expected === Number(v ?? '') ? Number(v) : String(v)).${opFor(r.op)}(typeof v === 'number' ? expected : ${value}) })`)
        break
      case 'time':
        parts.push(`pm.test("Response time ${opWord(r.op)} ${esc(r.value)} ms", () => { pm.expect(pm.response.responseTime).${opFor(r.op)}(Number(${value})) })`)
        break
    }
  }
  return parts.join('\n')
}

export type ParsedChecks = { rows: CheckRow[]; scriptBefore: string; scriptAfter: string } | null

export function parseChecks(fullText: string): ParsedChecks {
  const lines = fullText.split('\n')
  const idx = lines.findIndex((l) => l.startsWith(MARKER))
  if (idx === -1) return null
  try {
    const rows: Omit<CheckRow, 'id'>[] = JSON.parse(lines[idx].slice(MARKER.length))
    return {
      rows: rows.map((r) => ({ ...r, id: `c${Math.random().toString(36).slice(2, 8)}` })),
      scriptBefore: lines.slice(0, idx).join('\n'),
      scriptAfter: lines.slice(idx + 1).join('\n'),
    }
  } catch {
    return null
  }
}

function opFor(op: CheckRow['op']): string {
  return op === 'eq' ? 'to.equal' : op === 'gt' ? 'to.be.above' : 'to.be.below'
}

function opWord(op: CheckRow['op']): string {
  return op === 'eq' ? 'equals' : op === 'gt' ? 'over' : 'under'
}

function esc(s: string): string {
  return s.replace(/"/g, '\\"')
}
