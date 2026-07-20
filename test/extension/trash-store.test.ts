import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { TrashStore } from '../../src/extension/trash-store'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restman-tr-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

const entry = (over: any = {}) => ({ workspaceId: 'w1', kind: 'request' as const, data: { id: 'r1', name: 'R' } as any, ...over })

describe('TrashStore', () => {
  it('adds newest-first with a generated id + timestamp', async () => {
    const t = new TrashStore(dir)
    const a = await t.add(entry({ data: { id: 'a', name: 'A' } }))
    const b = await t.add(entry({ data: { id: 'b', name: 'B' } }))
    expect(a.id).toBeTruthy(); expect(a.at).toBeGreaterThan(0)
    const list = await t.list()
    expect(list.map((e) => e.data.id)).toEqual(['b', 'a'])
  })
  it('gets and removes by entry id', async () => {
    const t = new TrashStore(dir)
    const e = await t.add(entry())
    expect((await t.get(e.id))?.id).toBe(e.id)
    await t.remove(e.id)
    expect(await t.get(e.id)).toBeUndefined()
  })
  it('drops all entries for a workspace', async () => {
    const t = new TrashStore(dir)
    await t.add(entry({ workspaceId: 'w1' }))
    await t.add(entry({ workspaceId: 'w2' }))
    await t.dropByWorkspace('w1')
    expect((await t.list()).map((e) => e.workspaceId)).toEqual(['w2'])
  })
})
