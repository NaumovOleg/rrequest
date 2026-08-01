import * as http from 'node:http'

export function extractToken(reqUrl: string): string | undefined {
  const u = new URL(reqUrl, 'http://localhost')
  return u.searchParams.get('token') ?? undefined
}

export function signIn(opts: {
  baseUrl: string
  openExternal: (url: string) => void
  timeoutMs?: number
}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 120000
  return new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const token = extractToken(req.url ?? '/')
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>You can close this tab and return to VS Code.</body></html>')
      if (token) {
        clearTimeout(timer)
        server.close()
        resolve(token)
      }
    })
    const timer = setTimeout(() => { server.close(); reject(new Error('sign-in timed out')) }, timeoutMs)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      // Use 127.0.0.1, not "localhost": the server listens on IPv4 (127.0.0.1),
      // but "localhost" can resolve to IPv6 (::1) first in the browser, so the
      // OAuth redirect back would hit a dead IPv6 socket -> connection refused.
      const cb = `http://127.0.0.1:${port}`
      const base = opts.baseUrl.replace(/\/$/, '')
      opts.openExternal(`${base}/auth/start?cb=${encodeURIComponent(cb)}`)
    })
  })
}
