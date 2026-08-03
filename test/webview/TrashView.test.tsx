import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore } from '../../src/webview/state/store'
const posted: any[] = []
vi.mock('../../src/webview/ipc', () => ({ postToHost: (m: any) => posted.push(m), onHostMessage: () => () => {}, getUiState: (_k: string, fb: any) => fb, setUiState: () => {} }))
import { TrashView } from '../../src/webview/views/Trash/TrashView'
beforeEach(() => { useStore.getState().__reset(); posted.length = 0 })

describe('TrashView', () => {
  it('shows the empty state', () => {
    render(<TrashView />)
    expect(screen.getByText(/trash is empty/i)).toBeInTheDocument()
  })
  it('Empty trash asks to confirm, then posts emptyTrash', () => {
    useStore.getState().setTrash([
      { id: 'e1', at: 1, workspaceId: 'w1', kind: 'request', data: { id: 'r1', name: 'Get', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } } as any, path: { collectionId: 'c1', collectionName: 'C' } },
    ])
    render(<TrashView />)
    fireEvent.click(screen.getByRole('button', { name: /empty trash/i }))
    expect(posted).not.toContainEqual({ type: 'emptyTrash' }) // confirm first
    fireEvent.click(screen.getByRole('button', { name: /empty all/i }))
    expect(posted).toContainEqual({ type: 'emptyTrash' })
  })
  it('has no Empty trash button when the trash is empty', () => {
    render(<TrashView />)
    expect(screen.queryByRole('button', { name: /empty trash/i })).toBeNull()
  })
  it('nests a trashed request under its collection/folder and restores/purges it', () => {
    useStore.getState().setTrash([
      { id: 'e1', at: 1, workspaceId: 'w1', kind: 'request', data: { id: 'r1', name: 'Get', method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } } as any, path: { collectionId: 'c1', collectionName: 'C', folderId: 'f1', folderName: 'F' } },
    ])
    render(<TrashView />)
    // collapsed: request hidden until the collection + folder are expanded
    expect(screen.queryByText('Get')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /toggle C/i }))
    fireEvent.click(screen.getByRole('button', { name: /toggle F/i }))
    expect(screen.getByText('Get')).toBeInTheDocument()
    expect(document.querySelector('.rm-method--GET')).toBeTruthy()   // method badge like collections
    fireEvent.click(screen.getByRole('button', { name: /restore Get/i }))
    expect(posted).toContainEqual({ type: 'restoreTrash', entryId: 'e1' })
    fireEvent.click(screen.getByRole('button', { name: /delete forever Get/i }))
    expect(posted).toContainEqual({ type: 'purgeTrash', entryId: 'e1' })
  })

  it('merges two requests deleted from the same folder into one tree', () => {
    const mk = (id: string) => ({ id, at: 1, workspaceId: 'w1', kind: 'request' as const, data: { id, name: id, method: 'GET', url: 'u', params: [], headers: [], body: { mode: 'none' } } as any, path: { collectionId: 'c1', collectionName: 'test', folderId: 'f1', folderName: 'user' } })
    useStore.getState().setTrash([mk('a'), mk('b')])
    render(<TrashView />)
    // one collection node, not two flat rows
    expect(screen.getAllByRole('button', { name: /toggle test/i })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /toggle test/i }))
    fireEvent.click(screen.getByRole('button', { name: /toggle user/i }))
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
  })
  it('expands a trashed collection and restores individual nodes', () => {
    useStore.getState().setTrash([
      { id: 'e2', at: 1, workspaceId: 'w1', kind: 'collection', data: { id: 'c1', name: 'API', workspaceId: 'w1', requests: [{ id: 'r0', name: 'Root Req' } as any], folders: [{ id: 'f1', name: 'Auth', requests: [{ id: 'r1', name: 'Login' } as any] }] } as any },
    ])
    render(<TrashView />)
    // children hidden until expanded
    expect(screen.queryByText('Auth')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /toggle API/i }))
    expect(screen.getByText('Auth')).toBeInTheDocument()
    expect(screen.getByText('Root Req')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /toggle Auth/i }))
    expect(screen.getByText('Login')).toBeInTheDocument()

    // restore just the Auth folder → collection stays in trash
    fireEvent.click(screen.getByRole('button', { name: /restore Auth/i }))
    expect(posted).toContainEqual({ type: 'restoreTrash', entryId: 'e2', folderId: 'f1' })
    // restore a single request inside the folder
    fireEvent.click(screen.getByRole('button', { name: /restore Login/i }))
    expect(posted).toContainEqual({ type: 'restoreTrash', entryId: 'e2', folderId: 'f1', requestId: 'r1' })
    // restore a collection-root request
    fireEvent.click(screen.getByRole('button', { name: /restore Root Req/i }))
    expect(posted).toContainEqual({ type: 'restoreTrash', entryId: 'e2', requestId: 'r0' })
    // whole-collection restore
    fireEvent.click(screen.getByRole('button', { name: /restore API/i }))
    expect(posted).toContainEqual({ type: 'restoreTrash', entryId: 'e2' })
  })
})
