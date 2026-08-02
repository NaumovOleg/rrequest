import { describe, it, expect, beforeEach } from 'vitest'
import { AccountStore, subOf, type Account } from '../../../src/extension/sync/account-store'

// In-memory fakes for VS Code secrets + globalState.
function fakes() {
  const secrets = new Map<string, string>()
  const state = new Map<string, unknown>()
  return {
    secrets: {
      get: async (k: string) => secrets.get(k),
      store: async (k: string, v: string) => void secrets.set(k, v),
      delete: async (k: string) => void secrets.delete(k),
    },
    globalState: {
      get: <T>(k: string, d: T): T => (state.has(k) ? (state.get(k) as T) : d),
      update: async (k: string, v: unknown) => void state.set(k, v),
    },
    _secrets: secrets,
  }
}

// A JWT with payload { sub: 'user-1' } (header/sig irrelevant — subOf doesn't verify).
function jwt(sub: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256' })}.${b64({ sub })}.sig`
}

describe('AccountStore', () => {
  let ctx: ReturnType<typeof fakes>
  beforeEach(() => { ctx = fakes() })

  it('subOf decodes the JWT sub without verifying', () => {
    expect(subOf(jwt('user-42'))).toBe('user-42')
    expect(subOf('not-a-jwt')).toBeUndefined()
  })

  it('adds accounts, caches tokens, and lists them', async () => {
    const store = new AccountStore(ctx)
    await store.add({ id: 'a1', email: 'a@x.com' }, 'tok-a')
    await store.add({ id: 'a2', email: 'b@x.com' }, 'tok-b')
    expect(store.ids().sort()).toEqual(['a1', 'a2'])
    expect(store.getToken('a1')).toBe('tok-a')
    expect(store.emailOf('a2')).toBe('b@x.com')
    expect(store.isEmpty()).toBe(false)
  })

  it('getToken() with no id falls back to the sole account, undefined when ambiguous', async () => {
    const store = new AccountStore(ctx)
    await store.add({ id: 'a1', email: 'a@x.com' }, 'tok-a')
    expect(store.getToken()).toBe('tok-a') // sole account
    await store.add({ id: 'a2', email: 'b@x.com' }, 'tok-b')
    expect(store.getToken()).toBeUndefined() // ambiguous
  })

  it('remove drops the token + list entry', async () => {
    const store = new AccountStore(ctx)
    await store.add({ id: 'a1', email: 'a@x.com' }, 'tok-a')
    await store.remove('a1')
    expect(store.ids()).toEqual([])
    expect(store.getToken('a1')).toBeUndefined()
    expect(store.isEmpty()).toBe(true)
  })

  it('load() migrates a legacy single-account session into the registry', async () => {
    // Seed the pre-multi-account keys.
    ctx._secrets.set('rrequest.syncToken', jwt('legacy-user'))
    await ctx.globalState.update('rrequest.syncEmail', 'legacy@x.com')
    const store = new AccountStore(ctx)
    await store.load()
    expect(store.list()).toEqual<Account[]>([{ id: 'legacy-user', email: 'legacy@x.com' }])
    expect(store.getToken('legacy-user')).toBe(jwt('legacy-user'))
    expect(ctx._secrets.has('rrequest.syncToken')).toBe(false) // legacy key cleared
  })
})
