import { useState } from 'react'
import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { newId, type RestRequest } from '../../../shared/types'

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
      <div className="rm-row">
        <strong>Collections</strong>
        <button className="rm-btn" onClick={() => postToHost({ type: 'openRequest', request: blankRequest() })}>New Request</button>
        <button className="rm-btn" onClick={() => postToHost({ type: 'importCollection' })}>Import</button>
        <button className="rm-btn" onClick={() => postToHost({ type: 'createCollection', name: 'New Collection' })}>+ New</button>
      </div>
      {tree.map((c) => (
        <div key={c.id}>
          <div className="rm-row">
            <button className="rm-btn" onClick={() => toggle(c.id)}>
              <span aria-hidden="true">{expanded.has(c.id) ? '▾' : '▸'}</span> <span>{c.name}</span>
            </button>
            <button className="rm-btn" aria-label={`export native for ${c.name}`}
              onClick={() => postToHost({ type: 'exportCollection', id: c.id, format: 'native' })}>Export native</button>
            <button className="rm-btn" aria-label={`export postman for ${c.name}`}
              onClick={() => postToHost({ type: 'exportCollection', id: c.id, format: 'postman' })}>Export postman</button>
          </div>
          {expanded.has(c.id) && (
            <div>
              <ul>
                {c.requests.map((r) => (
                  <li key={r.id}>
                    <button className="rm-btn" onClick={() => postToHost({ type: 'openRequest', request: r })}>{r.name}</button>
                  </li>
                ))}
              </ul>
              <button className="rm-btn" aria-label={`add request to ${c.name}`}
                onClick={() => postToHost({ type: 'openRequest', request: blankRequest(), targetCollectionId: c.id })}>+ Request</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
