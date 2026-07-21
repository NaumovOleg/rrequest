import { describe, it, expect, vi } from 'vitest'
import { buildStoresPort } from '../../../src/extension/sync/wiring'
import type { Collection, Environment } from '../../../src/shared/types'

const col = (id: string, ws: string): Collection => ({ id, name: id, workspaceId: ws, requests: [] })
const env = (id: string, ws: string): Environment => ({ id, name: id, workspaceId: ws, variables: [] })

describe('buildStoresPort', () => {
  it('filters collections + environments by workspaceId', async () => {
    const collections = { list: vi.fn(async () => [col('c1', 'w1'), col('c2', 'w2')]), saveCollection: vi.fn() } as any
    const environments = { list: vi.fn(async () => [env('e1', 'w1'), env('e2', 'w2')]), saveEnvironment: vi.fn() } as any
    const workspaces = { list: vi.fn(async () => []) } as any
    const port = buildStoresPort(collections, environments, workspaces)
    expect((await port.getCollections('w1')).map((c) => c.id)).toEqual(['c1'])
    expect((await port.getEnvironments('w2')).map((e) => e.id)).toEqual(['e2'])
  })
  it('applyPulled saves each collection and environment', async () => {
    const collections = { list: vi.fn(async () => []), saveCollection: vi.fn(async () => {}) } as any
    const environments = { list: vi.fn(async () => []), saveEnvironment: vi.fn(async () => {}) } as any
    const workspaces = { list: vi.fn(async () => []) } as any
    const port = buildStoresPort(collections, environments, workspaces)
    await port.applyPulled('w1', [col('c1', 'w1')], [env('e1', 'w1')])
    expect(collections.saveCollection).toHaveBeenCalledWith(col('c1', 'w1'))
    expect(environments.saveEnvironment).toHaveBeenCalledWith(env('e1', 'w1'))
  })
  it('getName returns the workspace name, falling back to the id', async () => {
    const collections = { list: vi.fn(async () => []), saveCollection: vi.fn() } as any
    const environments = { list: vi.fn(async () => []), saveEnvironment: vi.fn() } as any
    const workspaces = { list: vi.fn(async () => [{ id: 'w1', name: 'My Workspace' }]) } as any
    const port = buildStoresPort(collections, environments, workspaces)
    expect(await port.getName('w1')).toBe('My Workspace')
    expect(await port.getName('missing')).toBe('missing')
  })
})
