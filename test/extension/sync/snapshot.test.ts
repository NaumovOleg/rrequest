import { describe, it, expect } from 'vitest'
import { buildSnapshot, mergeEnvironmentsPreservingSecrets } from '../../../src/extension/sync/snapshot'
import type { Environment } from '../../../src/shared/types'

const env = (over: Partial<Environment> = {}): Environment => ({ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [], ...over })

describe('buildSnapshot', () => {
  it('strips secret env values but keeps the key + non-secret values', () => {
    const snap = buildSnapshot({
      workspaceId: 'w1', name: 'W', updatedBy: 'a@x.com', collections: [],
      environments: [env({ variables: [
        { key: 'base', value: 'https://api', enabled: true },
        { key: 'token', value: 'abc123', enabled: true, secret: true },
      ] })],
    })
    expect(snap.version).toBe(1)
    const vars = snap.environments[0].variables
    expect(vars.find((v) => v.key === 'base')?.value).toBe('https://api')
    expect(vars.find((v) => v.key === 'token')?.value).toBe('')
  })
  it('does not mutate the input environments', () => {
    const environments = [env({ variables: [{ key: 'token', value: 'abc', enabled: true, secret: true }] })]
    buildSnapshot({ workspaceId: 'w1', name: 'W', updatedBy: 'a', collections: [], environments })
    expect(environments[0].variables[0].value).toBe('abc')
  })
})

describe('mergeEnvironmentsPreservingSecrets', () => {
  it('restores local secret values when the incoming secret value is empty', () => {
    const incoming = [env({ variables: [{ key: 'token', value: '', enabled: true, secret: true }] })]
    const local = [env({ variables: [{ key: 'token', value: 'local-secret', enabled: true, secret: true }] })]
    const merged = mergeEnvironmentsPreservingSecrets(incoming, local)
    expect(merged[0].variables[0].value).toBe('local-secret')
  })
  it('leaves non-secret and already-filled values untouched', () => {
    const incoming = [env({ variables: [{ key: 'base', value: 'https://api', enabled: true }] })]
    const merged = mergeEnvironmentsPreservingSecrets(incoming, [])
    expect(merged[0].variables[0].value).toBe('https://api')
  })
})
