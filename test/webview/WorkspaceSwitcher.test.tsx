import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({ postToHost: (m: any) => posted.push(m), onHostMessage: () => () => {} }))
import { WorkspaceSwitcher } from '../../src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

// Open the combo dropdown by clicking the input.
const openList = () => fireEvent.click(screen.getByRole('textbox'))

describe('WorkspaceSwitcher', () => {
  it('lists workspaces and reflects the active one', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Default' }, { id: 'w2', name: 'Team' }], 'w2')
    render(<WorkspaceSwitcher />)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Team')
  })
  it('picking a workspace posts setActiveWorkspace', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Default' }, { id: 'w2', name: 'Team' }], 'w1')
    render(<WorkspaceSwitcher />)
    openList()
    fireEvent.click(screen.getByRole('button', { name: 'Team' }))
    expect(posted).toContainEqual({ type: 'setActiveWorkspace', id: 'w2' })
  })
  it('New Workspace posts createWorkspace', () => {
    render(<WorkspaceSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /new workspace/i }))
    expect(posted).toContainEqual({ type: 'createWorkspace', name: 'New Workspace' })
  })
  it('rename via the edit icon posts renameWorkspace', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Dev' }], 'w1')
    render(<WorkspaceSwitcher />)
    openList()
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    fireEvent.change(screen.getByLabelText('rename input'), { target: { value: 'Prod' } })
    fireEvent.keyDown(screen.getByLabelText('rename input'), { key: 'Enter' })
    expect(posted).toContainEqual({ type: 'renameWorkspace', id: 'w1', name: 'Prod' })
  })
  it('delete via the trash icon posts deleteWorkspace with that workspace id', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Default' }, { id: 'w2', name: 'Team' }], 'w2')
    render(<WorkspaceSwitcher />)
    openList()
    // second item is 'Team' (w2); its delete icon is the second /delete/i button
    const deleteBtns = screen.getAllByRole('button', { name: /delete/i })
    fireEvent.click(deleteBtns[1])
    expect(posted).toContainEqual({ type: 'deleteWorkspace', id: 'w2' })
  })
  it('import icon posts importCollection', () => {
    render(<WorkspaceSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /import collection/i }))
    expect(posted).toContainEqual({ type: 'importCollection' })
  })
})
