import { describe, it, expect } from 'vitest'
import type { Workspace, Collection, WebviewMessage, HostMessage } from '../../src/shared/types'

describe('workspace types', () => {
  it('Workspace and Collection.workspaceId type-check', () => {
    const w: Workspace = { id: 'w1', name: 'Default' }
    const c: Collection = { id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }
    expect(c.workspaceId).toBe('w1')
    expect(w.name).toBe('Default')
  })
  it('new message arms type-check', () => {
    const a: WebviewMessage = { type: 'openRequest', request: { id: 'r', name: 'x', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } } }
    const b: WebviewMessage = { type: 'setActiveWorkspace', id: 'w1' }
    const c: HostMessage = { type: 'openInEditor', request: { id: 'r', name: 'x', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } } }
    const d: HostMessage = { type: 'workspaces', workspaces: [], activeId: 'w1' }
    expect([a.type, b.type, c.type, d.type]).toEqual(['openRequest', 'setActiveWorkspace', 'openInEditor', 'workspaces'])
  })
})
