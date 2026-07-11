import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
import { newId } from '../../src/shared/types'
import { Sidebar } from '../../src/webview/components/Sidebar/Sidebar'

beforeEach(() => useStore.getState().__reset())

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
})
