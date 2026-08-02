import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'

const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: () => () => {},
}))

import { AccountsPanel } from '../../src/webview/views/AccountsPanel/AccountsPanel'
import { RequestPanel } from '../../src/webview/views/RequestPanel/RequestPanel'

beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('viewer read-only UX', () => {
  it('shows a role badge for a viewer workspace', () => {
    useStore.getState().setAccounts([{ id: 'a1', email: 'me@x.com' }])
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Shared', role: 'viewer', synced: true, accountId: 'a1' }], 'w1')
    render(<AccountsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /switch account/i }))
    expect(screen.getByText(/viewer/i)).toBeTruthy()
  })

  it('hides rename/delete affordances for a viewer workspace', () => {
    useStore.getState().setAccounts([{ id: 'a1', email: 'me@x.com' }])
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Shared', role: 'viewer', synced: true, accountId: 'a1' }], 'w1')
    render(<AccountsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /switch account/i }))
    expect(screen.queryByRole('button', { name: /^rename$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull()
  })

  it('shows rename/delete for an owner workspace', () => {
    useStore.getState().setAccounts([{ id: 'a1', email: 'me@x.com' }])
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Mine', role: 'owner', synced: true, accountId: 'a1' }], 'w1')
    render(<AccountsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /switch account/i }))
    expect(screen.getByRole('button', { name: /^rename$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy()
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
