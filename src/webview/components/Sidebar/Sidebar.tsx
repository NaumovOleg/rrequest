import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { Environments } from '../Environments/Environments'

export function Sidebar() {
  const tree = useStore((s) => s.tree)

  return (
    <div className="rm-panel" style={{ minWidth: 220 }}>
      <div className="rm-row">
        <strong>Collections</strong>
        <button className="rm-btn" onClick={() => postToHost({ type: 'importCollection' })}>Import</button>
        <button className="rm-btn" onClick={() => {
          const name = 'New Collection'
          postToHost({ type: 'createCollection', name })
        }}>+ New</button>
      </div>
      {tree.map((c) => (
        <div key={c.id}>
          <div>
            {c.name}
            <button className="rm-btn" aria-label={`export native for ${c.name}`}
              onClick={() => postToHost({ type: 'exportCollection', id: c.id, format: 'native' })}>Export native</button>
            <button className="rm-btn" aria-label={`export postman for ${c.name}`}
              onClick={() => postToHost({ type: 'exportCollection', id: c.id, format: 'postman' })}>Export postman</button>
          </div>
          <ul>
            {c.requests.map((r) => (
              <li key={r.id}>
                <button className="rm-btn" onClick={() => postToHost({ type: 'openRequest', request: r })}>{r.name}</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Environments />
    </div>
  )
}
