import { useState, useEffect, type DragEvent } from 'react'
import { useStore } from '../../state/store'
import { postToHost, getUiState, setUiState } from '../../ipc'
import { newId, defaultHeaders, itemKind, type Collection, type CollectionItem, type Folder, type RestRequest } from '../../../shared/types'
import { MethodBadge } from '../../elements/MethodBadge'
import { IconButton } from '../../elements/IconButton'
import { PopupMenu, type PopupMenuItem } from '../../elements/PopupMenu'
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
  const workspaces = useStore((s) => s.workspaces)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const isViewer = useStore((s) => s.isViewer())
  // Where a collection can be moved: any other workspace we can write to —
  // a local one, or one bound to a signed-in account (that's how a collection
  // gets from "local" into an account without moving the whole workspace).
  const moveTargets = workspaces.filter((w) => w.id !== activeWorkspaceId && w.role !== 'viewer')
  // Restore which nodes were expanded last session (persisted per webview).
  // Node ids are unique across workspaces, so a single set is workspace-safe:
  // ids that don't belong to the active tree simply don't render.
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(
    () => new Set(getUiState<string[]>('expandedCollections', [])),
  )
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(getUiState<string[]>('expandedFolders', [])),
  )
  useEffect(() => { setUiState('expandedCollections', [...expandedCollections]) }, [expandedCollections])
  useEffect(() => { setUiState('expandedFolders', [...expandedFolders]) }, [expandedFolders])
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

  // The gear menu, as three labelled sections rather than one flat list:
  // Environment is a radio group (check gutter marks the bound one, "None"
  // unbinds), Move to workspace names the destination with its account as a
  // muted hint, Export lists just the formats — the word "Export" lives in the
  // header instead of being repeated on every row.
  const collectionMenu = (c: Collection): PopupMenuItem[] => {
    const setEnv = (environmentId: string | null) =>
      postToHost({ type: 'setCollectionEnvironment', collectionId: c.id, environmentId })
    const items: PopupMenuItem[] = [{ kind: 'header', label: 'Environment' }]
    if (environments.length === 0) {
      items.push({ label: 'No environments yet', icon: 'info', disabled: true, onClick: () => {} })
    } else {
      items.push(
        ...environments.map((e) => ({
          label: e.name,
          checked: c.environmentId === e.id,
          onClick: () => setEnv(e.id),
        })),
        { label: 'None', checked: !c.environmentId, onClick: () => setEnv(null) },
      )
    }
    if (moveTargets.length && !isViewer) {
      items.push(
        { kind: 'separator' },
        { kind: 'header', label: 'Move to workspace' },
        ...moveTargets.map((w) => ({
          label: w.name,
          icon: w.synced ? 'cloud' : 'device-desktop',
          hint: w.accountEmail ?? 'local',
          onClick: () => postToHost({ type: 'moveCollection', id: c.id, toWorkspaceId: w.id }),
        })),
      )
    }
    items.push(
      { kind: 'separator' },
      { kind: 'header', label: 'Export' },
      { label: 'Native', icon: 'json', onClick: () => postToHost({ type: 'exportCollection', id: c.id, format: 'native' }) },
      { label: 'Postman', icon: 'json', onClick: () => postToHost({ type: 'exportCollection', id: c.id, format: 'postman' }) },
      { label: 'OpenAPI', icon: 'json', onClick: () => postToHost({ type: 'exportCollection', id: c.id, format: 'openapi' }) },
    )
    return items
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
              <IconButton icon="copy" label={`duplicate folder ${f.name}`}
                onClick={() => postToHost({ type: 'duplicateFolder', collectionId: c.id, folderId: f.id })} />
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
                    <IconButton icon="copy" label={`duplicate collection ${c.name}`}
                      onClick={() => postToHost({ type: 'duplicateCollection', id: c.id })} />
                    <IconButton icon="trash" label={`delete collection ${c.name}`}
                      onClick={() => postToHost({ type: 'deleteCollection', id: c.id })} />
                  </>
                )}
                <PopupMenu icon="gear" label={`collection settings ${c.name}`} items={collectionMenu(c)} />
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
