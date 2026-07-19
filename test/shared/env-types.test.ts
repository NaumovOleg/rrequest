import { describe, it, expect } from 'vitest'
import { newId, type Environment, type WebviewMessage, type HostMessage } from '../../src/shared/types'

describe('environment types', () => {
  it('an Environment type-checks and is usable', () => {
    const env: Environment = {
      id: newId(), name: 'Dev', workspaceId: 'w1',
      variables: [{ key: 'base', value: 'https://api.dev', enabled: true }],
    }
    expect(env.variables[0].key).toBe('base')
  })

  it('the new message arms type-check', () => {
    const a: WebviewMessage = { type: 'setActiveEnv', id: null }
    const b: WebviewMessage = { type: 'saveEnvironment', environment: { id: '1', name: 'x', workspaceId: 'w1', variables: [] } }
    const c: HostMessage = { type: 'environments', environments: [], activeId: null }
    expect(a.type).toBe('setActiveEnv')
    expect(b.type).toBe('saveEnvironment')
    expect(c.type).toBe('environments')
  })
})
