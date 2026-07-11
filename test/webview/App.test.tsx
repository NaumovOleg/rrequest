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

  it('posts loadHistory on mount', () => {
    render(<App />)
    expect(posted.some((m) => m.type === 'loadHistory')).toBe(true)
  })

  it('routes a history message into the store', () => {
    render(<App />)
    const entry = {
      id: 'h1',
      request: { id: 'r1', name: 'H', method: 'GET', url: 'https://api/hist', params: [], headers: [], body: { mode: 'none' } },
      status: 200,
      at: 1,
    }
    act(() => handler?.({ type: 'history', entries: [entry] }))
    expect(useStore.getState().history).toEqual([entry])
  })

  it('reposts loadHistory after a response is routed', () => {
    useStore.getState().openNewTab()
    const id = useStore.getState().tabs[0].id
    render(<App />)
    posted.length = 0
    act(() => handler?.({ type: 'response', requestId: id, payload: {
      status: 201, statusText: 'Created', headers: [], body: 'ok',
      bodyTruncated: false, timeMs: 3, sizeBytes: 2, cookies: [] } }))
    expect(posted.some((m) => m.type === 'loadHistory')).toBe(true)
  })

  it('posts loadEnvironments on mount and routes environments into the store', () => {
    render(<App />)
    expect(posted.some((m) => m.type === 'loadEnvironments')).toBe(true)
    act(() => handler?.({ type: 'environments', environments: [{ id: 'e1', name: 'Dev', variables: [] }], activeId: 'e1' }))
    expect(useStore.getState().environments).toHaveLength(1)
    expect(useStore.getState().activeEnvId).toBe('e1')
  })
})
