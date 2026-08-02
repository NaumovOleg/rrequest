import { newId, type Collection } from '../shared/types'
import { fromNative, toNative } from './postman'
import { fromOpenApi, isOpenApi, toOpenApi } from './openapi'

export type ExportFormat = 'native' | 'postman' | 'openapi'

export function detectFormat(parsed: any): 'postman' | 'native' | 'openapi' | null {
  if (parsed && typeof parsed === 'object') {
    if (isOpenApi(parsed)) return 'openapi'
    const schema = parsed.info?.schema
    if ((typeof schema === 'string' && schema.includes('v2.1')) || Array.isArray(parsed.item)) return 'postman'
    if (typeof parsed.id === 'string' && Array.isArray(parsed.requests)) return 'native'
  }
  return null
}

export function parseImport(text: string): Collection {
  const parsed = JSON.parse(text) // throws on non-JSON
  const fmt = detectFormat(parsed)
  if (fmt === 'openapi') return fromOpenApi(parsed)
  if (fmt === 'postman') return toNative(parsed)
  if (fmt === 'native') return { ...(parsed as Collection), id: (parsed as Collection).id || newId(), workspaceId: (parsed as any).workspaceId ?? '' }
  throw new Error('Unrecognized collection format')
}

export function serializeExport(c: Collection, format: ExportFormat): string {
  const obj = format === 'openapi' ? toOpenApi(c) : format === 'postman' ? fromNative(c) : c
  return JSON.stringify(obj, null, 2)
}
