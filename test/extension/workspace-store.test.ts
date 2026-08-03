import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { WorkspaceStore } from '../../src/extension/stores/workspace-store'

let dir: string, store: WorkspaceStore
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rm-ws-')); store = new WorkspaceStore(dir) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('WorkspaceStore', () => {
  it('starts empty', async () => { expect(await store.list()).toEqual([]) })
  it('creates and lists', async () => {
    const w = await store.create('Default')
    expect(w.name).toBe('Default')
    expect((await store.list()).map((x) => x.name)).toEqual(['Default'])
  })
  it('renames', async () => {
    const w = await store.create('A'); await store.rename(w.id, 'B')
    expect((await store.list())[0].name).toBe('B')
  })
  it('deletes', async () => {
    const w = await store.create('A'); await store.delete(w.id)
    expect(await store.list()).toEqual([])
  })
  it('skips corrupt files', async () => {
    await store.create('Good')
    await fs.writeFile(path.join(dir, 'workspaces', 'bad.json'), '{ broken')
    expect((await store.list()).map((x) => x.name)).toEqual(['Good'])
  })
})
