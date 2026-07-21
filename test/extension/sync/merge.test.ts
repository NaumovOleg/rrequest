import { describe, it, expect } from 'vitest'
import { mergeSnapshots } from '../../../src/extension/sync/merge'
import type { WorkspaceSnapshot } from '../../../src/extension/sync/snapshot'

const req = (id: string, name = id) => ({ id, name, method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } })
const snap = (over: Partial<WorkspaceSnapshot>): WorkspaceSnapshot => ({ version: 1, workspaceId: 'w1', name: 'W', collections: [], environments: [], updatedAt: 1, updatedBy: 'r', ...over })

describe('mergeSnapshots', () => {
  it('adds local-only collections and keeps remote metadata', () => {
    const remote = snap({ collections: [{ id: 'c1', name: 'C1', workspaceId: 'w1', requests: [] }], updatedBy: 'remote' })
    const local = snap({ collections: [{ id: 'c2', name: 'C2', workspaceId: 'w1', requests: [] }], updatedBy: 'local' })
    const merged = mergeSnapshots(remote, local)
    expect(merged.collections.map((c) => c.id).sort()).toEqual(['c1', 'c2'])
    expect(merged.updatedBy).toBe('remote')
  })
  it('merges local-only requests into a shared collection/folder, remote wins on shared ids', () => {
    const remote = snap({ collections: [{ id: 'c1', name: 'C1', workspaceId: 'w1', requests: [req('r1', 'remote-name')], folders: [{ id: 'f1', name: 'F', requests: [req('rf1')] }] }] })
    const local = snap({ collections: [{ id: 'c1', name: 'C1', workspaceId: 'w1', requests: [req('r1', 'local-name'), req('r2')], folders: [{ id: 'f1', name: 'F', requests: [req('rf2')] }] }] })
    const merged = mergeSnapshots(remote, local)
    const c1 = merged.collections.find((c) => c.id === 'c1')!
    expect(c1.requests.map((r) => r.id).sort()).toEqual(['r1', 'r2'])
    expect(c1.requests.find((r) => r.id === 'r1')!.name).toBe('remote-name') // remote wins
    expect(c1.folders![0].requests.map((r) => r.id).sort()).toEqual(['rf1', 'rf2'])
  })
  it('merges local-only environments and env vars', () => {
    const env = (id: string, vars: any[]) => ({ id, name: id, workspaceId: 'w1', variables: vars })
    const remote = snap({ environments: [env('e1', [{ key: 'a', value: '1', enabled: true }])] })
    const local = snap({ environments: [env('e1', [{ key: 'a', value: 'X', enabled: true }, { key: 'b', value: '2', enabled: true }]), env('e2', [])] })
    const merged = mergeSnapshots(remote, local)
    expect(merged.environments.map((e) => e.id).sort()).toEqual(['e1', 'e2'])
    const e1 = merged.environments.find((e) => e.id === 'e1')!
    expect(e1.variables.find((v) => v.key === 'a')!.value).toBe('1')   // remote wins
    expect(e1.variables.find((v) => v.key === 'b')!.value).toBe('2')   // local-only added
  })
})
