import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
import { newId } from '../../src/shared/types'

const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: () => () => {},
}))

import { Sidebar } from '../../src/webview/components/Sidebar/Sidebar'

beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('Sidebar', () => {
  it('lists collections and opens a request as a tab on click', () => {
    useStore.getState().setTree([{
      id: 'c1', name: 'My Coll',
      requests: [{ id: newId(), name: 'Get Users', method: 'GET', url: 'https://api/users', params: [], headers: [], body: { mode: 'none' } }],
    }])
    render(<Sidebar />)
    expect(screen.getByText('My Coll')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Get Users'))
    const s = useStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0].url).toBe('https://api/users')
  })

  it('lists history and opens an entry as a tab on click', () => {
    useStore.getState().setHistory([{
      id: 'h1',
      request: { id: 'r1', name: 'H', method: 'GET', url: 'https://api/hist', params: [], headers: [], body: { mode: 'none' } },
      status: 200,
      at: 1,
    }])
    render(<Sidebar />)
    expect(screen.getByText('History')).toBeInTheDocument()
    const entryButton = screen.getByText('GET https://api/hist')
    expect(entryButton).toBeInTheDocument()
    fireEvent.click(entryButton)
    const s = useStore.getState()
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0].url).toBe('https://api/hist')
  })

  it('renders the Environments section', () => {
    render(<Sidebar />)
    expect(screen.getByText('Environments')).toBeInTheDocument()
  })

  it('Import button posts importCollection', () => {
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    expect(posted).toContainEqual({ type: 'importCollection' })
  })

  it('Export posts exportCollection with the collection id and format', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', requests: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /export postman for C/i }))
    expect(posted).toContainEqual({ type: 'exportCollection', id: 'c1', format: 'postman' })
  })
})
