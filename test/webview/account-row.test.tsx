import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { AccountsPanel } from '../../src/webview/views/AccountsPanel/AccountsPanel'
import { useStore } from '../../src/webview/state/store'
import * as ipc from '../../src/webview/ipc'

beforeEach(() => useStore.getState().__reset())

describe('AccountsPanel', () => {
  it('signed out → Add account posts signIn', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setAccounts([])
    render(<AccountsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /switch account/i }))
    fireEvent.click(screen.getByRole('button', { name: /add account/i }))
    expect(post).toHaveBeenCalledWith({ type: 'signIn' })
  })

  it('shows each account with a sign-out that carries its id', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setAccounts([{ id: 'a1', email: 'me@x.com' }])
    render(<AccountsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /switch account/i }))
    expect(screen.getByText('me@x.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /sign out me@x\.com/i }))
    expect(post).toHaveBeenCalledWith({ type: 'signOut', accountId: 'a1' })
  })

  it("nests each account's workspaces under it and selects on click", () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setAccounts([{ id: 'a1', email: 'me@x.com' }])
    useStore.getState().setWorkspaces([
      { id: 'w1', name: 'Owned', role: 'owner', synced: true, accountId: 'a1' },
      { id: 'wl', name: 'LocalWs' },
    ], 'w1')
    render(<AccountsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /switch account/i }))
    // both the account's synced workspace and the local one are listed in the popup
    expect(screen.getByRole('button', { name: 'LocalWs' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Owned' }))
    expect(post).toHaveBeenCalledWith({ type: 'setActiveWorkspace', id: 'w1' })
  })

  it('a local workspace with one account enables sync bound to that account', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setAccounts([{ id: 'a1', email: 'me@x.com' }])
    useStore.getState().setWorkspaces([{ id: 'wl', name: 'LocalWs' }], 'wl')
    render(<AccountsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /switch account/i }))
    const localRow = screen.getByRole('button', { name: 'LocalWs' }).closest('.rm-acct-ws') as HTMLElement
    fireEvent.click(within(localRow).getByRole('button', { name: /sync/i }))
    expect(post).toHaveBeenCalledWith({ type: 'enableSync', workspaceId: 'wl', accountId: 'a1' })
  })
})
