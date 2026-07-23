import { useState, useEffect, type DragEvent } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { newId, defaultHeaders, itemKind, type Collection, type CollectionItem, type Folder, type RestRequest } from '../../../shared/types'
import { MethodBadge } from '../../elements/MethodBadge'
import { IconButton } from '../../elements/IconButton'
import { PopupMenu } from '../../elements/PopupMenu'
import { RenameInput } from '../../elements/RenameInput'

function blankRequest(): RestRequest {
  return { id: newId(), name: 'New Request', method: 'GET', url: '', params: [], headers: defaultHeaders(), cookies: [], body: { mode: 'none' }, preRequestScript: '', testScript: '' }
}

type DragPayload =
  | { kind: 'request'; fromCollectionId: string; fromFolderId: string | null; requestId: string }
  | { kind: 'folder'; fromCollectionId: string; folderId: string }

export function Sidebar() {
  const tree = useStore((s) => s.tree)
  const environments = useStore((s) => s.environments)
  const isViewer = useStore((s) => s.isViewer())
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set())
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; collectionId: string; folderId: string | null; request: CollectionItem } | null>(null)

  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('contextmenu', close)
    }
  }, [ctx])

  const startDrag = (e: DragEvent, payload: DragPayload) =>
    e.dataTransfer.setData('application/json', JSON.stringify(payload))

  // A request can drop on a collection root or a folder; a folder can drop only
  // on a collection root (folders don't nest). A viewer can't rearrange the
  // shared tree, so dragging/dropping is a no-op for them.
  const dropHandlers = (dropKey: string, toCollectionId: string, toFolderId: string | null) => {
    if (isViewer) return {}
    return {
      onDragOver: (e: DragEvent) => { e.preventDefault(); setDropTarget(dropKey) },
      onDragLeave: () => setDropTarget((cur) => (cur === dropKey ? null : cur)),
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        setDropTarget(null)
        const raw = e.dataTransfer.getData('application/json')
        if (!raw) return
        const p = JSON.parse(raw) as DragPayload
        if (p.kind === 'folder') {
          if (toFolderId) return // can't drop a folder into a folder
          postToHost({ type: 'moveFolder', fromCollectionId: p.fromCollectionId, toCollectionId, folderId: p.folderId })
        } else {
          postToHost({ type: 'moveRequest', fromCollectionId: p.fromCollectionId, fromFolderId: p.fromFolderId, requestId: p.requestId, toCollectionId, toFolderId })
        }
      },
    }
  }

  const toggleCollection = (id: string) =>
    setExpandedCollections((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  const toggleFolder = (key: string) =>
    setExpandedFolders((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next })

  const openExisting = (r: CollectionItem, collectionId: string, folderId: string | null) =>
    postToHost({ type: 'openRequest', request: r, targetCollectionId: collectionId, targetFolderId: folderId })

  const expandCollection = (id: string) => setExpandedCollections((prev) => new Set(prev).add(id))
  const expandFolder = (key: string) => setExpandedFolders((prev) => new Set(prev).add(key))

  const itemBadge = (r: CollectionItem) => {
    const k = itemKind(r)
    if (k === 'grpc') return <span className="rm-method rm-method--OTHER">gRPC</span>
    if (k === 'ws') return <span className="rm-method rm-method--OTHER">WS</span>
    return <MethodBadge method={(r as RestRequest).method} />
  }

  const renderRequestRow = (r: CollectionItem, collectionId: string, folderId: string | null) => {
    const isRenaming = renamingId === r.id
    const activate = () => openExisting(r, collectionId, folderId)
    return (
      <div key={r.id} className="rm-req-row" role="button" tabIndex={0}
        draggable={!isRenaming && !isViewer}
        onDragStart={(e) => startDrag(e, { kind: 'request', fromCollectionId: collectionId, fromFolderId: folderId, requestId: r.id })}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (isViewer) return; setCtx({ x: e.clientX, y: e.clientY, collectionId, folderId, request: r }) }}
        onClick={activate}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() } }}>
        {itemBadge(r)}{' '}
        {isRenaming
          ? <RenameInput initial={r.name}
              onCommit={(name) => { postToHost({ type: 'renameRequest', collectionId, folderId, requestId: r.id, name }); setRenamingId(null) }}
              onCancel={() => setRenamingId(null)} />
          : <span className="rm-tree-label">{r.name}</span>}
        {!isViewer && (
          <div className="rm-actions">
            <IconButton icon="edit" label={`rename request ${r.name}`} onClick={() => setRenamingId(r.id)} />
          </div>
        )}
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
          draggable={!isRenaming && !isViewer}
          onDragStart={(e) => { e.stopPropagation(); startDrag(e, { kind: 'folder', fromCollectionId: c.id, folderId: f.id }) }}
          onClick={() => toggleFolder(key)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFolder(key) } }}
          {...dropHandlers(key, c.id, f.id)}>
          <span className="rm-tree-caret" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>{' '}
          <span className={`codicon codicon-folder${isExpanded ? '-opened' : ''}`} aria-hidden="true" />{' '}
          {isRenaming
            ? <RenameInput initial={f.name}
                onCommit={(name) => { postToHost({ type: 'renameFolder', collectionId: c.id, folderId: f.id, name }); setRenamingId(null) }}
                onCancel={() => setRenamingId(null)} />
            : <span className="rm-tree-label">{f.name}</span>}
          {!isViewer && (
            <div className="rm-actions">
              <IconButton icon="add" label={`add request to ${f.name}`}
                onClick={() => { expandCollection(c.id); expandFolder(key); postToHost({ type: 'createRequest', collectionId: c.id, folderId: f.id, request: blankRequest() }) }} />
              <IconButton icon="edit" label={`rename folder ${f.name}`} onClick={() => setRenamingId(f.id)} />
              <IconButton icon="trash" label={`delete folder ${f.name}`}
                onClick={() => postToHost({ type: 'deleteFolder', collectionId: c.id, folderId: f.id })} />
            </div>
          )}
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
    <div className="rm-tree">
      {ctx && (
        <div className="rm-ctxmenu" role="menu" style={{ top: ctx.y, left: ctx.x }}
          onClick={(e) => e.stopPropagation()}>
          <button type="button" className="rm-popup-item" role="menuitem"
            onClick={() => { postToHost({ type: 'duplicateRequest', collectionId: ctx.collectionId, folderId: ctx.folderId, requestId: ctx.request.id }); setCtx(null) }}>
            <span className="codicon codicon-copy" /> Duplicate
          </button>
          <button type="button" className="rm-popup-item" role="menuitem"
            onClick={() => { setRenamingId(ctx.request.id); setCtx(null) }}>
            <span className="codicon codicon-edit" /> Rename
          </button>
          <button type="button" className="rm-popup-item" role="menuitem"
            onClick={() => { postToHost({ type: 'deleteRequest', collectionId: ctx.collectionId, folderId: ctx.folderId, requestId: ctx.request.id }); setCtx(null) }}>
            <span className="codicon codicon-trash" /> Delete
          </button>
        </div>
      )}
      <div className="rm-tree-head">
        <span className="rm-section-title">Collections</span>
        {!isViewer && (
          <IconButton icon="add" label="add collection"
            onClick={() => postToHost({ type: 'createCollection', name: 'New Collection' })} />
        )}
      </div>
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
                : <span className="rm-tree-label">{c.name}</span>}
              <div className="rm-actions">
                {!isViewer && (
                  <>
                    <IconButton icon="new-folder" label={`new folder in ${c.name}`}
                      onClick={() => postToHost({ type: 'createFolder', collectionId: c.id, name: 'New Folder' })} />
                    <IconButton icon="add" label={`add request to ${c.name}`}
                      onClick={() => { expandCollection(c.id); postToHost({ type: 'createRequest', collectionId: c.id, folderId: null, request: blankRequest() }) }} />
                    <IconButton icon="edit" label={`rename collection ${c.name}`} onClick={() => setRenamingId(c.id)} />
                    <IconButton icon="trash" label={`delete collection ${c.name}`}
                      onClick={() => postToHost({ type: 'deleteCollection', id: c.id })} />
                  </>
                )}
                <PopupMenu icon="gear" label={`collection settings ${c.name}`} items={[
                  { label: `Environment: ${environments.find((e) => e.id === c.environmentId)?.name ?? 'None'}`, icon: 'globe', onClick: () => {} },
                  ...environments.map((e) => ({
                    label: `${c.environmentId === e.id ? '✓ ' : '   '}${e.name}`,
                    icon: 'circle-small' as const,
                    onClick: () => postToHost({ type: 'setCollectionEnvironment', collectionId: c.id, environmentId: e.id }),
                  })),
                  { label: c.environmentId ? '   Unbind environment' : '', icon: 'close' as const, onClick: () => postToHost({ type: 'setCollectionEnvironment', collectionId: c.id, environmentId: null }) },
                  { label: 'Export native', icon: 'cloud-download', onClick: () => postToHost({ type: 'exportCollection', id: c.id, format: 'native' }) },
                  { label: 'Export postman', icon: 'json', onClick: () => postToHost({ type: 'exportCollection', id: c.id, format: 'postman' }) },
                ].filter((it) => it.label !== '')} />
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
  )
}
