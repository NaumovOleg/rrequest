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
  it('lists collections and posts openRequest when a request is clicked', () => {
    const request = { id: newId(), name: 'Get Users', method: 'GET' as const, url: 'https://api/users', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setTree([{ id: 'c1', name: 'My Coll', workspaceId: 'w1', requests: [request] }])
    render(<Sidebar />)
    expect(screen.getByText('My Coll')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Get Users'))
    expect(posted).toContainEqual({ type: 'openRequest', request })
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
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: '', requests: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /export postman for C/i }))
    expect(posted).toContainEqual({ type: 'exportCollection', id: 'c1', format: 'postman' })
  })
})
