import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
import { newId } from '../../src/shared/types'

const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: () => () => {},
  getUiState: (_k: string, fallback: any) => fallback,
  setUiState: () => {},
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
    expect(posted).toContainEqual({ type: 'openRequest', request, targetCollectionId: 'c1', targetFolderId: null })
  })

  it('add collection button posts createCollection', () => {
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /add collection/i }))
    expect(posted).toContainEqual({ type: 'createCollection', name: 'New Collection' })
  })

  it('Export posts exportCollection with the collection id and format', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: '', requests: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /collection settings C/i }))
    // "Export" is the section header; the rows are just the formats.
    expect(screen.getByText('Export')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Postman'))
    expect(posted).toContainEqual({ type: 'exportCollection', id: 'c1', format: 'postman' })
  })

  it('gear menu marks the bound environment and offers None to unbind', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], environmentId: 'e2' }])
    useStore.getState().setEnvironments([
      { id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [] },
      { id: 'e2', name: 'Prod', workspaceId: 'w1', variables: [] },
    ])
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /collection settings C/i }))
    expect(screen.getByRole('menuitem', { name: /Prod/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitem', { name: /Dev/ })).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByText('None'))
    expect(posted).toContainEqual({ type: 'setCollectionEnvironment', collectionId: 'c1', environmentId: null })
  })

  it('gear menu lists the other writable workspaces and posts moveCollection', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }])
    useStore.getState().setWorkspaces([
      { id: 'w1', name: 'Local' },
      { id: 'w2', name: 'Team', synced: true, accountEmail: 'me@x.com' },
      { id: 'w3', name: 'ReadOnly', synced: true, role: 'viewer' },
    ], 'w1')
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /collection settings C/i }))
    expect(screen.queryByText(/ReadOnly/)).not.toBeInTheDocument() // viewer workspace isn't a target
    expect(screen.queryByText(/^\s*Local$/)).not.toBeInTheDocument() // nor the current one
    // destination name is the label, its account a muted hint beside it
    expect(screen.getByText('me@x.com')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Team'))
    expect(posted).toContainEqual({ type: 'moveCollection', id: 'c1', toWorkspaceId: 'w2' })
  })

  it('gear menu hides the move section when there is nowhere to move to', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }])
    useStore.getState().setWorkspaces([{ id: 'w1', name: 'Local' }], 'w1')
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /collection settings C/i }))
    expect(screen.queryByText(/move to workspace/i)).not.toBeInTheDocument()
  })

  it('collections collapse/expand: requests hidden until the collection is clicked', () => {
    const request = { id: 'r1', name: 'Get Users', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setTree([{ id: 'c1', name: 'My Coll', workspaceId: 'w1', requests: [request] }])
    render(<Sidebar />)
    expect(screen.queryByText('Get Users')).toBeNull()          // collapsed by default
    fireEvent.click(screen.getByText('My Coll'))
    expect(screen.getByText('Get Users')).toBeInTheDocument()   // expanded
  })

  it('+ Request on a collection posts createRequest with that collection as target', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'My Coll', workspaceId: 'w1', requests: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('My Coll'))                 // expand to reveal + Request
    fireEvent.click(screen.getByRole('button', { name: /add request to My Coll/i }))
    const msg = posted.filter((m) => m.type === 'createRequest').pop()
    expect(msg.collectionId).toBe('c1')
    expect(msg.folderId).toBeNull()
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
    expect(posted).toContainEqual({ type: 'openRequest', request, targetCollectionId: 'c1', targetFolderId: null })
  })

  it('renders folders and their requests when expanded', () => {
    const folderReq = { id: 'fr', name: 'In Folder', method: 'POST' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'Auth', requests: [folderReq] }] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('C'))            // expand collection
    fireEvent.click(screen.getByText('Auth'))          // expand folder
    expect(screen.getByText('In Folder')).toBeInTheDocument()
  })
  it('+ Request in a folder posts createRequest and expands the folder', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'Auth', requests: [] }] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('C'))                     // expand collection to reveal folder
    fireEvent.click(screen.getByRole('button', { name: /add request to Auth/i }))
    const msg = posted.filter((m) => m.type === 'createRequest').pop()
    expect(msg).toMatchObject({ collectionId: 'c1', folderId: 'f1' })
    expect(msg.request.name).toBe('New Request')
    // folder now expanded: after the tree re-render adds a request it would show;
    // simulate the tree update and confirm the folder stays open
    act(() => {
      useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'Auth', requests: [{ id: 'nr', name: 'New Request', method: 'GET', url: '', params: [], headers: [], body: { mode: 'none' } }] }] }])
    })
    expect(screen.getByText('New Request')).toBeInTheDocument()
  })
  it('binding an environment posts setCollectionEnvironment', () => {
    useStore.getState().setEnvironments([{ id: 'e1', name: 'Dev', workspaceId: 'w1', variables: [] }])
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /collection settings C/i }))
    fireEvent.click(screen.getByText(/^\s*Dev$/))
    expect(posted).toContainEqual({ type: 'setCollectionEnvironment', collectionId: 'c1', environmentId: 'e1' })
  })
  it('new folder icon posts createFolder', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('C'))
    fireEvent.click(screen.getByRole('button', { name: /new folder in C/i }))
    expect(posted).toContainEqual({ type: 'createFolder', collectionId: 'c1', name: 'New Folder' })
  })
  it('delete collection icon posts deleteCollection', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /delete collection C/i }))
    expect(posted).toContainEqual({ type: 'deleteCollection', id: 'c1' })
  })
  it('collection settings popup has Rename and posts export native', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /collection settings C/i }))
    fireEvent.click(screen.getByText('Native'))
    expect(posted).toContainEqual({ type: 'exportCollection', id: 'c1', format: 'native' })
  })
  it('rename collection icon enters inline rename mode', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [], folders: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /rename collection C/i }))
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
  it('renders gRPC and WebSocket items with a type badge and opens them', () => {
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [
      { id: 'g1', name: 'Greeter', kind: 'grpc', address: 'a', proto: 'p', service: 'S', method: 'M', message: '{}', metadata: [], plaintext: true } as any,
      { id: 'w1', name: 'Socket', kind: 'ws', url: 'wss://x', headers: [] } as any,
    ] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('C'))
    expect(screen.getByText('gRPC')).toBeInTheDocument()
    expect(screen.getByText('WS')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Greeter'))
    const msg = posted.filter((m) => m.type === 'openRequest').pop()
    expect(msg.request.id).toBe('g1')
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
  it('dropping a folder on another collection posts moveFolder', () => {
    useStore.getState().setTree([
      { id: 'c1', name: 'C1', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'F', requests: [] }] },
      { id: 'c2', name: 'C2', workspaceId: 'w1', requests: [], folders: [] },
    ])
    render(<Sidebar />)
    const c2Row = screen.getByText('C2').closest('.rm-tree-row')!
    const data: any = { types: ['application/json'], getData: () => JSON.stringify({ kind: 'folder', fromCollectionId: 'c1', folderId: 'f1' }), setData: () => {} }
    fireEvent.drop(c2Row, { dataTransfer: data })
    expect(posted).toContainEqual({ type: 'moveFolder', fromCollectionId: 'c1', toCollectionId: 'c2', folderId: 'f1' })
  })
  it('a folder cannot be dropped into a folder (no moveFolder)', () => {
    useStore.getState().setTree([
      { id: 'c1', name: 'C1', workspaceId: 'w1', requests: [], folders: [{ id: 'f1', name: 'F', requests: [] }, { id: 'f2', name: 'G', requests: [] }] },
    ])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('C1'))
    const folderRow = screen.getByText('G').closest('.rm-tree-row')!
    const data: any = { types: ['application/json'], getData: () => JSON.stringify({ kind: 'folder', fromCollectionId: 'c1', folderId: 'f1' }), setData: () => {} }
    fireEvent.drop(folderRow, { dataTransfer: data })
    expect(posted.filter((m) => m.type === 'moveFolder')).toHaveLength(0)
  })
  it('right-click on a request opens a menu that duplicates it', () => {
    const r = { id: 'r1', name: 'Req', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
    useStore.getState().setTree([{ id: 'c1', name: 'C', workspaceId: 'w1', requests: [r], folders: [] }])
    render(<Sidebar />)
    fireEvent.click(screen.getByText('C'))
    fireEvent.contextMenu(screen.getByText('Req'))
    fireEvent.click(screen.getByRole('menuitem', { name: /duplicate/i }))
    expect(posted).toContainEqual({ type: 'duplicateRequest', collectionId: 'c1', folderId: null, requestId: 'r1' })
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
    fireEvent.click(screen.getByRole('button', { name: /rename collection My Coll/i }))
    fireEvent.change(screen.getByLabelText('rename input'), { target: { value: 'New Folder Name' } })
    fireEvent.keyDown(screen.getByLabelText('rename input'), { key: 'Enter' })

    expect(posted.filter((m) => m.type === 'renameCollection')).toHaveLength(1)
    expect(posted).toContainEqual({ type: 'renameCollection', id: 'c1', name: 'New Folder Name' })
    // The collection should still be collapsed — the Enter keydown must not have
    // bubbled to the row's own onKeyDown handler and toggled it open.
    expect(screen.queryByText('Get Users')).toBeNull()
  })
})
