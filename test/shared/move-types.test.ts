import { describe, it, expect } from 'vitest'
import type { WebviewMessage } from '../../src/shared/types'
describe('moveRequest type', () => {
  it('type-checks', () => {
    const m: WebviewMessage = { type: 'moveRequest', fromCollectionId: 'c1', fromFolderId: null, toCollectionId: 'c2', toFolderId: 'f1', requestId: 'r1' }
    expect(m.type).toBe('moveRequest')
  })
})
