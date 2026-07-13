import { useState } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { newId, type RestRequest } from '../../../shared/types'
import { MethodBadge } from '../common/MethodBadge'

function blankRequest(): RestRequest {
  return { id: newId(), name: 'New Request', method: 'GET', url: '', params: [], headers: [], body: { mode: 'none' }, preRequestScript: '', testScript: '' }
}

export function Sidebar() {
  const tree = useStore((s) => s.tree)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setExpanded((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  return (
    <div className="rm-panel" style={{ minWidth: 220 }}>
      <div className="rm-section">
        <div className="rm-row">
          <span className="rm-section-title">Collections</span>
          <button className="rm-btn--ghost" onClick={() => postToHost({ type: 'openRequest', request: blankRequest() })}>New Request</button>
          <button className="rm-btn--ghost" onClick={() => postToHost({ type: 'importCollection' })}>Import</button>
          <button className="rm-btn--ghost" onClick={() => postToHost({ type: 'createCollection', name: 'New Collection' })}>+ New</button>
        </div>
      </div>
      <div className="rm-tree">
        {tree.map((c) => (
          <div key={c.id}>
            <div className="rm-tree-row">
              <button className="rm-btn--ghost" onClick={() => toggle(c.id)}>
                <span className="rm-tree-caret" aria-hidden="true">{expanded.has(c.id) ? '▾' : '▸'}</span> <span>{c.name}</span>
              </button>
              <button className="rm-btn--ghost" aria-label={`export native for ${c.name}`}
                onClick={() => postToHost({ type: 'exportCollection', id: c.id, format: 'native' })}>Export native</button>
              <button className="rm-btn--ghost" aria-label={`export postman for ${c.name}`}
                onClick={() => postToHost({ type: 'exportCollection', id: c.id, format: 'postman' })}>Export postman</button>
            </div>
            {expanded.has(c.id) && (
              <div className="rm-tree-children">
                {c.requests.map((r) => (
                  <div key={r.id} className="rm-req-row" role="button" tabIndex={0}
                    onClick={() => postToHost({ type: 'openRequest', request: r })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); postToHost({ type: 'openRequest', request: r }) } }}>
                    <MethodBadge method={r.method} /> <span>{r.name}</span>
                  </div>
                ))}
                <button className="rm-btn--ghost" aria-label={`add request to ${c.name}`}
                  onClick={() => postToHost({ type: 'openRequest', request: blankRequest(), targetCollectionId: c.id })}>+ Request</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
