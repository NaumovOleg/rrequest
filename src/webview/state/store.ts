import { create } from 'zustand'
import { reconcileUrlParams } from './url-sync'
import { newId, defaultHeaders, itemKind, type Collection, type CollectionItem, type Environment, type HistoryEntry, type HttpResponse, type KeyValue, type Account, type Member, type RestRequest, type SyncScope, type TrashEntry, type Workspace, type WorkspaceRole, type WsRequest, type GrpcRequest } from '../../shared/types'

// Payload for opening the WebSocket / gRPC editor panels. `request` null = a
// fresh "New" request. `seq` bumps on every open so the panel re-applies even
// when the same request is opened twice in a row. EditorApp stashes this in the
// store BEFORE the panel mounts, avoiding the race where the panel's own
// message listener subscribes too late and misses the payload.
export type WsOpen = { seq: number; request: WsRequest | null; collectionId: string | null; folderId: string | null }
export type GrpcOpen = { seq: number; request: GrpcRequest | null; collectionId: string | null; folderId: string | null }

// A tab is a request plus an optional link back to the collection/folder it was
// opened from, so edits can round-trip to the tree (and tree renames back).
// `dirty` = the editor has unsaved edits: those stay LOCAL (not pushed to the
// sidebar/tree) until the user hits Save, and a tree broadcast won't clobber
// them. Cleared by markTabSaved.
export type Tab = RestRequest & { collectionId?: string; folderId?: string | null; dirty?: boolean }

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
  wsOpen: WsOpen | null
  wsUrl: string
  wsHeaders: KeyValue[]
  wsInput: string
  wsStatus: 'closed' | 'connecting' | 'open'
  wsConnId: string | null
  wsLog: { dir: 'in' | 'out' | 'status'; data: string; at: number }[]
  envMode: boolean
  envEditId: string | null
  grpcMode: boolean
  grpcOpen: GrpcOpen | null
  members: Member[]
  membersMode: boolean
  membersWorkspaceId: string | null
  toasts: { id: string; level: 'error' | 'info'; message: string }[]
  authEmail: string | null
  accounts: Account[]
  /** Tab ids with a request in flight (Send pressed, response not back yet).
      The Send button turns into Cancel while its tab is in the set. */
  inFlight: Set<string>
  /** Deep copy of the payload of the most recently sent request (url without
      its query string — params live in `params` and are re-appended). Null
      until the first send. Backs the "Repeat" button in the response header. */
  lastSent: RestRequest | null
  /** Which sync operation is in flight (`all` / one account / one workspace).
      `null` when idle. Row widgets match on this to spin only the button that
      started, instead of every sync icon at once. */
  syncLoading: SyncScope | null
  openNewTab(): void
  closeTab(id: string): void
  setActive(id: string): void
  updateActive(patch: Partial<RestRequest>): void
  // Make the active tab's url show its query params (does NOT mark dirty — it's
  // a display reconcile, not a user edit). No-op when the url already has them.
  reconcileActiveUrl(): void
  openOrReplaceBlank(patch: Partial<Tab>): void
  openLinkedTab(request: RestRequest, collectionId?: string, folderId?: string | null): void
  setTabBody(tabId: string, body: RestRequest['body']): void
  markTabSaved(tabId: string): void
  setTree(c: Collection[]): void
  setResponse(id: string, resp: HttpResponse): void
  setInFlight(tabId: string, v: boolean): void
  setLastSent(r: RestRequest): void
  setHistory(entries: HistoryEntry[]): void
  setTrash(entries: TrashEntry[]): void
  setEnvironments(list: Environment[]): void
  setActiveEnvId(id: string | null): void
  setPendingFilePick(p: { tabId: string; index: number } | null): void
  setWorkspaces(list: Workspace[], activeId: string | null): void
  setPendingSaveCollectionId(id: string | null): void
  setPendingSaveFolderId(id: string | null): void
  setWsMode(v: boolean): void
  openWs(request: WsRequest | null, collectionId: string | null, folderId: string | null): void
  openGrpc(request: GrpcRequest | null, collectionId: string | null, folderId: string | null): void
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
  setMembers(list: Member[]): void
  setMembersMode(v: boolean): void
  setMembersWorkspaceId(id: string | null): void
  pushToast(level: 'error' | 'info', message: string): void
  dismissToast(id: string): void
  isViewer(): boolean
  activeWorkspace(): Workspace | undefined
  setAccounts(list: Account[]): void
  setAuthEmail(email: string | null): void
  setSyncLoading(v: SyncScope | null): void
  activeSynced(): boolean
  __reset(): void
}

export const useStore = create<State>((set, get) => ({
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
  wsOpen: null,
  wsUrl: '',
  wsHeaders: [],
  wsInput: '',
  wsStatus: 'closed',
  wsConnId: null,
  wsLog: [],
  envMode: false,
  envEditId: null,
  grpcMode: false,
  grpcOpen: null,
  members: [],
  membersMode: false,
  membersWorkspaceId: null,
  toasts: [],
  authEmail: null,
  accounts: [],
  syncLoading: null,
  inFlight: new Set(),
  lastSent: null,

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
    // A user edit in the editor -> mark the tab dirty; it won't reach the
    // sidebar/tree until the user Saves.
    tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, ...patch, dirty: true } : t)),
  })),

  reconcileActiveUrl: () => set((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId)
    if (!t) return {}
    const r = reconcileUrlParams(t.url, t.params ?? [])
    if (r.url === t.url) return {} // already consistent — don't touch dirty
    return { tabs: s.tabs.map((x) => (x.id === t.id ? { ...x, url: r.url, params: r.params } : x)) }
  }),

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
    // Make the URL bar show the query params (a saved request may have params
    // but a query-less url — e.g. an OpenAPI/Postman import). Reconcile on both
    // paths so an already-open / restored tab gets fixed on reactivation too.
    if (s.tabs.some((t) => t.id === request.id)) {
      return {
        activeTabId: request.id,
        tabs: s.tabs.map((t) => {
          if (t.id !== request.id) return t
          const r = reconcileUrlParams(t.url, t.params ?? [])
          return { ...t, url: r.url, params: r.params, collectionId, folderId: folderId ?? null }
        }),
      }
    }
    const reconciled = reconcileUrlParams(request.url, request.params ?? [])
    const tab: Tab = { ...request, url: reconciled.url, params: reconciled.params, collectionId, folderId: folderId ?? null }
    // Consume a single pristine blank tab (the one opened on mount) instead of
    // leaving it behind; every non-blank request still gets its own tab.
    const blank = s.tabs.find((t) => isPristineBlank(t))
    if (blank) {
      return { tabs: s.tabs.map((t) => (t.id === blank.id ? tab : t)), activeTabId: tab.id }
    }
    return { tabs: [...s.tabs, tab], activeTabId: tab.id }
  }),

  setTabBody: (tabId, body) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, body, dirty: true } : t)) })),

  markTabSaved: (tabId) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, dirty: false } : t)) })),

  setTree: (tree) => set((s) => ({
    tree,
    // Reflect tree-side changes (a rename/edit in the sidebar, or a synced pull)
    // back into open linked tabs. A DIRTY tab keeps its unsaved working copy —
    // only its link is refreshed (so a move still shows the new path); a clean
    // tab (incl. the active one) adopts the tree's version immediately, so
    // sidebar-side changes show up in the editor right away.
    tabs: s.tabs.map((t) => {
      if (!t.collectionId) return t
      const loc = locateInTree(tree, t.id)
      if (!loc || itemKind(loc.item) !== 'http') return t
      if (t.dirty) return { ...t, collectionId: loc.collectionId, folderId: loc.folderId }
      // A clean tab adopts the tree's version — but reconcile url<->params so a
      // stored query-less url doesn't overwrite the query the user sees. (This
      // adopt was quietly reverting the URL bar back to a param-less url.)
      const item = loc.item as RestRequest
      const r = reconcileUrlParams(item.url, item.params ?? [])
      return { ...t, ...item, url: r.url, params: r.params, collectionId: loc.collectionId, folderId: loc.folderId }
    }),
  })),

  setResponse: (id, resp) => set((s) => ({ responses: { ...s.responses, [id]: resp } })),

  setInFlight: (tabId, v) => set((s) => {
    const next = new Set(s.inFlight)
    if (v) next.add(tabId); else next.delete(tabId)
    return { inFlight: next }
  }),
  setLastSent: (r) => set({ lastSent: r }),

  setHistory: (entries) => set({ history: entries }),

  setTrash: (entries) => set({ trash: entries }),

  setEnvironments: (environments) => set({ environments }),

  setActiveEnvId: (activeEnvId) => set({ activeEnvId }),

  setPendingFilePick: (pendingFilePick) => set({ pendingFilePick }),

  setWorkspaces: (workspaces, activeWorkspaceId) => set({ workspaces, activeWorkspaceId }),

  setPendingSaveCollectionId: (pendingSaveCollectionId) => set({ pendingSaveCollectionId }),

  setWsMode: (wsMode) => set({ wsMode }),
  openWs: (request, collectionId, folderId) =>
    set((s) => ({ wsMode: true, wsOpen: { seq: (s.wsOpen?.seq ?? 0) + 1, request, collectionId, folderId } })),
  openGrpc: (request, collectionId, folderId) =>
    set((s) => ({ grpcMode: true, grpcOpen: { seq: (s.grpcOpen?.seq ?? 0) + 1, request, collectionId, folderId } })),
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

  setMembers: (members) => set({ members }),
  setMembersMode: (membersMode) => set({ membersMode }),
  setMembersWorkspaceId: (membersWorkspaceId) => set({ membersWorkspaceId }),
  pushToast: (level, message) => set((s) => ({ toasts: [...s.toasts, { id: newId(), level, message }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  activeWorkspace: () => { const s = get(); return s.workspaces.find((w) => w.id === s.activeWorkspaceId) },
  isViewer: () => { const s = get(); return s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.role === 'viewer' },
  setAccounts: (accounts) => set({ accounts: accounts ?? [], authEmail: accounts?.[0]?.email ?? null }),
  // Convenience for the single-account case (tests, legacy call sites).
  setAuthEmail: (email) => set({ accounts: email ? [{ id: 'me', email }] : [], authEmail: email }),
  setSyncLoading: (syncLoading: SyncScope | null) => set({ syncLoading }),
  activeSynced: () => { const s = get(); return s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.synced === true },

  __reset: () => set({ tabs: [], activeTabId: undefined, tree: [], responses: {}, history: [], trash: [], environments: [], activeEnvId: null, pendingFilePick: null, workspaces: [], activeWorkspaceId: null, pendingSaveCollectionId: null, pendingSaveFolderId: null, wsMode: false, wsOpen: null, wsUrl: '', wsHeaders: [], wsInput: '', wsStatus: 'closed', wsConnId: null, wsLog: [], envMode: false, envEditId: null, grpcMode: false, grpcOpen: null, members: [], membersMode: false, membersWorkspaceId: null, toasts: [], authEmail: null, accounts: [], syncLoading: null, inFlight: new Set(), lastSent: null }),
}))
