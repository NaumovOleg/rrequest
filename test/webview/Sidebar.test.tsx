import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
import { newId } from '../../src/shared/types'

const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: () => () => {},
}))

import { Sidebar } from '../../src/webview/views/Sidebar/Sidebar'

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
    fireEvent.click(screen.getByRole('button', { name: /collection settings C/i }))
    fireEvent.click(screen.getByText(/export postman/i))
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

  it('renders a method badge for a request row', () => {
    const request = { id: 'r1', name: 'Get Users', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setTree([{ id: 'c1', name: 'My Coll', workspaceId: 'w1', requests: [request] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('My Coll'))
    expect(document.querySelector('.rm-method--GET')).toBeTruthy()
  })

  it('pressing Enter on a focused request row posts openRequest (keyboard operable)', () => {
    const request = { id: newId(), name: 'Get Users', method: 'GET' as const, url: 'https://api/users', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setTree([{ id: 'c1', name: 'My Coll', workspaceId: 'w1', requests: [request] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('My Coll'))
    fireEvent.keyDown(screen.getByText('Get Users'), { key: 'Enter' })
    expect(posted).toContainEqual({ type: 'openRequest', request })
  })

  it('renders folders and their requests when expanded', () => {
    const folderReq = { id: 'fr', name: 'In Folder', method: 'POST' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'Auth', requests: [folderReq] }] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('C'))            // expand collection
    fireEvent.click(screen.getByText('Auth'))          // expand folder
    expect(screen.getByText('In Folder')).toBeInTheDocument()
  })
  it('new folder icon posts createFolder', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('C'))
    fireEvent.click(screen.getByRole('button', { name: /new folder in C/i }))
    expect(posted).toContainEqual({ type: 'createFolder', collectionId: 'c1', name: 'New Folder' })
  })
  it('delete collection via settings popup posts deleteCollection', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /collection settings C/i }))
    fireEvent.click(screen.getByText(/^delete$/i))
    expect(posted).toContainEqual({ type: 'deleteCollection', id: 'c1' })
  })
  it('collection settings popup has Rename and posts export native', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /collection settings C/i }))
    fireEvent.click(screen.getByText(/export native/i))
    expect(posted).toContainEqual({ type: 'exportCollection', id: 'c1', format: 'native' })
  })
  it('collection settings Rename enters inline rename mode', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /collection settings C/i }))
    fireEvent.click(screen.getByText(/^rename$/i))
    fireEvent.change(screen.getByLabelText('rename input'), { target: { value: 'Renamed' } })
    fireEvent.keyDown(screen.getByLabelText('rename input'), { key: 'Enter' })
    expect(posted).toContainEqual({ type: 'renameCollection', id: 'c1', name: 'Renamed' })
  })
  it('request row has no delete icon (rename only)', () => {
    const r = { id: 'r1', name: 'Req', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [r], folders: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('C'))
    expect(screen.getByRole('button', { name: /rename request Req/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /delete request Req/i })).toBeNull()
  })
  it('dropping a request on a folder posts moveRequest', () => {
    const r = { id: 'r1', name: 'Req', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [r], folders: [{ id: 'f1', name: 'F', requests: [] }] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('C'))
    const folderRow = screen.getByText('F').closest('.rm-tree-row')!
    const data: any = { types: ['application/json'], getData: () => JSON.stringify({ fromCollectionId: 'c1', fromFolderId: null, requestId: 'r1' }), setData: () => {} }
    fireEvent.drop(folderRow, { dataTransfer: data })
    expect(posted).toContainEqual({ type: 'moveRequest', fromCollectionId: 'c1', fromFolderId: null, requestId: 'r1', toCollectionId: 'c1', toFolderId: 'f1' })
  })
  it('rename request via edit icon posts renameRequest', () => {
    const r = { id: 'r1', name: 'Req', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [r], folders: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('C'))
    fireEvent.click(screen.getByRole('button', { name: /rename request Req/i }))
    fireEvent.change(screen.getByLabelText('rename input'), { target: { value: 'Renamed' } })
    fireEvent.keyDown(screen.getByLabelText('rename input'), { key: 'Enter' })
    expect(posted).toContainEqual({ type: 'renameRequest', collectionId: 'c1', folderId: null, requestId: 'r1', name: 'Renamed' })
  })

  it('renaming a collection does not toggle it when Enter commits the rename', () => {
    const request = { id: 'r1', name: 'Get Users', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setTree([{ id: 'c1', name: 'My Coll', workspaceId: 'w1', requests: [request] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /collection settings My Coll/i }))
    fireEvent.click(screen.getByText(/^rename$/i))
    fireEvent.change(screen.getByLabelText('rename input'), { target: { value: 'New Folder Name' } })
    fireEvent.keyDown(screen.getByLabelText('rename input'), { key: 'Enter' })

    expect(posted.filter((m) => m.type === 'renameCollection')).toHaveLength(1)
    expect(posted).toContainEqual({ type: 'renameCollection', id: 'c1', name: 'New Folder Name' })
    // The collection should still be collapsed — the Enter keydown must not have
    // bubbled to the row's own onKeyDown handler and toggled it open.
    expect(screen.queryByText('Get Users')).toBeNull()
  })
})
