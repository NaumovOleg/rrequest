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
      workspaceId: 'w1',
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
    st.setEnvironments([{ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [] }])
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

describe('store pendingSaveCollectionId', () => {
  it('sets and resets pendingSaveCollectionId', () => {
    useStore.getState().setPendingSaveCollectionId('c1')
    expect(useStore.getState().pendingSaveCollectionId).toBe('c1')
    useStore.getState().__reset()
    expect(useStore.getState().pendingSaveCollectionId).toBeNull()
  })
})

describe('store ws slice', () => {
  it('ws actions update state and __reset clears them', () => {
    const s = useStore.getState()
    s.setWsMode(true); s.setWsUrl('wss://e'); s.setWsInput('hi')
    s.wsStartConnect('c1')
    s.wsSetStatus('open')
    s.wsAppendLog({ dir: 'in', data: 'hello', at: 1 })
    const st = useStore.getState()
    expect(st.wsMode).toBe(true); expect(st.wsUrl).toBe('wss://e'); expect(st.wsInput).toBe('hi')
    expect(st.wsConnId).toBe('c1'); expect(st.wsStatus).toBe('open')
    expect(st.wsLog).toEqual([{ dir: 'in', data: 'hello', at: 1 }])
    useStore.getState().__reset()
    const r = useStore.getState()
    expect(r.wsMode).toBe(false); expect(r.wsStatus).toBe('closed'); expect(r.wsLog).toEqual([]); expect(r.wsConnId).toBeNull()
  })
})

describe('store pendingSaveFolderId + envMode', () => {
  it('set + reset', () => {
    useStore.getState().setPendingSaveFolderId('f1'); useStore.getState().setEnvMode(true)
    expect(useStore.getState().pendingSaveFolderId).toBe('f1'); expect(useStore.getState().envMode).toBe(true)
    useStore.getState().__reset()
    expect(useStore.getState().pendingSaveFolderId).toBeNull(); expect(useStore.getState().envMode).toBe(false)
  })
})

describe('store openOrReplaceBlank', () => {
  it('reuses a pristine blank tab instead of opening a second', () => {
    useStore.getState().openNewTab()                 // one pristine blank
    useStore.getState().openOrReplaceBlank({ name: 'Opened', method: 'POST', url: 'https://z' })
    expect(useStore.getState().tabs).toHaveLength(1)
    expect(useStore.getState().tabs[0].url).toBe('https://z')
  })
  it('opens a new tab when the active tab is not blank', () => {
    useStore.getState().openNewTab()
    useStore.getState().updateActive({ url: 'https://used' })  // active now non-blank
    useStore.getState().openOrReplaceBlank({ url: 'https://z' })
    expect(useStore.getState().tabs).toHaveLength(2)
  })
  it('links a reused blank tab to the source id + keeps activeTabId in sync', () => {
    useStore.getState().openNewTab()
    useStore.getState().openOrReplaceBlank({ id: 'src', name: 'Opened', method: 'GET', url: 'u', collectionId: 'c1', folderId: null })
    const s = useStore.getState()
    expect(s.activeTabId).toBe('src')
    expect(s.tabs.find((t) => t.id === s.activeTabId)?.collectionId).toBe('c1')
  })
})

describe('store openLinkedTab', () => {
  const req = (id: string) => ({ id, name: id, method: 'GET' as const, url: `https://${id}`, params: [], headers: [], body: { mode: 'none' as const } })
  it('opens distinct requests in separate tabs', () => {
    useStore.getState().openLinkedTab(req('r1'), 'c1', null)
    useStore.getState().openLinkedTab(req('r2'), 'c1', null)
    const s = useStore.getState()
    expect(s.tabs.map((t) => t.id)).toEqual(['r1', 'r2'])
    expect(s.activeTabId).toBe('r2')
  })
  it('focuses the existing tab instead of duplicating', () => {
    useStore.getState().openLinkedTab(req('r1'), 'c1', null)
    useStore.getState().openLinkedTab(req('r2'), 'c1', null)
    useStore.getState().openLinkedTab(req('r1'), 'c1', null)
    const s = useStore.getState()
    expect(s.tabs).toHaveLength(2)
    expect(s.activeTabId).toBe('r1')
  })
  it('consumes the pristine blank mount tab', () => {
    useStore.getState().openNewTab()              // pristine blank
    useStore.getState().openLinkedTab(req('r1'), 'c1', null)
    expect(useStore.getState().tabs).toHaveLength(1)
    expect(useStore.getState().tabs[0].id).toBe('r1')
  })
})

describe('store setTree tab reconciliation', () => {
  it('updates a non-active linked tab when the tree changes (e.g. sidebar rename)', () => {
    // open a linked tab, then switch away so it is not the active tab
    useStore.getState().openOrReplaceBlank({ id: 'r1', name: 'Old', method: 'GET', url: 'u', collectionId: 'c1', folderId: null })
    useStore.getState().openNewTab()  // active is now the fresh blank, r1 is inactive
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [{ id: 'r1', name: 'Renamed', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }] }])
    expect(useStore.getState().tabs.find((t) => t.id === 'r1')?.name).toBe('Renamed')
  })
  it('relocates an open tab when its request moves into a folder', () => {
    useStore.getState().openLinkedTab({ id: 'r1', name: 'R', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }, 'c1', null)
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'F', requests: [{ id: 'r1', name: 'R', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }] }] }])
    const t = useStore.getState().tabs.find((x) => x.id === 'r1')
    expect(t?.collectionId).toBe('c1')
    expect(t?.folderId).toBe('f1')
  })
  it('does not clobber the active linked tab from a tree broadcast', () => {
    useStore.getState().openOrReplaceBlank({ id: 'r1', name: 'Typing', method: 'GET', url: 'u', collectionId: 'c1', folderId: null })
    // r1 is the active tab; a stale tree broadcast must not overwrite it
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [{ id: 'r1', name: 'Stale', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } }] }])
    expect(useStore.getState().tabs.find((t) => t.id === 'r1')?.name).toBe('Typing')
  })
})

describe('store sharing state', () => {
  it('isViewer reflects the active workspace role', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'A', role: 'viewer' }, { id: 'w2', name: 'B', role: 'owner' }], 'w1')
    expect(useStore.getState().isViewer()).toBe(true)
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'A', role: 'viewer' }, { id: 'w2', name: 'B', role: 'owner' }], 'w2')
    expect(useStore.getState().isViewer()).toBe(false)
  })
  it('pushToast adds a toast with an id; dismissToast removes it', () => {
    useStore.getState().pushToast('error', 'nope')
    const t = useStore.getState().toasts
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ level: 'error', message: 'nope' })
    useStore.getState().dismissToast(t[0].id)
    expect(useStore.getState().toasts).toHaveLength(0)
  })
  it('setMembers / membersMode round-trip', () => {
    useStore.getState().setMembers([{ email: 'o@x.com', role: 'owner', pending: false }])
    expect(useStore.getState().members).toHaveLength(1)
    useStore.getState().setMembersMode(true)
    expect(useStore.getState().membersMode).toBe(true)
  })
  it('setAuthEmail stores the signed-in email (or null)', () => {
    useStore.getState().setAuthEmail('me@x.com')
    expect(useStore.getState().authEmail).toBe('me@x.com')
    useStore.getState().setAuthEmail(null)
    expect(useStore.getState().authEmail).toBeNull()
  })
  it('activeSynced reflects the active workspace synced flag', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'A', role: 'owner', synced: true }, { id: 'w2', name: 'B' }], 'w1')
    expect(useStore.getState().activeSynced()).toBe(true)
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'A', role: 'owner', synced: true }, { id: 'w2', name: 'B' }], 'w2')
    expect(useStore.getState().activeSynced()).toBe(false)
  })
})
