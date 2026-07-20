import { create } from 'zustand'
import { newId, defaultHeaders, itemKind, type Collection, type CollectionItem, type Environment, type HistoryEntry, type HttpResponse, type KeyValue, type RestRequest, type TrashEntry, type Workspace } from '../../shared/types'

// A tab is a request plus an optional link back to the collection/folder it was
// opened from, so edits can round-trip to the tree (and tree renames back).
export type Tab = RestRequest & { collectionId?: string; folderId?: string | null }

function blankRequest(): RestRequest {
  return { id: newId(), name: 'Untitled', method: 'GET', url: '', params: [], headers: defaultHeaders(), cookies: [], body: { mode: 'none' }, preRequestScript: '', testScript: '' }
}

function isPristineBlank(t: RestRequest): boolean {
  // Default headers don't count as user content, so they're ignored here.
  return (t.name === 'New Request' || t.name === 'Untitled')
    && !t.url && t.params.length === 0
    && t.body.mode === 'none' && !t.preRequestScript && !t.testScript
}

// Find an item anywhere in the tree, returning its current location so an open
// tab can pick up a new collection/folder after a move.
function locateInTree(tree: Collection[], reqId: string): { item: CollectionItem; collectionId: string; folderId: string | null } | undefined {
  for (const c of tree) {
    const r = c.requests.find((x) => x.id === reqId)
    if (r) return { item: r, collectionId: c.id, folderId: null }
    for (const f of c.folders ?? []) {
      const fr = f.requests.find((x) => x.id === reqId)
      if (fr) return { item: fr, collectionId: c.id, folderId: f.id }
    }
  }
  return undefined
}

type State = {
  tabs: Tab[]
  activeTabId: string | undefined
  tree: Collection[]
  responses: Record<string, HttpResponse | undefined>
  history: HistoryEntry[]
  trash: TrashEntry[]
  environments: Environment[]
  activeEnvId: string | null
  pendingFilePick: { tabId: string; index: number } | null
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  pendingSaveCollectionId: string | null
  pendingSaveFolderId: string | null
  wsMode: boolean
  wsUrl: string
  wsHeaders: KeyValue[]
  wsInput: string
  wsStatus: 'closed' | 'connecting' | 'open'
  wsConnId: string | null
  wsLog: { dir: 'in' | 'out' | 'status'; data: string; at: number }[]
  envMode: boolean
  envEditId: string | null
  grpcMode: boolean
  openNewTab(): void
  closeTab(id: string): void
  setActive(id: string): void
  updateActive(patch: Partial<RestRequest>): void
  openOrReplaceBlank(patch: Partial<Tab>): void
  openLinkedTab(request: RestRequest, collectionId?: string, folderId?: string | null): void
  setTabBody(tabId: string, body: RestRequest['body']): void
  setTree(c: Collection[]): void
  setResponse(id: string, resp: HttpResponse): void
  setHistory(entries: HistoryEntry[]): void
  setTrash(entries: TrashEntry[]): void
  setEnvironments(list: Environment[]): void
  setActiveEnvId(id: string | null): void
  setPendingFilePick(p: { tabId: string; index: number } | null): void
  setWorkspaces(list: Workspace[], activeId: string | null): void
  setPendingSaveCollectionId(id: string | null): void
  setPendingSaveFolderId(id: string | null): void
  setWsMode(v: boolean): void
  setWsUrl(v: string): void
  setWsHeaders(v: KeyValue[]): void
  setWsInput(v: string): void
  wsStartConnect(connId: string): void
  wsSetStatus(status: 'closed' | 'connecting' | 'open'): void
  wsAppendLog(entry: { dir: 'in' | 'out' | 'status'; data: string; at: number }): void
  wsClear(): void
  setEnvMode(v: boolean): void
  setEnvEditId(id: string | null): void
  setGrpcMode(v: boolean): void
  __reset(): void
}

export const useStore = create<State>((set) => ({
  tabs: [],
  activeTabId: undefined,
  tree: [],
  responses: {},
  history: [],
  trash: [],
  environments: [],
  activeEnvId: null,
  pendingFilePick: null,
  workspaces: [],
  activeWorkspaceId: null,
  pendingSaveCollectionId: null,
  pendingSaveFolderId: null,
  wsMode: false,
  wsUrl: '',
  wsHeaders: [],
  wsInput: '',
  wsStatus: 'closed',
  wsConnId: null,
  wsLog: [],
  envMode: false,
  envEditId: null,
  grpcMode: false,

  openNewTab: () => set((s) => {
    const r = blankRequest()
    return { tabs: [...s.tabs, r], activeTabId: r.id }
  }),

  closeTab: (id) => set((s) => {
    const tabs = s.tabs.filter((t) => t.id !== id)
    const activeTabId = s.activeTabId === id ? tabs[tabs.length - 1]?.id : s.activeTabId
    return { tabs, activeTabId }
  }),

  setActive: (id) => set({ activeTabId: id }),

  updateActive: (patch) => set((s) => ({
    tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, ...patch } : t)),
  })),

  openOrReplaceBlank: (patch) => set((s) => {
    const active = s.tabs.find((t) => t.id === s.activeTabId)
    const isBlank = active && isPristineBlank(active)
    if (active && isBlank) {
      // patch may carry a new id (linking to a collection request); keep the
      // active pointer in sync with it.
      const newId = patch.id ?? active.id
      return { tabs: s.tabs.map((t) => (t.id === active.id ? { ...t, ...patch } : t)), activeTabId: newId }
    }
    const r = blankRequest()
    const tab = { ...r, ...patch }
    return { tabs: [...s.tabs, tab], activeTabId: tab.id }
  }),

  // Open a request in its own tab. If it is already open, just focus it (and
  // refresh its link) instead of adding a duplicate.
  openLinkedTab: (request, collectionId, folderId) => set((s) => {
    if (s.tabs.some((t) => t.id === request.id)) {
      return {
        activeTabId: request.id,
        tabs: s.tabs.map((t) => (t.id === request.id ? { ...t, collectionId, folderId: folderId ?? null } : t)),
      }
    }
    const tab: Tab = { ...request, collectionId, folderId: folderId ?? null }
    // Consume a single pristine blank tab (the one opened on mount) instead of
    // leaving it behind; every non-blank request still gets its own tab.
    const blank = s.tabs.find((t) => isPristineBlank(t))
    if (blank) {
      return { tabs: s.tabs.map((t) => (t.id === blank.id ? tab : t)), activeTabId: tab.id }
    }
    return { tabs: [...s.tabs, tab], activeTabId: tab.id }
  }),

  setTabBody: (tabId, body) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, body } : t)) })),

  setTree: (tree) => set((s) => ({
    tree,
    // Reflect tree-side changes (e.g. a rename in the sidebar) back into open
    // linked tabs. Skip the active tab so a broadcast never clobbers what the
    // user is currently typing — its own edits already flow out via autosave.
    tabs: s.tabs.map((t) => {
      if (!t.collectionId) return t
      const loc = locateInTree(tree, t.id)
      if (!loc || itemKind(loc.item) !== 'http') return t
      // Always refresh the link (collection/folder) so a moved request shows its
      // new path in the header. Skip the field merge for the active tab to avoid
      // clobbering in-progress edits — its own edits flow out via autosave.
      if (t.id === s.activeTabId) return { ...t, collectionId: loc.collectionId, folderId: loc.folderId }
      return { ...t, ...(loc.item as RestRequest), collectionId: loc.collectionId, folderId: loc.folderId }
    }),
  })),

  setResponse: (id, resp) => set((s) => ({ responses: { ...s.responses, [id]: resp } })),

  setHistory: (entries) => set({ history: entries }),

  setTrash: (entries) => set({ trash: entries }),

  setEnvironments: (environments) => set({ environments }),

  setActiveEnvId: (activeEnvId) => set({ activeEnvId }),

  setPendingFilePick: (pendingFilePick) => set({ pendingFilePick }),

  setWorkspaces: (workspaces, activeWorkspaceId) => set({ workspaces, activeWorkspaceId }),

  setPendingSaveCollectionId: (pendingSaveCollectionId) => set({ pendingSaveCollectionId }),

  setWsMode: (wsMode) => set({ wsMode }),
  setWsUrl: (wsUrl) => set({ wsUrl }),
  setWsHeaders: (wsHeaders) => set({ wsHeaders }),
  setWsInput: (wsInput) => set({ wsInput }),
  wsStartConnect: (connId) => set({ wsConnId: connId, wsStatus: 'connecting', wsLog: [] }),
  wsSetStatus: (wsStatus) => set({ wsStatus }),
  wsAppendLog: (entry) => set((s) => ({ wsLog: [...s.wsLog, entry] })),
  wsClear: () => set({ wsLog: [] }),

  setPendingSaveFolderId: (pendingSaveFolderId) => set({ pendingSaveFolderId }),
  setEnvMode: (envMode) => set({ envMode }),
  setEnvEditId: (envEditId) => set({ envEditId }),
  setGrpcMode: (grpcMode) => set({ grpcMode }),

  __reset: () => set({ tabs: [], activeTabId: undefined, tree: [], responses: {}, history: [], trash: [], environments: [], activeEnvId: null, pendingFilePick: null, workspaces: [], activeWorkspaceId: null, pendingSaveCollectionId: null, pendingSaveFolderId: null, wsMode: false, wsUrl: '', wsHeaders: [], wsInput: '', wsStatus: 'closed', wsConnId: null, wsLog: [], envMode: false, envEditId: null, grpcMode: false }),
}))
