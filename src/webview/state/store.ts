import { create } from 'zustand'
import { newId, type Collection, type Environment, type HistoryEntry, type HttpResponse, type KeyValue, type RestRequest, type Workspace } from '../../shared/types'

function blankRequest(): RestRequest {
  return { id: newId(), name: 'Untitled', method: 'GET', url: '', params: [], headers: [], body: { mode: 'none' }, preRequestScript: '', testScript: '' }
}

type State = {
  tabs: RestRequest[]
  activeTabId: string | undefined
  tree: Collection[]
  responses: Record<string, HttpResponse | undefined>
  history: HistoryEntry[]
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
  openNewTab(): void
  closeTab(id: string): void
  setActive(id: string): void
  updateActive(patch: Partial<RestRequest>): void
  setTabBody(tabId: string, body: RestRequest['body']): void
  setTree(c: Collection[]): void
  setResponse(id: string, resp: HttpResponse): void
  setHistory(entries: HistoryEntry[]): void
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
  __reset(): void
}

export const useStore = create<State>((set) => ({
  tabs: [],
  activeTabId: undefined,
  tree: [],
  responses: {},
  history: [],
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

  setTabBody: (tabId, body) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, body } : t)) })),

  setTree: (tree) => set({ tree }),

  setResponse: (id, resp) => set((s) => ({ responses: { ...s.responses, [id]: resp } })),

  setHistory: (entries) => set({ history: entries }),

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

  __reset: () => set({ tabs: [], activeTabId: undefined, tree: [], responses: {}, history: [], environments: [], activeEnvId: null, pendingFilePick: null, workspaces: [], activeWorkspaceId: null, pendingSaveCollectionId: null, pendingSaveFolderId: null, wsMode: false, wsUrl: '', wsHeaders: [], wsInput: '', wsStatus: 'closed', wsConnId: null, wsLog: [], envMode: false }),
}))
