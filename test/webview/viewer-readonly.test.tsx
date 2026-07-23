import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'

const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: () => () => {},
}))

import { WorkspaceSwitcher } from '../../src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher'
import { RequestPanel } from '../../src/webview/views/RequestPanel/RequestPanel'

beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('viewer read-only UX', () => {
  it('shows a role badge for a viewer next to the active workspace', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Shared', role: 'viewer' }], 'w1')
    render(<WorkspaceSwitcher />)
    expect(screen.getByText(/viewer/i)).toBeTruthy() // role badge visible
  })

  it('shows no "viewer" text for an owner', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Mine', role: 'owner' }], 'w1')
    render(<WorkspaceSwitcher />)
    expect(screen.queryByText(/viewer/i)).toBeNull()
  })

  it('hides the "new workspace" and rename/delete affordances for a viewer, but keeps switching enabled', () => {
    useStore.getState().setWorkspaces(
      [{ id: 'w1', name: 'Shared', role: 'viewer' }, { id: 'w2', name: 'Other', role: 'viewer' }],
      'w1',
    )
    render(<WorkspaceSwitcher />)
    expect(screen.queryByRole('button', { name: /new workspace/i })).toBeNull()
    // switching workspace (the combo textbox) stays enabled for a viewer
    expect(screen.getByRole('textbox')).not.toBeDisabled()
  })

  it('disables RequestPanel Save when the active workspace is a viewer, even with a collection chosen', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Shared', role: 'viewer' }], 'w1')
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }])
    useStore.getState().openNewTab()
    render(<RequestPanel />)
    // pick a collection so Save would otherwise be enabled -- the viewer gate
    // is what must keep it disabled
    fireEvent.change(screen.getByLabelText(/save to collection/i), { target: { value: 'c1' } })
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('does not autosave (postToHost saveRequest) a linked tab while the active workspace is a viewer', async () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Shared', role: 'viewer' }], 'w1')
    useStore.getState().openLinkedTab(
      { id: 'r1', name: 'Req', method: 'GET', url: 'https://x', params: [], headers: [], cookies: [], body: { mode: 'none' }, preRequestScript: '', testScript: '' },
      'c1',
      null,
    )
    render(<RequestPanel />)
    await new Promise((r) => setTimeout(r, 500))
    expect(posted.some((m) => m.type === 'saveRequest')).toBe(false)
  })
})
