import type { FormDataItem, HttpMethod, KeyValue, RestRequest } from '../shared/types'
import { buildUrlFromParams } from './state/url-sync'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

// Split a shell-ish command into tokens, respecting single/double quotes.
function tokenize(cmd: string): string[] {
  const out: string[] = []
  const re = /'([^']*)'|"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

export function parseCurl(cmd: string): Partial<RestRequest> {
  const toks = tokenize(cmd.trim())
  if (toks[0] === 'curl') toks.shift()

  let method: HttpMethod | undefined
  let url: string | undefined
  const headers: KeyValue[] = []
  let dataText: string | undefined
  const formItems: FormDataItem[] = []

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t === '-X' || t === '--request') {
      const v = (toks[++i] ?? '').toUpperCase()
      if (METHODS.includes(v as HttpMethod)) method = v as HttpMethod
    } else if (t === '-H' || t === '--header') {
      const raw = toks[++i] ?? ''
      const idx = raw.indexOf(':')
      if (idx > 0) {
        const key = raw.slice(0, idx).trim()
        const value = raw.slice(idx + 1).trim()
        // Postman's cURL generator stamps its own branding onto exported
        // commands; rebrand the junk headers to ours on import.
        const k = key.toLowerCase()
        if (k === 'postman-token') headers.push({ key: 'Rrequest-Token', value, enabled: true })
        else if (k === 'user-agent' && /^PostmanRuntime\//i.test(value)) headers.push({ key: 'User-Agent', value: 'rrequest', enabled: true })
        else headers.push({ key, value, enabled: true })
      }
    } else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary') {
      dataText = toks[++i] ?? ''
    } else if (t === '-F' || t === '--form') {
      const raw = toks[++i] ?? ''
      const eq = raw.indexOf('=')
      if (eq > 0) {
        const key = raw.slice(0, eq)
        const val = raw.slice(eq + 1)
        if (val.startsWith('@')) {
          const path = val.slice(1)
          formItems.push({ kind: 'file', key, filename: path.split('/').pop() ?? path, path, enabled: true })
        } else {
          formItems.push({ kind: 'text', key, value: val, enabled: true })
        }
      }
    } else if (!t.startsWith('-')) {
      if (!url) url = t
    }
    // unknown flags are ignored
  }

  const out: Partial<RestRequest> = { method: method ?? (dataText !== undefined || formItems.length ? 'POST' : 'GET') }
  if (url) out.url = url
  if (headers.length) out.headers = headers
  if (formItems.length) out.body = { mode: 'formdata', items: formItems }
  else if (dataText !== undefined) out.body = { mode: 'raw', type: 'text', text: dataText }
  return out
}

export function toCurl(req: RestRequest): string {
  const parts: string[] = [`curl -X ${req.method} '${buildUrlFromParams(req.url, req.params)}'`]
  for (const h of req.headers) if (h.enabled && h.key) parts.push(`-H '${h.key}: ${h.value}'`)
  if (req.body.mode === 'raw' && req.body.text) parts.push(`--data '${req.body.text}'`)
  else if (req.body.mode === 'urlencoded') {
    const s = req.body.items.filter((i) => i.enabled && i.key).map((i) => `${i.key}=${i.value}`).join('&')
    if (s) parts.push(`--data '${s}'`)
  } else if (req.body.mode === 'formdata') {
    for (const it of req.body.items) {
      if (!it.enabled || !it.key) continue
      if (it.kind === 'text') parts.push(`-F '${it.key}=${it.value}'`)
      else parts.push(`-F '${it.key}=@${it.path}'`)
    }
  }
  return parts.join(' ')
}
