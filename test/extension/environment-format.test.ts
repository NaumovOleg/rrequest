import { describe, it, expect } from 'vitest'
import { envToPm, parseEnvImport, pmEnvToNative, serializeEnvExport } from '../../src/extension/formats/environment'
import type { Environment } from '../../src/shared/types'

const env = (over: Partial<Environment> = {}): Environment => ({
  id: 'e1', name: 'Dev', workspaceId: 'w1',
  variables: [
    { key: 'base', value: 'https://api', enabled: true },
    { key: 'token', value: 'abc', enabled: true, secret: true },
  ],
  ...over,
})

describe('postman environment export', () => {
  it('round-trips secret/default variables with types', () => {
    const pm = envToPm(env({ id: 'e1' }))
    expect(pm.name).toBe('Dev')
    expect(pm._postman_variable_scope).toBe('environment')
    expect(pm.values).toEqual([
      { key: 'base', value: 'https://api', enabled: true, type: 'default' },
      { key: 'token', value: 'abc', enabled: true, type: 'secret' },
    ])
    const back = pmEnvToNative(JSON.parse(JSON.stringify(pm)))
    expect(back.name).toBe('Dev')
    expect(back.variables).toEqual([
      { key: 'base', value: 'https://api', enabled: true },
      { key: 'token', value: 'abc', enabled: true, secret: true },
    ])
  })

  it('handles Postman files without enabled/type fields (missing = enabled default)', () => {
    const back = pmEnvToNative({ name: 'Prod', values: [{ key: 'k', value: 'v' }] })
    expect(back.variables).toEqual([{ key: 'k', value: 'v', enabled: true }])
  })

  it('keeps disabled flags from Postman', () => {
    const back = pmEnvToNative({ name: 'P', values: [{ key: 'k', value: 'v', enabled: false, type: 'secret' }] })
    expect(back.variables).toEqual([{ key: 'k', value: 'v', enabled: false, secret: true }])
  })
})

describe('parseEnvImport', () => {
  const envJson = JSON.stringify(env({ id: 'e1' }))
  const pmJson = JSON.stringify({ name: 'Dev', values: [{ key: 'base', value: 'x' }], _postman_variable_scope: 'environment' })

  it('detects native env by id/name/variables', () => {
    const e = parseEnvImport(envJson)
    expect(e.name).toBe('Dev')
    expect(e.workspaceId).toBe('') // re-bound to the active workspace on save
    expect(e.variables[1]).toMatchObject({ key: 'token', secret: true })
  })

  it('detects postman env by _postman_variable_scope', () => {
    expect(parseEnvImport(pmJson).name).toBe('Dev')
  })

  it('detects postman env by name+values even without the scope marker', () => {
    expect(parseEnvImport(JSON.stringify({ name: 'Dev', values: [] })).variables).toEqual([])
  })

  it('throws on unrecognized JSON', () => {
    expect(() => parseEnvImport('{ "foo": 1 }')).toThrow('Unrecognized environment format')
  })

  it('serializes native and postman', () => {
    expect(serializeEnvExport(env(), 'native')).toContain('"workspaceId": "w1"')
    expect(serializeEnvExport(env(), 'postman')).not.toContain('workspaceId')
  })
})