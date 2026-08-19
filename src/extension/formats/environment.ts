import { newId, type Environment, type KeyValue } from '../../shared/types'

export type EnvFormat = 'native' | 'postman'

// Postman environments export as `{ name, values: [], _postman_variable_scope }`.
// Secret variables carry `type: "secret"`; missing `type` means "default".
function pmValuesToNative(values: any[]): KeyValue[] {
  return (values ?? []).map((v) => ({
    key: String(v.key ?? ''),
    value: String(v.value ?? ''),
    enabled: v.enabled !== false,
    ...(v.type === 'secret' ? { secret: true } : {}),
  }))
}

export function pmEnvToNative(pm: any): Environment {
  return {
    id: newId(),
    name: String(pm?.name ?? 'Imported Environment'),
    workspaceId: '',
    variables: pmValuesToNative(pm?.values),
  }
}

export function envToPm(e: Environment): any {
  return {
    name: e.name,
    values: e.variables.map((v) => ({
      key: v.key,
      value: v.value,
      enabled: v.enabled !== false,
      type: v.secret ? 'secret' : 'default',
    })),
    _postman_variable_scope: 'environment',
  }
}

export function parseEnvImport(text: string): Environment {
  const parsed = JSON.parse(text) // throws on non-JSON
  if (parsed && typeof parsed === 'object') {
    if (parsed._postman_variable_scope === 'environment' || (Array.isArray(parsed.values) && typeof parsed.name === 'string')) {
      return pmEnvToNative(parsed)
    }
    if (typeof parsed.id === 'string' && typeof parsed.name === 'string' && Array.isArray(parsed.variables)) {
      return { ...(parsed as Environment), workspaceId: '' }
    }
  }
  throw new Error('Unrecognized environment format')
}

export function serializeEnvExport(e: Environment, format: EnvFormat): string {
  return JSON.stringify(format === 'postman' ? envToPm(e) : e, null, 2)
}