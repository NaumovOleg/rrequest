import { describe, it, expect } from 'vitest'
import * as http from 'node:http'
import { extractToken, signIn } from '../../../src/extension/sync/login'

describe('extractToken', () => {
  it('reads the token query param', () => {
    expect(extractToken('/?token=abc123')).toBe('abc123')
    expect(extractToken('/')).toBeUndefined()
  })
})

describe('signIn', () => {
  it('opens the browser to /auth/start?cb=<loopback> and resolves with the captured token', async () => {
    let openedUrl = ''
    const openExternal = (url: string) => {
      openedUrl = url
      // Simulate the browser (after Google) hitting the loopback callback with a token.
      const cb = new URL(url).searchParams.get('cb')!
      http.get(`${cb}?token=captured-jwt`, () => {})
    }
    const token = await signIn({ baseUrl: 'http://localhost:8787', openExternal, timeoutMs: 3000 })
    expect(token).toBe('captured-jwt')
    expect(openedUrl).toContain('http://localhost:8787/auth/start?cb=http%3A%2F%2F127.0.0.1%3A')
  })
})
