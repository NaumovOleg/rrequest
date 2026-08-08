import { describe, it, expect } from 'vitest'
import { createServer, type Server } from 'node:http'
import { runPreScript } from '../../src/extension/scripting/sandbox'

describe('repro: await fetch then mutate url', () => {
  it('real fetch + url mutation', async () => {
    const server: Server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ token: 'abc123' }))
    })
    await new Promise<void>((r) => server.listen(0, () => r()))
    const port = (server.address() as any).port

    const script = `const auth = await (await fetch('http://127.0.0.1:${port}/token', { method: 'POST' })).json();
pm.request.url = pm.request.url + '?xx=' + auth.token;`

    const out = await runPreScript(script, {
      request: { id: '1', name: 'r', method: 'GET', url: 'https://api.x/u', params: [], headers: [], body: { mode: 'none' } },
      vars: [],
    })
    server.close()
    expect(out.error).toBeUndefined()
    expect(out.request.url).toBe('https://api.x/u?xx=abc123')
  })
})
