import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({ postToHost: (m: any) => posted.push(m), onHostMessage: () => () => {} }))
import { WorkspaceSwitcher } from '../../src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

// Open the popup by focusing/clicking the switcher's combined trigger+search input.
const openList = () => fireEvent.click(screen.getByRole('textbox'))

// Find the row for a given workspace name so tests don't rely on DOM order,
// which shifts as workspaces move between the Recently Visited / More Workspaces sections.
const rowFor = (name: string) => screen.getByText(name).closest('.rm-ws-row') as HTMLElement

describe('WorkspaceSwitcher', () => {
  it('lists workspaces and reflects the active one', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Default' }, { id: 'w2', name: 'Team' }], 'w2')
    render(<WorkspaceSwitcher />)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Team')
    openList()
    expect(screen.getByTestId('active-workspace')).toHaveTextContent('Team')
  })
  it('shows a Share button for a signed-in owner and opens the members panel', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Default', role: 'owner', synced: true }], 'w1')
    useStore.getState().setAuthEmail('me@x.com')
    render(<WorkspaceSwitcher />)
    const share = screen.getByRole('button', { name: /share/i })
    fireEvent.click(share)
    expect(posted).toContainEqual({ type: 'openMembers', workspaceId: 'w1' })
  })
  it('hides the Share button for a viewer', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Shared', role: 'viewer', synced: true }], 'w1')
    useStore.getState().setAuthEmail('me@x.com')
    render(<WorkspaceSwitcher />)
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull()
  })
  it('picking a workspace posts setActiveWorkspace', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Default' }, { id: 'w2', name: 'Team' }], 'w1')
    render(<WorkspaceSwitcher />)
    openList()
    fireEvent.click(within(rowFor('Team')).getByText('Team'))
    expect(posted).toContainEqual({ type: 'setActiveWorkspace', id: 'w2' })
  })
  it('Create Workspace posts createWorkspace', () => {
    render(<WorkspaceSwitcher />)
    openList()
    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }))
    expect(posted).toContainEqual({ type: 'createWorkspace', name: 'New Workspace' })
  })
  it('rename via the edit icon posts renameWorkspace', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Dev' }], 'w1')
    render(<WorkspaceSwitcher />)
    openList()
    fireEvent.click(within(rowFor('Dev')).getByRole('button', { name: /edit/i }))
    fireEvent.change(screen.getByLabelText('rename input'), { target: { value: 'Prod' } })
    fireEvent.keyDown(screen.getByLabelText('rename input'), { key: 'Enter' })
    expect(posted).toContainEqual({ type: 'renameWorkspace', id: 'w1', name: 'Prod' })
  })
  it('delete via the trash icon posts deleteWorkspace with that workspace id', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Default' }, { id: 'w2', name: 'Team' }], 'w2')
    render(<WorkspaceSwitcher />)
    openList()
    fireEvent.click(within(rowFor('Team')).getByRole('button', { name: /delete/i }))
    // a confirm modal appears; deletion only fires after typing the exact name
    fireEvent.click(screen.getByRole('button', { name: /delete workspace/i }))
    expect(posted).not.toContainEqual({ type: 'deleteWorkspace', id: 'w2' }) // still disabled
    fireEvent.change(screen.getByLabelText(/confirm workspace name/i), { target: { value: 'Team' } })
    fireEvent.click(screen.getByRole('button', { name: /delete workspace/i }))
    expect(posted).toContainEqual({ type: 'deleteWorkspace', id: 'w2' })
  })
  it('import icon posts importCollection', () => {
    render(<WorkspaceSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /import collection/i }))
    expect(posted).toContainEqual({ type: 'importCollection' })
  })
})
