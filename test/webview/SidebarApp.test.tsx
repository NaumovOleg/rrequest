import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
let handler: ((m: any) => void) | undefined
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  getUiState: (_k: string, fb: any) => fb,
  setUiState: () => {},
  postToHost: (m: any) => posted.push(m),
  onHostMessage: (cb: (m: any) => void) => { handler = cb; return () => { handler = undefined } },
}))
import { SidebarApp } from '../../src/webview/sidebar/SidebarApp'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0; handler = undefined })

describe('SidebarApp', () => {
  it('requests state on mount and applies workspaces + tree', () => {
    render(<SidebarApp />)
    expect(posted.some((m) => m.type === 'loadWorkspaces')).toBe(true)
    act(() => {
      handler?.({ type: 'workspaces', workspaces: [{ id: 'w1', name: 'Default' }], activeId: 'w1' })
      handler?.({ type: 'tree', collections: [{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }] })
    })
    expect(useStore.getState().workspaces).toHaveLength(1)
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('syncStatus sets a scoped spinner while loading, and clears it when done', () => {
    render(<SidebarApp />)
    act(() => {
      handler?.({ type: 'syncStatus', loading: true, scope: { kind: 'workspace', id: 'w1' } })
    })
    expect(useStore.getState().syncLoading).toEqual({ kind: 'workspace', id: 'w1' })
    // loading=false must clear even when a scope payload is attached
    act(() => {
      handler?.({ type: 'syncStatus', loading: false, scope: { kind: 'workspace', id: 'w1' } })
    })
    expect(useStore.getState().syncLoading).toBeNull()
  })

})
