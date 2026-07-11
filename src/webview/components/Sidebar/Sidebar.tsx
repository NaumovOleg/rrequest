import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import type { RestRequest } from '../../../shared/types'

export function Sidebar() {
  const tree = useStore((s) => s.tree)
  const openNewTab = useStore((s) => s.openNewTab)
  const updateActive = useStore((s) => s.updateActive)

  const openRequest = (r: RestRequest) => {
    openNewTab()
    updateActive({ name: r.name, method: r.method, url: r.url, params: r.params, headers: r.headers, body: r.body })
  }

  return (
    <div className="rm-panel" style={{ minWidth: 220 }}>
      <div className="rm-row">
        <strong>Collections</strong>
        <button className="rm-btn" onClick={() => {
          const name = 'New Collection'
          postToHost({ type: 'createCollection', name })
        }}>+ New</button>
      </div>
      {tree.map((c) => (
        <div key={c.id}>
          <div>{c.name}</div>
          <ul>
            {c.requests.map((r) => (
              <li key={r.id}>
                <button className="rm-btn" onClick={() => openRequest(r)}>{r.name}</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
