import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Members } from '../../src/webview/views/Members/Members'
import { useStore } from '../../src/webview/state/store'
import * as ipc from '../../src/webview/ipc'

beforeEach(() => useStore.getState().__reset())

describe('Members view', () => {
  it('loads members on mount and renders the list', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'W', role: 'owner', synced: true }], 'w1')
    useStore.getState().setMembersWorkspaceId('w1')
    useStore.getState().setMembers([{ email: 'o@x.com', role: 'owner', pending: false }, { id: 'm1', email: 'e@x.com', role: 'editor', pending: false }])
    render(<Members />)
    expect(post).toHaveBeenCalledWith({ type: 'loadMembers', workspaceId: 'w1' })
    expect(screen.getByText('e@x.com')).toBeTruthy()
  })

  it('Send Invite posts addMember with the typed email + role (synced owner)', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'W', role: 'owner', synced: true }], 'w1')
    useStore.getState().setMembersWorkspaceId('w1')
    render(<Members />)
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'new@x.com' } })
    fireEvent.click(screen.getByText(/send invite/i))
    expect(post).toHaveBeenCalledWith({ type: 'addMember', workspaceId: 'w1', email: 'new@x.com', role: 'editor' })
  })

  it('shows management for a SYNCED owner even when the webview role is unknown (stale cache)', () => {
    vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    // role undefined but synced -> the invite form must still appear
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'W', synced: true }], 'w1')
    useStore.getState().setMembersWorkspaceId('w1')
    render(<Members />)
    expect(screen.getByText(/send invite/i)).toBeTruthy()
  })

  it('hides management for a viewer (server is the real gate anyway)', () => {
    vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'W', role: 'viewer', synced: true }], 'w1')
    useStore.getState().setMembersWorkspaceId('w1')
    render(<Members />)
    expect(screen.queryByText(/send invite/i)).toBeNull()
  })

  it('prompts to Enable Sync for a local (not-yet-synced) workspace', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'W' }], 'w1') // no role, not synced
    useStore.getState().setAuthEmail('me@x.com')
    useStore.getState().setMembersWorkspaceId('w1')
    render(<Members />)
    expect(screen.queryByText(/send invite/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /enable sync/i }))
    expect(post).toHaveBeenCalledWith({ type: 'enableSync', workspaceId: 'w1' })
  })
})
