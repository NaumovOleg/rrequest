import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'

export function History() {
  const history = useStore((s) => s.history)
  return (
    <div className="rm-panel">
      <strong>History</strong>
      <ul>
        {history.map((e) => (
          <li key={e.id}>
            <button className="rm-btn" onClick={() => postToHost({ type: 'openRequest', request: e.request })}>
              {e.request.method} {e.request.url}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
