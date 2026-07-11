import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { EnvironmentStore } from '../../src/extension/environment-store'

let dir: string
let store: EnvironmentStore
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restman-env-'))
  store = new EnvironmentStore(dir)
})
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('EnvironmentStore', () => {
  it('starts empty', async () => {
    expect(await store.list()).toEqual([])
  })
  it('creates and lists an environment', async () => {
    const e = await store.createEnvironment('Dev')
    expect(e.name).toBe('Dev')
    expect(e.variables).toEqual([])
    expect((await store.list()).map((x) => x.name)).toEqual(['Dev'])
  })
  it('upserts variables by environment id', async () => {
    const e = await store.createEnvironment('Dev')
    await store.saveEnvironment({ ...e, variables: [{ key: 'base', value: 'v', enabled: true }] })
    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(all[0].variables[0].key).toBe('base')
  })
  it('deletes an environment', async () => {
    const e = await store.createEnvironment('Dev')
    await store.deleteEnvironment(e.id)
    expect(await store.list()).toEqual([])
  })
  it('skips a corrupt environment file when listing', async () => {
    await store.createEnvironment('Good')
    await fs.writeFile(path.join(dir, 'environments', 'bad.json'), '{ broken')
    expect((await store.list()).map((x) => x.name)).toEqual(['Good'])
  })
})
