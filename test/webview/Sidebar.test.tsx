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
    fireEvent.click(screen.getByText('My Coll'))
    fireEvent.click(screen.getByText('Get Users'))
    expect(posted).toContainEqual({ type: 'openRequest', request })
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

  it('New Request posts openRequest with a blank request and no target', () => {
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /new request/i }))
    const msg = posted.find((m) => m.type === 'openRequest')
    expect(msg).toBeTruthy()
    expect(msg.request.name).toBe('New Request')
    expect(msg.targetCollectionId).toBeUndefined()
  })

  it('collections collapse/expand: requests hidden until the collection is clicked', () => {
    const request = { id: 'r1', name: 'Get Users', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setTree([{ id: 'c1', name: 'My Coll', workspaceId: 'w1', requests: [request] }])
    render(<Sidebar />)
    expect(screen.queryByText('Get Users')).toBeNull()          // collapsed by default
    fireEvent.click(screen.getByText('My Coll'))
    expect(screen.getByText('Get Users')).toBeInTheDocument()   // expanded
  })

  it('+ Request on a collection posts openRequest with that collection as target', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'My Coll', workspaceId: 'w1', requests: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('My Coll'))                 // expand to reveal + Request
    fireEvent.click(screen.getByRole('button', { name: /add request to My Coll/i }))
    const msg = posted.filter((m) => m.type === 'openRequest').pop()
    expect(msg.targetCollectionId).toBe('c1')
    expect(msg.request.name).toBe('New Request')
  })
})
