import { describe, it, expect } from 'vitest'
import { newId, type RestRequest, type WebviewMessage } from '../../src/shared/types'

describe('shared types', () => {
  it('newId returns unique non-empty strings', () => {
    const a = newId(); const b = newId()
    expect(a).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it('a RestRequest object type-checks and is usable', () => {
    const req: RestRequest = {
      id: newId(), name: 'r', method: 'GET', url: 'https://x',
      params: [], headers: [], body: { mode: 'none' },
    }
    const msg: WebviewMessage = { type: 'sendRequest', requestId: 'q1', payload: req }
    expect(msg.type).toBe('sendRequest')
  })
})
