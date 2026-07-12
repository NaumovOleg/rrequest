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

  it('setHistory stores entries and __reset clears them', () => {
    const entry = {
      id: 'h1',
      request: { id: 'r1', name: 'H', method: 'GET' as const, url: 'https://api/hist', params: [], headers: [], body: { mode: 'none' as const } },
      status: 200,
      at: 1,
    }
    useStore.getState().setHistory([entry])
    expect(useStore.getState().history).toEqual([entry])
    useStore.getState().__reset()
    expect(useStore.getState().history).toEqual([])
  })
})

describe('store environments slice', () => {
  it('setEnvironments and setActiveEnvId update state; __reset clears them', () => {
    const st = useStore.getState()
    st.setEnvironments([{ id: 'e1', name: 'Dev', variables: [] }])
    st.setActiveEnvId('e1')
    expect(useStore.getState().environments).toHaveLength(1)
    expect(useStore.getState().activeEnvId).toBe('e1')
    useStore.getState().__reset()
    expect(useStore.getState().environments).toEqual([])
    expect(useStore.getState().activeEnvId).toBeNull()
  })
})

describe('store pendingFilePick', () => {
  it('sets and resets pendingFilePick', () => {
    useStore.getState().setPendingFilePick({ tabId: 't1', index: 2 })
    expect(useStore.getState().pendingFilePick).toEqual({ tabId: 't1', index: 2 })
    useStore.getState().__reset()
    expect(useStore.getState().pendingFilePick).toBeNull()
  })
})

describe('store workspaces slice', () => {
  it('setWorkspaces sets list + active and __reset clears them', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Default' }], 'w1')
    expect(useStore.getState().workspaces).toHaveLength(1)
    expect(useStore.getState().activeWorkspaceId).toBe('w1')
    useStore.getState().__reset()
    expect(useStore.getState().workspaces).toEqual([])
    expect(useStore.getState().activeWorkspaceId).toBeNull()
  })
})

it('openNewTab seeds empty script fields', () => {
  useStore.getState().openNewTab()
  const t = useStore.getState().tabs[0]
  expect(t.preRequestScript).toBe('')
  expect(t.testScript).toBe('')
})
