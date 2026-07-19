import { useState, type DragEvent } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { newId, type Collection, type Folder, type RestRequest } from '../../../shared/types'
import { MethodBadge } from '../../elements/MethodBadge'
import { IconButton } from '../../elements/IconButton'
import { PopupMenu } from '../../elements/PopupMenu'
import { RenameInput } from '../../elements/RenameInput'

function blankRequest(): RestRequest {
  return { id: newId(), name: 'New Request', method: 'GET', url: '', params: [], headers: [], body: { mode: 'none' }, preRequestScript: '', testScript: '' }
}

export function Sidebar() {
  const tree = useStore((s) => s.tree)
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set())
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const dropHandlers = (dropKey: string, toCollectionId: string, toFolderId: string | null) => ({
    onDragOver: (e: DragEvent) => { e.preventDefault(); setDropTarget(dropKey) },
    onDragLeave: () => setDropTarget((cur) => (cur === dropKey ? null : cur)),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      setDropTarget(null)
      const raw = e.dataTransfer.getData('application/json')
      if (!raw) return
      const p = JSON.parse(raw) as { fromCollectionId: string; fromFolderId: string | null; requestId: string }
      postToHost({ type: 'moveRequest', ...p, toCollectionId, toFolderId })
    },
  })

  const toggleCollection = (id: string) =>
    setExpandedCollections((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  const toggleFolder = (key: string) =>
    setExpandedFolders((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })

  const openExisting = (r: RestRequest, collectionId: string, folderId: string | null) => {
    if (folderId) postToHost({ type: 'openRequest', request: r, targetCollectionId: collectionId, targetFolderId: folderId })
    else postToHost({ type: 'openRequest', request: r })
  }

  const renderRequestRow = (r: RestRequest, collectionId: string, folderId: string | null) => {
    const isRenaming = renamingId === r.id
    const activate = () => openExisting(r, collectionId, folderId)
    return (
      <div key={r.id} className="rm-req-row" role="button" tabIndex={0}
        draggable={!isRenaming}
        onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify({ fromCollectionId: collectionId, fromFolderId: folderId, requestId: r.id }))}
        onClick={activate}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() } }}>
        <MethodBadge method={r.method} />{' '}
        {isRenaming
          ? <RenameInput initial={r.name}
              onCommit={(name) => { postToHost({ type: 'renameRequest', collectionId, folderId, requestId: r.id, name }); setRenamingId(null) }}
              onCancel={() => setRenamingId(null)} />
          : <span>{r.name}</span>}
        <div className="rm-actions">
          <IconButton icon="edit" label={`rename request ${r.name}`} onClick={() => setRenamingId(r.id)} />
        </div>
      </div>
    )
  }

  const renderFolder = (c: Collection, f: Folder) => {
    const key = `${c.id}/${f.id}`
    const isExpanded = expandedFolders.has(key)
    const isRenaming = renamingId === f.id
    return (
      <div key={f.id}>
        <div className={`rm-tree-row${dropTarget === key ? ' rm-drop-over' : ''}`} role="button" tabIndex={0}
          onClick={() => toggleFolder(key)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFolder(key) } }}
          {...dropHandlers(key, c.id, f.id)}>
          <span className="rm-tree-caret" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>{' '}
          <span className={`codicon codicon-folder${isExpanded ? '-opened' : ''}`} aria-hidden="true" />{' '}
          {isRenaming
            ? <RenameInput initial={f.name}
                onCommit={(name) => { postToHost({ type: 'renameFolder', collectionId: c.id, folderId: f.id, name }); setRenamingId(null) }}
                onCancel={() => setRenamingId(null)} />
            : <span>{f.name}</span>}
          <div className="rm-actions">
            <IconButton icon="edit" label={`rename folder ${f.name}`} onClick={() => setRenamingId(f.id)} />
            <IconButton icon="trash" label={`delete folder ${f.name}`}
              onClick={() => postToHost({ type: 'deleteFolder', collectionId: c.id, folderId: f.id })} />
            <IconButton icon="add" label={`add request to ${f.name}`}
              onClick={() => postToHost({ type: 'openRequest', request: blankRequest(), targetCollectionId: c.id, targetFolderId: f.id })} />
          </div>
        </div>
        {isExpanded && (
          <div className="rm-tree-children">
            {f.requests.map((r) => renderRequestRow(r, c.id, f.id))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rm-panel" style={{ minWidth: 220 }}>
      <div className="rm-section">
        <div className="rm-row">
          <span className="rm-section-title">Collections</span>
          <div className="rm-actions">
            <IconButton icon="add" label="New Request" onClick={() => postToHost({ type: 'openRequest', request: blankRequest() })} />
            <IconButton icon="cloud-upload" label="Import" onClick={() => postToHost({ type: 'importCollection' })} />
            <IconButton icon="add" label="New Collection" onClick={() => postToHost({ type: 'createCollection', name: 'New Collection' })} />
          </div>
        </div>
      </div>
      <div className="rm-tree">
        {tree.map((c) => {
          const isExpanded = expandedCollections.has(c.id)
          const isRenaming = renamingId === c.id
          const folders = c.folders ?? []
          return (
            <div key={c.id}>
              <div className={`rm-tree-row${dropTarget === c.id ? ' rm-drop-over' : ''}`} role="button" tabIndex={0}
                onClick={() => toggleCollection(c.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollection(c.id) } }}
                {...dropHandlers(c.id, c.id, null)}>
                <span className="rm-tree-caret" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>{' '}
                {isRenaming
                  ? <RenameInput initial={c.name}
                      onCommit={(name) => { postToHost({ type: 'renameCollection', id: c.id, name }); setRenamingId(null) }}
                      onCancel={() => setRenamingId(null)} />
                  : <span>{c.name}</span>}
                <div className="rm-actions">
                  <IconButton icon="new-folder" label={`new folder in ${c.name}`}
                    onClick={() => postToHost({ type: 'createFolder', collectionId: c.id, name: 'New Folder' })} />
                  <IconButton icon="add" label={`add request to ${c.name}`}
                    onClick={() => postToHost({ type: 'openRequest', request: blankRequest(), targetCollectionId: c.id, targetFolderId: null })} />
                  <PopupMenu icon="gear" label={`collection settings ${c.name}`} items={[
                    { label: 'Rename', icon: 'edit', onClick: () => setRenamingId(c.id) },
                    { label: 'Delete', icon: 'trash', onClick: () => postToHost({ type: 'deleteCollection', id: c.id }) },
                    { label: 'Export native', icon: 'cloud-download', onClick: () => postToHost({ type: 'exportCollection', id: c.id, format: 'native' }) },
                    { label: 'Export postman', icon: 'json', onClick: () => postToHost({ type: 'exportCollection', id: c.id, format: 'postman' }) },
                  ]} />
                </div>
              </div>
              {isExpanded && (
                <div className="rm-tree-children">
                  {folders.map((f) => renderFolder(c, f))}
                  {c.requests.map((r) => renderRequestRow(r, c.id, null))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
