import { create } from 'zustand'
import { newId, type Collection, type HttpResponse, type RestRequest } from '../../shared/types'

function blankRequest(): RestRequest {
  return { id: newId(), name: 'Untitled', method: 'GET', url: '', params: [], headers: [], body: { mode: 'none' } }
}

type State = {
  tabs: RestRequest[]
  activeTabId: string | undefined
  tree: Collection[]
  responses: Record<string, HttpResponse | undefined>
  openNewTab(): void
  closeTab(id: string): void
  setActive(id: string): void
  updateActive(patch: Partial<RestRequest>): void
  setTree(c: Collection[]): void
  setResponse(id: string, resp: HttpResponse): void
  __reset(): void
}

export const useStore = create<State>((set) => ({
  tabs: [],
  activeTabId: undefined,
  tree: [],
  responses: {},

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

  setTree: (tree) => set({ tree }),

  setResponse: (id, resp) => set((s) => ({ responses: { ...s.responses, [id]: resp } })),

  __reset: () => set({ tabs: [], activeTabId: undefined, tree: [], responses: {} }),
}))
