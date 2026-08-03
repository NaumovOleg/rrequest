import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
import { newId } from '../../src/shared/types'
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({ postToHost: (m: any) => posted.push(m), onHostMessage: () => () => {}, getUiState: (_k: string, fb: any) => fb, setUiState: () => {} }))
import { History } from '../../src/webview/components/History'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('History', () => {
  it('renders entries and clicking posts openRequest', () => {
    const request = { id: newId(), name: 'H', method: 'GET' as const, url: 'https://api/h', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setHistory([{ id: 'h1', workspaceId: 'w1', request, status: 200, at: 1 }])
    render(<History />)
    fireEvent.click(screen.getByText('H'))
    expect(posted).toContainEqual({ type: 'openRequest', request })
  })

  it('shows a method badge for a history entry', () => {
    const request = { id: 'r1', name: 'H', method: 'DELETE' as const, url: 'https://api/h', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setHistory([{ id: 'h1', workspaceId: 'w1', request, status: 200, at: 1 }])
    render(<History />)
    expect(document.querySelector('.rm-method--DELETE')).toBeTruthy()
  })

  it('groups by day and shows the response status', () => {
    const request = { id: 'r1', name: 'H', method: 'GET' as const, url: 'https://api/h', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setHistory([{ id: 'h1', workspaceId: 'w1', request, status: 404, at: Date.now() }])
    render(<History />)
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('404')).toBeInTheDocument()
  })
  it('shows an empty state when there is no history', () => {
    render(<History />)
    expect(screen.getByText(/no requests sent yet/i)).toBeInTheDocument()
  })

  it('pressing Enter on a focused history entry posts openRequest (keyboard operable)', () => {
    const request = { id: newId(), name: 'H', method: 'GET' as const, url: 'https://api/h', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setHistory([{ id: 'h1', workspaceId: 'w1', request, status: 200, at: 1 }])
    render(<History />)
    fireEvent.keyDown(screen.getByText('H'), { key: 'Enter' })
    expect(posted).toContainEqual({ type: 'openRequest', request })
  })
})
