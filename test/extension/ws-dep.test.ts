// @vitest-environment node
import { describe, it, expect } from 'vitest'
import WebSocket from 'ws'

describe('ws dependency', () => {
  it('the ws library is installed and importable', () => {
    expect(typeof WebSocket).toBe('function')
  })
})
