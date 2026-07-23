import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceSwitcher } from '../../src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher'
import { useStore } from '../../src/webview/state/store'
import * as ipc from '../../src/webview/ipc'

beforeEach(() => useStore.getState().__reset())

describe('sync toggle', () => {
  it('signed in + not synced → Enable Sync posts enableSync', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setAuthEmail('me@x.com')
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'W' }], 'w1')
    render(<WorkspaceSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /enable sync/i }))
    expect(post).toHaveBeenCalledWith({ type: 'enableSync', workspaceId: 'w1' })
  })
  it('signed in + synced → Sync Now posts syncNow', () => {
    const post = vi.spyOn(ipc, 'postToHost').mockImplementation(() => {})
    useStore.getState().setAuthEmail('me@x.com')
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'W', role: 'owner', synced: true }], 'w1')
    render(<WorkspaceSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /sync now/i }))
    expect(post).toHaveBeenCalledWith({ type: 'syncNow', workspaceId: 'w1' })
  })
  it('signed out → no sync control', () => {
    useStore.getState().setAuthEmail(null)
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'W' }], 'w1')
    render(<WorkspaceSwitcher />)
    expect(screen.queryByRole('button', { name: /enable sync|sync now/i })).toBeNull()
  })
})
