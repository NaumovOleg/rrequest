import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { writeJsonAtomic, readJsonSafe } from '../../src/extension/atomic-write'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rrequest-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

describe('atomic-write', () => {
  it('writes then reads back JSON', async () => {
    const f = path.join(dir, 'a.json')
    await writeJsonAtomic(f, { x: 1 })
    expect(await readJsonSafe<{ x: number }>(f)).toEqual({ x: 1 })
  })

  it('leaves no temp files behind', async () => {
    const f = path.join(dir, 'a.json')
    await writeJsonAtomic(f, { x: 1 })
    const entries = await fs.readdir(dir)
    expect(entries).toEqual(['a.json'])
  })

  it('returns undefined for a missing file', async () => {
    expect(await readJsonSafe(path.join(dir, 'nope.json'))).toBeUndefined()
  })

  it('returns undefined for corrupt JSON', async () => {
    const f = path.join(dir, 'bad.json')
    await fs.writeFile(f, '{ not json')
    expect(await readJsonSafe(f)).toBeUndefined()
  })
})
