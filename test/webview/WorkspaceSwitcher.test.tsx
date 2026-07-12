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
})
