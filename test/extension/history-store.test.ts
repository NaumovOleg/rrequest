import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { HistoryStore } from '../../src/extension/history-store'
import { newId, type RestRequest } from '../../src/shared/types'

let dir: string
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restman-hs-')) })
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }) })

function req(): RestRequest {
  return { id: newId(), name: 'r', method: 'GET', url: 'https://x', params: [], headers: [], body: { mode: 'none' } }
}

describe('HistoryStore', () => {
  it('appends newest-first', async () => {
    const h = new HistoryStore(dir)
    await h.append({ ...req(), name: 'old' }, 200, 'w1')
    await h.append({ ...req(), name: 'new' }, 404, 'w1')
    const list = await h.list()
    expect(list.map((e) => e.request.name)).toEqual(['new', 'old'])
    expect(list[0].status).toBe(404)
  })

  it('caps at max entries', async () => {
    const h = new HistoryStore(dir, 2)
    await h.append(req(), 200, 'w1')
    await h.append(req(), 200, 'w1')
    await h.append(req(), 200, 'w1')
    expect(await h.list()).toHaveLength(2)
  })

  it('returns empty list when no history file', async () => {
    const h = new HistoryStore(dir)
    expect(await h.list()).toEqual([])
  })
})
