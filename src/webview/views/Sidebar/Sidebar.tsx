import { useState, useEffect, type DragEvent } from 'react'
import { useStore } from '../../state/store'
import { postToHost, getUiState, setUiState } from '../../ipc'
import { newId, defaultHeaders, itemKind, type Collection, type CollectionItem, type Folder, type RestRequest } from '../../../shared/types'
import { MethodBadge } from '../../elements/MethodBadge'
import { IconButton } from '../../elements/IconButton'
import { PopupMenu, type PopupMenuItem } from '../../elements/PopupMenu'
import { ContextMenu } from '../../elements/ContextMenu'
import { RenameInput } from '../../elements/RenameInput'
import { CodeTextarea } from '../../elements/CodeTextarea'

function blankRequest(): RestRequest {
  return { id: newId(), name: 'New Request', method: 'GET', url: '', params: [], headers: defaultHeaders(), cookies: [], body: { mode: 'none' }, preRequestScript: '', testScript: '' }
}

type DragPayload =
  | { kind: 'request'; fromCollectionId: string; fromFolderId: string | null; requestId: string }
  | { kind: 'folder'; fromCollectionId: string; folderId: string }

// Right-click menu target: the node plus enough context to build its items
// (the bucket it lives in, for Move Up/Down disabled states).
type Ctx =
  | { x: number; y: number; kind: 'request'; collectionId: string; folderId: string | null; request: CollectionItem; bucket: CollectionItem[] }
  | { x: number; y: number; kind: 'folder'; collectionId: string; folder: Folder; folders: Folder[] }
  | { x: number; y: number; kind: 'collection'; collection: Collection }

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
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [query, setQuery] = useState('')
  // Collection/folder scripts modal: lives on the sidebar, keyed by node, so
  // its textareas are cheap local state (Save sends the host mutation).
  const [scriptsFor, setScriptsFor] = useState<{
    kind: 'collection' | 'folder'
    collectionId: string
    folderId?: string
    name: string
    pre?: string
    test?: string
  } | null>(null)

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

  const expandAll = () => {
    const colls = new Set<string>()
    const folds = new Set<string>()
    for (const c of tree) {
      colls.add(c.id)
      for (const f of c.folders ?? []) folds.add(`${c.id}/${f.id}`)
    }
    setExpandedCollections(colls)
    setExpandedFolders(folds)
  }
  const collapseAll = () => {
    setExpandedCollections(new Set())
    setExpandedFolders(new Set())
  }

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
    items.push(
      { kind: 'separator' },
      { label: 'Scripts', icon: 'run-all', onClick: () => setScriptsFor({ kind: 'collection', collectionId: c.id, name: c.name, pre: c.preRequestScript ?? '', test: c.testScript ?? '' }) },
    )
    return items
  }

  // Right-click menus mirror the row's inline actions (plus Move Up/Down).
  const requestMenu = (r: CollectionItem, collectionId: string, folderId: string | null, bucket: CollectionItem[]): PopupMenuItem[] => {
    const i = bucket.findIndex((x) => x.id === r.id)
    return [
      { label: 'Duplicate', icon: 'copy', onClick: () => postToHost({ type: 'duplicateRequest', collectionId, folderId, requestId: r.id }) },
      { label: 'Rename', icon: 'edit', onClick: () => setRenamingId(r.id) },
      { label: 'Delete', icon: 'trash', onClick: () => postToHost({ type: 'deleteRequest', collectionId, folderId, requestId: r.id }) },
      { kind: 'separator' },
      { label: 'Move Up', icon: 'arrow-up', disabled: i <= 0, onClick: () => postToHost({ type: 'reorderRequest', collectionId, folderId, requestId: r.id, delta: 'up' }) },
      { label: 'Move Down', icon: 'arrow-down', disabled: i < 0 || i >= bucket.length - 1, onClick: () => postToHost({ type: 'reorderRequest', collectionId, folderId, requestId: r.id, delta: 'down' }) },
    ]
  }

  const folderMenu = (collectionId: string, f: Folder, folders: Folder[]): PopupMenuItem[] => {
    const i = folders.findIndex((x) => x.id === f.id)
    const key = `${collectionId}/${f.id}`
    return [
      { label: 'Add Request', icon: 'add', onClick: () => { expandCollection(collectionId); expandFolder(key); postToHost({ type: 'createRequest', collectionId, folderId: f.id, request: blankRequest() }) } },
      { label: 'Scripts', icon: 'run-all', onClick: () => setScriptsFor({ kind: 'folder', collectionId, folderId: f.id, name: f.name, pre: f.preRequestScript ?? '', test: f.testScript ?? '' }) },
      { label: 'Rename', icon: 'edit', onClick: () => setRenamingId(f.id) },
      { label: 'Duplicate', icon: 'copy', onClick: () => postToHost({ type: 'duplicateFolder', collectionId, folderId: f.id }) },
      { label: 'Delete', icon: 'trash', onClick: () => postToHost({ type: 'deleteFolder', collectionId, folderId: f.id }) },
      { kind: 'separator' },
      { label: 'Move Up', icon: 'arrow-up', disabled: i <= 0, onClick: () => postToHost({ type: 'reorderFolder', collectionId, folderId: f.id, delta: 'up' }) },
      { label: 'Move Down', icon: 'arrow-down', disabled: i < 0 || i >= folders.length - 1, onClick: () => postToHost({ type: 'reorderFolder', collectionId, folderId: f.id, delta: 'down' }) },
    ]
  }

  // Filtering view: while a query is active, every matching node renders as
  // expanded (the persisted expansion state is left untouched, so clearing the
  // search restores the previous fold state).
  const q = query.trim().toLowerCase()
  const filtering = q.length > 0
  const matchesReq = (r: CollectionItem): boolean => {
    if (!q) return true
    if (r.name.toLowerCase().includes(q)) return true
    if ('url' in r && typeof (r as { url?: unknown }).url === 'string' && (r as { url: string }).url.toLowerCase().includes(q)) return true
    return false
  }
  const visibleTree: Collection[] = filtering
    ? tree
        .map((c) => ({
          ...c,
          folders: (c.folders ?? [])
            .filter((f) => f.name.toLowerCase().includes(q) || f.requests.some(matchesReq))
            .map((f) => ({ ...f, requests: f.requests.filter(matchesReq) })),
          requests: c.requests.filter(matchesReq),
        }))
        .filter((c) => c.folders.length > 0 || c.requests.length > 0)
    : tree

  const renderRequestRow = (r: CollectionItem, collectionId: string, folderId: string | null, bucket: CollectionItem[]) => {
    const isRenaming = renamingId === r.id
    const activate = () => openExisting(r, collectionId, folderId)
    return (
      <div key={r.id} className="rm-req-row" role="button" tabIndex={0}
        draggable={!isRenaming && !isViewer}
        onDragStart={(e) => startDrag(e, { kind: 'request', fromCollectionId: collectionId, fromFolderId: folderId, requestId: r.id })}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (isViewer) return; setCtx({ x: e.clientX, y: e.clientY, kind: 'request', collectionId, folderId, request: r, bucket }) }}
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
    const isExpanded = filtering || expandedFolders.has(key)
    const isRenaming = renamingId === f.id
    const folders = c.folders ?? []
    return (
      <div key={f.id}>
        <div className={`rm-tree-row${dropTarget === key ? ' rm-drop-over' : ''}`} role="button" tabIndex={0}
          draggable={!isRenaming && !isViewer}
          onDragStart={(e) => { e.stopPropagation(); startDrag(e, { kind: 'folder', fromCollectionId: c.id, folderId: f.id }) }}
          onClick={() => toggleFolder(key)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFolder(key) } }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (isViewer) return; setCtx({ x: e.clientX, y: e.clientY, kind: 'folder', collectionId: c.id, folder: f, folders }) }}
          {...dropHandlers(key, c.id, f.id)}>
          <span className="rm-tree-caret" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>{' '}
          <span className={`codicon codicon-folder${isExpanded ? '-opened' : ''}`} aria-hidden="true" />{' '}
          {isRenaming
            ? <RenameInput initial={f.name}
                onCommit={(name) => { postToHost({ type: 'renameFolder', collectionId: c.id, folderId: f.id, name }); setRenamingId(null) }}
                onCancel={() => setRenamingId(null)} />
            : <span className="rm-tree-label">{f.name}</span>}
          {(f.preRequestScript || f.testScript) && (
            <span className="codicon codicon-run-all rm-script-dot" title="Folder scripts set" aria-hidden="true" />
          )}
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
            {f.requests.map((r) => renderRequestRow(r, c.id, f.id, f.requests))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rm-tree">
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          onClose={() => setCtx(null)}
          items={
            ctx.kind === 'request'
              ? requestMenu(ctx.request, ctx.collectionId, ctx.folderId, ctx.bucket)
              : ctx.kind === 'folder'
              ? folderMenu(ctx.collectionId, ctx.folder, ctx.folders)
              : collectionMenu(ctx.collection)
          }
        />
      )}
      <div className="rm-tree-head">
        <span className="rm-section-title">Collections</span>
        <div className="rm-actions">
          <IconButton icon="expand-all" label="expand all collections" onClick={expandAll} />
          <IconButton icon="collapse-all" label="collapse all collections" onClick={collapseAll} />
          {!isViewer && (
            <IconButton icon="add" label="add collection"
              onClick={() => postToHost({ type: 'createCollection', name: 'New Collection' })} />
          )}
        </div>
      </div>
      {tree.length > 0 && (
        <div className="rm-tree-search">
          <span className="codicon codicon-search rm-tree-search-icon" aria-hidden="true" />
          <input
            className="rm-input rm-tree-search-input"
            aria-label="search collections"
            placeholder="Filter requests…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="rm-icon-btn" aria-label="clear search"
              onClick={() => setQuery('')}>
              <span className="codicon codicon-close" />
            </button>
          )}
        </div>
      )}
      {!filtering && tree.length === 0 ? (
        <div className="rm-empty-cta">
          <div className="rm-empty">No collections yet.</div>
          <div className="rm-row rm-empty-cta-actions">
            <button type="button" className="rm-btn" onClick={() => postToHost({ type: 'createCollection', name: 'New Collection' })}>
              New Collection
            </button>
            <button type="button" className="rm-btn" title="Import a Postman or OpenAPI collection"
              onClick={() => postToHost({ type: 'importCollection' })}>
              Import
            </button>
          </div>
        </div>
      ) : filtering && visibleTree.length === 0 ? (
        <div className="rm-empty">No matching requests.</div>
      ) : (
        visibleTree.map((c) => {
          const isExpanded = filtering || expandedCollections.has(c.id)
          const isRenaming = renamingId === c.id
          const folders = c.folders ?? []
          return (
            <div key={c.id}>
              <div className={`rm-tree-row${dropTarget === c.id ? ' rm-drop-over' : ''}`} role="button" tabIndex={0}
                onClick={() => toggleCollection(c.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollection(c.id) } }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (isViewer) return; setCtx({ x: e.clientX, y: e.clientY, kind: 'collection', collection: c }) }}
                {...dropHandlers(c.id, c.id, null)}>
                <span className="rm-tree-caret" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>{' '}
                {isRenaming
                  ? <RenameInput initial={c.name}
                      onCommit={(name) => { postToHost({ type: 'renameCollection', id: c.id, name }); setRenamingId(null) }}
                      onCancel={() => setRenamingId(null)} />
                  : <span className="rm-tree-label">{c.name}</span>}
                {(c.preRequestScript || c.testScript) && (
                  <span className="codicon codicon-run-all rm-script-dot" title="Collection scripts set" aria-hidden="true" />
                )}
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
                  {c.requests.map((r) => renderRequestRow(r, c.id, null, c.requests))}
                </div>
              )}
            </div>
          )
        })
      )}
      {scriptsFor && (
        <ScriptsModal
          target={scriptsFor}
          onClose={() => setScriptsFor(null)}
          onSave={(pre, test) => {
            if (scriptsFor.kind === 'collection') {
              postToHost({ type: 'saveCollectionScript', collectionId: scriptsFor.collectionId, preRequestScript: pre, testScript: test })
            } else {
              postToHost({ type: 'saveFolderScript', collectionId: scriptsFor.collectionId, folderId: scriptsFor.folderId!, preRequestScript: pre, testScript: test })
            }
            setScriptsFor(null)
          }}
        />
      )}
    </div>
  )
}

// Small modal for editing a collection/folder's pre-request + test scripts.
function ScriptsModal({ target, onClose, onSave }: {
  target: { kind: 'collection' | 'folder'; name: string; pre?: string; test?: string }
  onClose: () => void
  onSave: (pre: string, test: string) => void
}) {
  const [pre, setPre] = useState(target.pre ?? '')
  const [test, setTest] = useState(target.test ?? '')
  return (
    <div className="rm-modal-scrim" onClick={onClose}>
      <div className="rm-modal rm-scripts-modal" role="dialog" aria-modal="true" aria-label={`${target.kind} scripts`}
        onClick={(e) => e.stopPropagation()}>
        <div className="rm-modal-title">{target.kind === 'collection' ? 'Collection' : 'Folder'} Scripts — {target.name}</div>
        <label className="rm-scripts-label" htmlFor="rm-pre-script">Pre-request script</label>
        <CodeTextarea id="rm-pre-script" className="rm-input rm-code-input" rows={6} value={pre} onChange={(e) => setPre(e.target.value)} />
        <label className="rm-scripts-label" htmlFor="rm-test-script">Test script</label>
        <CodeTextarea id="rm-test-script" className="rm-input rm-code-input" rows={6} value={test} onChange={(e) => setTest(e.target.value)} />
        <div className="rm-modal-actions">
          <button className="rm-btn" onClick={onClose}>Cancel</button>
          <button className="rm-btn rm-btn--primary" onClick={() => onSave(pre, test)}>Save</button>
        </div>
      </div>
    </div>
  )
}