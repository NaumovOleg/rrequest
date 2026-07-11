import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'

let handler: ((m: any) => void) | undefined
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: (cb: (m: any) => void) => { handler = cb; return () => { handler = undefined } },
}))

import { App } from '../../src/webview/App'

beforeEach(() => { useStore.getState().__reset(); posted.length = 0; handler = undefined })

describe('App', () => {
  it('posts ready on mount and applies incoming tree', () => {
    render(<App />)
    expect(posted.some((m) => m.type === 'ready')).toBe(true)
    act(() => handler?.({ type: 'tree', collections: [{ id: 'c1', name: 'Seen', requests: [] }] }))
    expect(screen.getByText('Seen')).toBeInTheDocument()
    expect(useStore.getState().tree).toHaveLength(1)
  })

  it('routes a response message into the active tab store', () => {
    useStore.getState().openNewTab()
    const id = useStore.getState().tabs[0].id
    render(<App />)
    act(() => handler?.({ type: 'response', requestId: id, payload: {
      status: 201, statusText: 'Created', headers: [], body: 'ok',
      bodyTruncated: false, timeMs: 3, sizeBytes: 2, cookies: [] } }))
    expect(useStore.getState().responses[id]?.status).toBe(201)
  })
})
