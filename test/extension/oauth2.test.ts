import { describe, it, expect } from 'vitest'
import { pkceChallenge, resolveOAuthToken, fetchOAuthToken, oauthTokenStatus, type OAuthDeps } from '../../src/extension/net/oauth2'
import type { Auth } from '../../src/shared/types'

const oauth2Auth: Extract<Auth, { type: 'oauth2' }> = {
  type: 'oauth2',
  grant: 'authorization-code',
  authUrl: 'https://sso.test/authorize',
  tokenUrl: 'https://sso.test/token',
  clientId: 'test-client',
  scope: 'read write',
}

function makeDeps(tokenResponse?: unknown, opts?: { openSucceeds?: boolean }): { deps: OAuthDeps; secrets: Map<string, string>; opened: string[] } {
  const secrets = new Map<string, string>()
  const opened: string[] = []
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const body = init?.body?.toString() ?? ''
    if (!body.includes('grant_type=client_credentials') && !body.includes('grant_type=refresh_token') && !body.includes('grant_type=authorization_code')) {
      throw new Error('unexpected token call')
    }
    return {
      ok: true,
      status: 200,
      json: async () => tokenResponse ?? { access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600 },
    } as unknown as Response
  }) as typeof fetch
  const deps: OAuthDeps = {
    secrets: {
      get: async (k) => secrets.get(k),
      store: async (k, v) => { secrets.set(k, v) },
      delete: async (k) => { secrets.delete(k) },
    },
    openExternal: async (url) => { opened.push(url); return opts?.openSucceeds ?? true },
    fetchImpl,
  }
  return { deps, secrets, opened }
}

describe('pkceChallenge', () => {
  it('produces an RFC 7636 verifier and matching S256 challenge', () => {
    const { verifier, challenge } = pkceChallenge()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    const expected = Buffer.from(verifier).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    void expected
    // challenge = base64url(sha256(verifier)) — recompute here independently
    const sha = require('node:crypto').createHash('sha256').update(verifier).digest('base64')
    const exp = sha.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(challenge).toBe(exp)
  })
})

describe('client credentials grant', () => {
  it('mints and stores a token, sends proper form body', async () => {
    const auth = { ...oauth2Auth, grant: 'client-credentials' as const, clientSecret: 'sekret' }
    const { deps, secrets } = makeDeps()
    const token = await resolveOAuthToken(auth, 'req-1', deps)
    expect(token).toBe('fresh-access')
    expect(secrets.size).toBe(1)
    expect(secrets.keys().next().value).toMatch(/^rrequest\.oauth\.req-1$/)
    const stored = JSON.parse(secrets.values().next().value as string)
    expect(stored.access).toBe('fresh-access')
    expect(stored.exp).toBeGreaterThan(Date.now())
  })

  it('reuses a stored non-expired token for authorization-code grant', async () => {
    const { deps, secrets } = makeDeps()
    secrets.set('rrequest.oauth.req-2', JSON.stringify({ access: 'cached', exp: Date.now() + 60_000, at: Date.now() }))
    const token = await resolveOAuthToken(oauth2Auth, 'req-2', deps)
    expect(token).toBe('cached')
  })

  it('refreshes when the stored token is expired', async () => {
    const { deps, secrets } = makeDeps({ access_token: 'refreshed', refresh_token: 'new-refresh', expires_in: 600 })
    secrets.set('rrequest.oauth.req-3', JSON.stringify({ access: 'old', refresh: 'old-refresh', exp: Date.now() - 1000, at: Date.now() }))
    const token = await resolveOAuthToken(oauth2Auth, 'req-3', deps)
    expect(token).toBe('refreshed')
    const stored = JSON.parse(secrets.get('rrequest.oauth.req-3') ?? '{}')
    expect(stored.access).toBe('refreshed')
    expect(stored.refresh).toBe('new-refresh')
  })

  it('errors with a human message when no token is available', async () => {
    const { deps } = makeDeps()
    await expect(resolveOAuthToken(oauth2Auth, 'req-nope', deps)).rejects.toThrow(/Get token/i)
  })
})

describe('fetchOAuthToken', () => {
  it('stores a client-credentials token and returns expiry', async () => {
    const auth = { ...oauth2Auth, grant: 'client-credentials' as const, clientSecret: 's' }
    const { deps, secrets } = makeDeps({ access_token: 'cc', expires_in: 300 })
    const r = await fetchOAuthToken(auth, 'req-cc', deps)
    expect(r.access).toBe('cc')
    expect(r.expiresInSec).toBe(300)
    expect(JSON.parse(secrets.get('rrequest.oauth.req-cc')!).exp).toBeGreaterThan(Date.now())
  })
})

describe('oauthTokenStatus', () => {
  it('reports remaining seconds for a stored token', async () => {
    const { deps, secrets } = makeDeps()
    secrets.set('rrequest.oauth.req-s', JSON.stringify({ access: 'x', exp: Date.now() + 120_000, at: Date.now() }))
    const s = await oauthTokenStatus('req-s', deps)
    expect(s.ok).toBe(true)
    expect(s.expiresInSec).toBeGreaterThan(100)
    expect(s.expiresInSec).toBeLessThanOrEqual(120)
  })
  it('reports not-ok when nothing is stored', async () => {
    const { deps } = makeDeps()
    expect((await oauthTokenStatus('nope', deps)).ok).toBe(false)
  })
})
