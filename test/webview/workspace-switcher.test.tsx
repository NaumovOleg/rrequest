import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
vi.mock('../../src/webview/ipc', () => ({ postToHost: () => {}, onHostMessage: () => () => {} }))
import { WorkspaceSwitcher } from '../../src/webview/views/WorkspaceSwitcher/WorkspaceSwitcher'
import { useStore } from '../../src/webview/state/store'

beforeEach(() => useStore.getState().__reset())

describe('WorkspaceSwitcher popup', () => {
  it('filters workspaces by the search box', () => {
    useStore.getState().setWorkspaces([{ id: 'a', name: 'Alpha', role: 'owner' }, { id: 'b', name: 'Beta', role: 'editor' }], 'a')
    render(<WorkspaceSwitcher />)
    // open the popup, then type into the search box
    fireEvent.click(screen.getByLabelText(/workspaces|switch/i))
    fireEvent.change(screen.getByPlaceholderText(/search workspaces/i), { target: { value: 'bet' } })
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('shows section headers and flags the active row', () => {
    useStore.getState().setWorkspaces([{ id: 'a', name: 'Alpha', role: 'owner' }, { id: 'b', name: 'Beta', role: 'editor' }], 'a')
    render(<WorkspaceSwitcher />)
    fireEvent.click(screen.getByLabelText(/workspaces|switch/i))
    expect(screen.getByText('Recently Visited')).toBeTruthy()
    expect(screen.getByText('More Workspaces')).toBeTruthy()
    expect(screen.getByTestId('active-workspace')).toHaveTextContent('Alpha')
  })

  it('picking a row from the popup selects that workspace', () => {
    useStore.getState().setWorkspaces([{ id: 'a', name: 'Alpha', role: 'owner' }, { id: 'b', name: 'Beta', role: 'editor' }], 'a')
    render(<WorkspaceSwitcher />)
    fireEvent.click(screen.getByLabelText(/workspaces|switch/i))
    fireEvent.click(screen.getByText('Beta'))
    // popup closes after a pick
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
