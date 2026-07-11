import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../../src/webview/state/store'

beforeEach(() => useStore.getState().__reset())

describe('webview store', () => {
  it('opens a new tab and makes it active', () => {
    useStore.getState().openNewTab()
    const s = useStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.activeTabId).toBe(s.tabs[0].id)
  })

  it('updateActive patches only the active request', () => {
    const st = useStore.getState()
    st.openNewTab()
    st.updateActive({ url: 'https://z', method: 'POST' })
    const active = useStore.getState().tabs[0]
    expect(active.url).toBe('https://z')
    expect(active.method).toBe('POST')
  })

  it('closeTab removes it and picks a new active', () => {
    const st = useStore.getState()
    st.openNewTab(); st.openNewTab()
    const first = useStore.getState().tabs[0].id
    st.closeTab(first)
    const s = useStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.activeTabId).toBe(s.tabs[0].id)
  })

  it('stores a response keyed by request id', () => {
    const st = useStore.getState()
    st.openNewTab()
    const id = useStore.getState().tabs[0].id
    st.setResponse(id, {
      status: 200, statusText: 'OK', headers: [], body: 'ok',
      bodyTruncated: false, timeMs: 1, sizeBytes: 2, cookies: [],
    })
    expect(useStore.getState().responses[id]?.status).toBe(200)
  })
})
