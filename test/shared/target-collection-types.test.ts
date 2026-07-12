import { describe, it, expect } from 'vitest'
import type { WebviewMessage, HostMessage, RestRequest } from '../../src/shared/types'

const req: RestRequest = { id: 'r', name: 'x', method: 'GET', url: '', params: [], headers: [], body: { mode: 'none' } }

describe('targetCollectionId', () => {
  it('openRequest and openInEditor accept an optional targetCollectionId', () => {
    const a: WebviewMessage = { type: 'openRequest', request: req, targetCollectionId: 'c1' }
    const b: WebviewMessage = { type: 'openRequest', request: req }
    const c: HostMessage = { type: 'openInEditor', request: req, targetCollectionId: 'c1' }
    expect(a.type).toBe('openRequest'); expect(b.type).toBe('openRequest'); expect(c.type).toBe('openInEditor')
  })
})
