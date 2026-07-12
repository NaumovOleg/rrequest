import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
let handler: ((m: any) => void) | undefined
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: (cb: (m: any) => void) => { handler = cb; return () => { handler = undefined } },
}))
import { EditorApp } from '../../src/webview/editor/EditorApp'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0; handler = undefined })

describe('EditorApp', () => {
  it('posts ready + loadEnvironments on mount', () => {
    render(<EditorApp />)
    expect(posted.some((m) => m.type === 'ready')).toBe(true)
    expect(posted.some((m) => m.type === 'loadEnvironments')).toBe(true)
  })
  it('openInEditor opens a tab populated from the request', () => {
    render(<EditorApp />)
    act(() => handler?.({ type: 'openInEditor', request: { id: 'r', name: 'X', method: 'POST', url: 'https://api/z', params: [], headers: [], body: { mode: 'none' }, preRequestScript: 'pm.environment.set("a","1")', testScript: 'pm.test("t",()=>{})' } }))
    const s = useStore.getState()
    const active = s.tabs.find((t) => t.id === s.activeTabId)!
    expect(active.url).toBe('https://api/z'); expect(active.method).toBe('POST')
    expect(active.preRequestScript).toBe('pm.environment.set("a","1")')
    expect(active.testScript).toBe('pm.test("t",()=>{})')
  })
  it('routes a response into the active tab store', () => {
    useStore.getState().openNewTab()
    const id = useStore.getState().tabs[0].id
    render(<EditorApp />)
    act(() => handler?.({ type: 'response', requestId: id, payload: { status: 201, statusText: 'Created', headers: [], body: 'ok', bodyTruncated: false, timeMs: 3, sizeBytes: 2, cookies: [] } }))
    expect(useStore.getState().responses[id]?.status).toBe(201)
  })
  it('applies a pickedFile to the pending form-data row', () => {
    useStore.getState().openNewTab()
    const tabId = useStore.getState().tabs[0].id
    useStore.getState().updateActive({ body: { mode: 'formdata', items: [{ kind: 'file', key: 'f', filename: '', path: '', enabled: true }] } })
    useStore.getState().setPendingFilePick({ tabId, index: 0 })
    render(<EditorApp />)
    act(() => handler?.({ type: 'pickedFile', path: '/tmp/a.png', filename: 'a.png' }))
    const item = (useStore.getState().tabs[0].body as any).items[0]
    expect(item).toMatchObject({ path: '/tmp/a.png', filename: 'a.png' })
    expect(useStore.getState().pendingFilePick).toBeNull()
  })
  it('opens a blank tab on mount when there are no tabs', () => {
    expect(useStore.getState().tabs).toHaveLength(0)
    render(<EditorApp />)
    expect(useStore.getState().tabs).toHaveLength(1)
  })
  it('openInEditor with targetCollectionId sets pendingSaveCollectionId', () => {
    render(<EditorApp />)
    act(() => handler?.({ type: 'openInEditor', request: { id: 'r', name: 'X', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }, targetCollectionId: 'c9' }))
    expect(useStore.getState().pendingSaveCollectionId).toBe('c9')
  })
})
