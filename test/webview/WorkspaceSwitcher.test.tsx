import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({ postToHost: (m: any) => posted.push(m), onHostMessage: () => () => {} }))
import { WorkspaceSwitcher } from '../../src/webview/components/WorkspaceSwitcher/WorkspaceSwitcher'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('WorkspaceSwitcher', () => {
  it('lists workspaces and reflects the active one', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Default' }, { id: 'w2', name: 'Team' }], 'w2')
    render(<WorkspaceSwitcher />)
    expect((screen.getByLabelText(/active workspace/i) as HTMLSelectElement).value).toBe('w2')
  })
  it('changing posts setActiveWorkspace', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Default' }, { id: 'w2', name: 'Team' }], 'w1')
    render(<WorkspaceSwitcher />)
    fireEvent.change(screen.getByLabelText(/active workspace/i), { target: { value: 'w2' } })
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
    fireEvent.click(screen.getByRole('button', { name: /rename workspace/i }))
    fireEvent.change(screen.getByLabelText('rename input'), { target: { value: 'Prod' } })
    fireEvent.keyDown(screen.getByLabelText('rename input'), { key: 'Enter' })
    expect(posted).toContainEqual({ type: 'renameWorkspace', id: 'w1', name: 'Prod' })
  })
  it('Delete Workspace posts deleteWorkspace with active id', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Default' }, { id: 'w2', name: 'Team' }], 'w2')
    render(<WorkspaceSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(posted).toContainEqual({ type: 'deleteWorkspace', id: 'w2' })
  })
  it('Environments text button posts openEnvironments and new environment icon is gone', () => {
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Dev' }], 'w1')
    render(<WorkspaceSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: /environments/i }))
    expect(posted).toContainEqual({ type: 'openEnvironments' })
    expect(screen.queryByRole('button', { name: /new environment/i })).toBeNull()
  })
})
