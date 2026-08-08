import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRouter, type RouterDeps } from '../../src/extension/messaging'
import { HistoryStore } from '../../src/extension/stores/history-store'
import type { HttpResponse, RestRequest } from '../../src/shared/types'

let dir: string
let history: HistoryStore
let ws = ''

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hist-repro-'))
  history = new HistoryStore(dir)
})
afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }) })

const req = (): RestRequest => ({
  id: 'r1', name: 'n', method: 'GET', url: 'https://api.test/x',
  params: [], headers: [], body: { mode: 'none' },
})

const fakeResp: HttpResponse = {
  status: 200, statusText: 'OK', headers: [], body: '{}',
  bodyTruncated: false, timeMs: 1, sizeBytes: 2, cookies: [],
}

function deps() {
  let activeWs = 'w-active'
  return {
    send: async () => fakeResp,
    collections: {
      list: async () => [], saveRequest: async () => ({}), createCollection: async () => ({}),
      saveCollection: async () => ({}),
    } as any,
    history,
    environments: { list: async () => [] as any[], saveEnvironment: async () => {}, deleteEnvironment: async () => {} } as any,
    workspaces: { list: async () => [], create: async () => ({ id: 'w1' }) } as any,
    getActiveEnvId: () => null,
    setActiveEnvId: () => {},
    getActiveWorkspaceId: () => activeWs,
    setActiveWorkspaceId: (id: string) => { activeWs = id },
  } as RouterDeps
}

describe('history for workspace-less requests', () => {
  it('records a send with no collection link', async () => {
    const route = createRouter(deps())
    await route({ type: 'sendRequest', requestId: 'q1', payload: req() })
    const entries = await history.list()
    expect(entries).toHaveLength(1)
    expect(entries[0].request.url).toBe('https://api.test/x')
    expect(entries[0].status).toBe(200)
  })

  it('terse: two parallel sends both land in history', async () => {
    await history.clear()
    const route = createRouter(deps())
    await Promise.all([
      route({ type: 'sendRequest', requestId: 'q1', payload: { ...req(), url: 'https://a.test/1' } }),
      route({ type: 'sendRequest', requestId: 'q2', payload: { ...req(), url: 'https://a.test/2' } }),
    ])
    const urls = (await history.list()).map((e) => e.request.url)
    expect(urls).toContain('https://a.test/1')
    expect(urls).toContain('https://a.test/2')
  })
})