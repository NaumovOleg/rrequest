// OAuth 2.0 client for RREQUEST: Authorization Code (PKCE) and Client
// Credentials grants. Tokens are stored via VS Code Secret Storage (injected)
// keyed by request id, so they never touch the workspace JSON / sync snapshots.
// The localhost callback server uses node:http; the browser open and the token
// fetch are injected so this file stays unit-testable without `vscode`.
import * as http from 'node:http'
import * as crypto from 'node:crypto'
import type { Auth, OAuthToken } from '../../shared/types'

export type SecretsLike = {
  get(key: string): Thenable<string | undefined>
  store(key: string, value: string): Thenable<void>
  delete(key: string): Thenable<void>
}

export type OAuthDeps = {
  secrets: SecretsLike
  openExternal: (url: string) => Promise<boolean>
  fetchImpl?: typeof fetch
}

export type TokenResult = { access: string; refresh?: string; expiresInSec?: number }

const oauthTokenKey = (requestId: string): string => `rrequest.oauth.${requestId}`
const OAuthError = class extends Error {}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function pkceChallenge(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(48))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

async function tokenFetch(
  tokenUrl: string,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenResult> {
  const resp = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  if (!resp.ok) {
    throw new OAuthError(`Token endpoint returned ${resp.status} ${resp.statusText}`)
  }
  const json = (await resp.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!json.access_token) {
    throw new OAuthError(json.error_description ?? json.error ?? 'Token endpoint returned no access_token')
  }
  return { access: json.access_token, refresh: json.refresh_token, expiresInSec: json.expires_in }
}

/** Authorize via the loopback redirect flow with PKCE. Resolves the OAuth2 `code`. */
async function authorizationCode(
  auth: Extract<Auth, { type: 'oauth2' }>,
  deps: OAuthDeps,
): Promise<TokenResult> {
  const { verifier, challenge } = pkceChallenge()
  const state = base64url(crypto.randomBytes(24))
  const server = http.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new OAuthError('Could not start loopback server')
  const port = address.port
  const redirectUri = `http://127.0.0.1:${port}/callback`

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: auth.clientId,
    redirect_uri: redirectUri,
    scope: auth.scope ?? '',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  const authUrl = `${auth.authUrl}${auth.authUrl.includes('?') ? '&' : '?'}${params.toString()}`

  try {
    await deps.openExternal(authUrl)
  } catch (e: any) {
    server.close()
    throw new OAuthError(`Could not open browser: ${e?.message ?? e}`)
  }

  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close()
      reject(new OAuthError('OAuth flow aborted (no callback within 60s)'))
    }, 60_000)
    server.on('request', (req, res) => {
      if (!req.url?.startsWith('/callback')) return
      const url = new URL(req.url, `http://127.0.0.1:${port}`)
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body style="font-family:sans-serif;text-align:center;padding-top:80px"><h2>RREQUEST</h2><p>Authorization complete — you can close this tab.</p></body></html>')
      clearTimeout(timeout)
      if (url.searchParams.get('state') !== state) {
        server.close()
        reject(new OAuthError('OAuth state mismatch — aborting'))
        return
      }
      const err = url.searchParams.get('error')
      const codeParam = url.searchParams.get('code')
      if (err) {
        server.close()
        reject(new OAuthError(`Authorization failed: ${err}`))
        return
      }
      if (!codeParam) {
        server.close()
        reject(new OAuthError('Authorization callback carried no code'))
        return
      }
      server.close()
      resolve(codeParam)
    })
  })

  return await tokenFetch(
    auth.tokenUrl,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: auth.clientId,
      code_verifier: verifier,
      ...(auth.clientSecret ? { client_secret: auth.clientSecret } : {}),
    },
    deps.fetchImpl ?? fetch,
  )
}

async function clientCredentials(
  auth: Extract<Auth, { type: 'oauth2' }>,
  fetchImpl: typeof fetch,
): Promise<TokenResult> {
  if (!auth.clientSecret) throw new OAuthError('Client Credentials grant requires a client secret')
  return await tokenFetch(
    auth.tokenUrl,
    {
      grant_type: 'client_credentials',
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
      ...(auth.scope ? { scope: auth.scope } : {}),
    },
    fetchImpl,
  )
}

async function refreshToken(
  auth: Extract<Auth, { type: 'oauth2' }>,
  refresh: string,
  fetchImpl: typeof fetch,
): Promise<TokenResult> {
  return await tokenFetch(
    auth.tokenUrl,
    {
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: auth.clientId,
      ...(auth.clientSecret ? { client_secret: auth.clientSecret } : {}),
    },
    fetchImpl,
  )
}

function tokenToJson(t: OAuthToken): string {
  return JSON.stringify(t)
}

/** Fetch a usable access token for `requestId`, reusing/refreshing what's stored. */
export async function resolveOAuthToken(
  auth: Extract<Auth, { type: 'oauth2' }>,
  requestId: string,
  deps: OAuthDeps,
): Promise<string> {
  const key = oauthTokenKey(requestId)
  const raw = await deps.secrets.get(key)
  let stored: OAuthToken | undefined
  try {
    if (raw) stored = JSON.parse(raw) as OAuthToken
  } catch { /* corrupt — mint fresh */ }

  if (auth.grant === 'client-credentials') {
    // Stateless grant: always mint fresh (cheap). `stored` may still hold an
    // old token from a prior authorization-code config — ignore it.
    const t = await clientCredentials(auth, deps.fetchImpl ?? fetch)
    await deps.secrets.store(key, tokenToJson({ access: t.access, refresh: t.refresh, exp: t.expiresInSec ? Date.now() + t.expiresInSec * 1000 : undefined, at: Date.now() }))
    return t.access
  }

  if (stored?.access && (!stored.exp || stored.exp > Date.now())) return stored.access
  if (stored?.refresh) {
    try {
      const t = await refreshToken(auth, stored.refresh, deps.fetchImpl ?? fetch)
      await deps.secrets.store(key, tokenToJson({ access: t.access, refresh: t.refresh ?? stored.refresh, exp: t.expiresInSec ? Date.now() + t.expiresInSec * 1000 : undefined, at: Date.now() }))
      return t.access
    } catch {
      // refresh failed — fall through so the caller asks the user to re-auth
    }
  }
  throw new OAuthError('No usable OAuth2 token — open the request and click "Get token"')
}

/** Mint a token interactively (Auth tab button) and store it. */
export async function fetchOAuthToken(
  auth: Extract<Auth, { type: 'oauth2' }>,
  requestId: string,
  deps: OAuthDeps,
): Promise<TokenResult> {
  const t =
    auth.grant === 'client-credentials'
      ? await clientCredentials(auth, deps.fetchImpl ?? fetch)
      : await authorizationCode(auth, deps)
  await deps.secrets.store(
    oauthTokenKey(requestId),
    tokenToJson({ access: t.access, refresh: t.refresh, exp: t.expiresInSec ? Date.now() + t.expiresInSec * 1000 : undefined, at: Date.now() }),
  )
  return t
}

/** Status for the Auth tab badge: remaining seconds until expiry, or null when absent. */
export async function oauthTokenStatus(
  requestId: string,
  deps: OAuthDeps,
): Promise<{ ok: boolean; expiresInSec?: number }> {
  const raw = await deps.secrets.get(oauthTokenKey(requestId))
  if (!raw) return { ok: false }
  try {
    const t = JSON.parse(raw) as OAuthToken
    if (t.exp) return { ok: true, expiresInSec: Math.max(0, Math.round((t.exp - Date.now()) / 1000)) }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export { OAuthError, oauthTokenKey }
