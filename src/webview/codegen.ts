import type { RestRequest } from '../shared/types'

// Request -> ready-to-paste code snippets. Pure functions, no UI.

function hasBody(r: RestRequest): boolean {
  return r.body.mode === 'raw' || r.body.mode === 'urlencoded' || r.body.mode === 'formdata'
}

function bodyJson(r: RestRequest): Record<string, string> | null {
  const items = r.body.mode === 'urlencoded' ? r.body.items : r.body.mode === 'formdata' ? r.body.items.filter((i) => i.kind === 'text') : null
  if (!items) return null
  const obj: Record<string, string> = {}
  for (const i of items) if (i.enabled && i.key) obj[i.key] = i.value ?? ''
  return Object.keys(obj).length ? obj : null
}

function hasFile(r: RestRequest): boolean {
  return r.body.mode === 'formdata' && r.body.items.some((i) => i.kind === 'file' && i.enabled)
}

function headersObj(r: RestRequest): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of r.headers) if (h.enabled && h.key) out[h.key] = h.value ?? ''
  return out
}

function tryJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

function jsString(s: string): string {
  return JSON.stringify(s)
}

export function toCurlString(r: RestRequest): string {
  if (hasFile(r)) return '// form-data with file uploads is not supported in a one-line curl'
  const parts = [`curl --request ${r.method} ${shellQuote(r.url)}`]
  for (const [k, v] of Object.entries(headersObj(r))) parts.push(`--header ${shellQuote(`${k}: ${v}`)}`)
  if (r.body.mode === 'raw' && r.body.text) parts.push(`--data ${shellQuote(r.body.text)}`)
  else if (bodyJson(r)) parts.push(`--data ${shellQuote(JSON.stringify(bodyJson(r)))}`)
  return parts.join(' \\\n')
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function toJsFetch(r: RestRequest): string {
  if (hasFile(r)) return '// form-data with file uploads needs a FormData object; fetch() cannot attach local files'
  const lines = [
    `fetch(${JSON.stringify(r.url)}, {`,
    `  method: ${JSON.stringify(r.method)},`,
    `  headers: ${JSON.stringify(headersObj(r), null, 2)},`,
  ]
  const raw = r.body.mode === 'raw' ? r.body.text : null
  if (raw !== null && raw !== '') lines.push(`  body: ${jsString(raw)},`)
  else if (bodyJson(r)) lines.push(`  body: JSON.stringify(${JSON.stringify(bodyJson(r))}),`)
  lines.push(`})`)
  return lines.join('\n')
}

export function toPythonRequests(r: RestRequest): string {
  if (hasFile(r)) return '# form-data with file uploads requires the requests-toolbelt (multipart)'
  const lines = [
    'import requests',
    '',
    `response = requests.${r.method.toLowerCase()}(`,
    `    ${JSON.stringify(r.url)},`,
    `    headers=${JSON.stringify(headersObj(r))},`,
  ]
  if (r.body.mode === 'raw' && r.body.text) {
    const v = tryJson(r.body.text)
    lines.push(v !== undefined ? `    json=${JSON.stringify(v)},` : `    data=${JSON.stringify(r.body.text)},`)
  } else if (bodyJson(r)) {
    lines.push(`    data=${JSON.stringify(bodyJson(r))},`)
  }
  lines.splice(lines.length - 1, 0, '    timeout=30,') // drop the trailing comma? keep simple: no
  const clean = lines.map((l, i) => (i === lines.length - 1 && l.endsWith(',') ? l.slice(0, -1) : l))
  return clean.join('\n') + '\n)'
}

export function toGoHttp(r: RestRequest): string {
  if (hasFile(r)) return '// multipart file uploads need mime/multipart; not generated'
  const lines = [
    'package main',
    '',
    'import (',
    '    "bytes"',
    '    "fmt"',
    '    "io"',
    '    "net/http"',
    ')',
    '',
    'func main() {',
  ]
  const h = headersObj(r)
  if (r.body.mode === 'raw' && r.body.text) {
    lines.push(`    req, err := http.NewRequest(${JSON.stringify(r.method)}, ${JSON.stringify(r.url)}, bytes.NewBufferString(${JSON.stringify(r.body.text)}))`)
  } else if (bodyJson(r)) {
    lines.push(`    req, err := http.NewRequest(${JSON.stringify(r.method)}, ${JSON.stringify(r.url)}, bytes.NewBufferString(${JSON.stringify(JSON.stringify(bodyJson(r)))}))`)
  } else {
    lines.push(`    req, err := http.NewRequest(${JSON.stringify(r.method)}, ${JSON.stringify(r.url)}, nil)`)
  }
  lines.push('    if err != nil {\n        panic(err)\n    }')
  for (const [k, v] of Object.entries(headersObj(r))) lines.push(`    req.Header.Set(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
  lines.push('')
  lines.push(`    resp, err := http.DefaultClient.Do(req)`)
  lines.push('    if err != nil {\n        panic(err)\n    }')
  lines.push('    defer resp.Body.Close()')
  lines.push('    body, _ := io.ReadAll(resp.Body)')
  lines.push('    fmt.Println(string(body))')
  lines.push('}')
  return lines.join('\n')
}

export type Language = 'curl' | 'javascript' | 'python' | 'go'

export function generateCode(r: RestRequest, lang: Language): string {
  switch (lang) {
    case 'curl': return toCurlString(r)
    case 'javascript': return toJsFetch(r)
    case 'python': return toPythonRequests(r)
    case 'go': return toGoHttp(r)
  }
}