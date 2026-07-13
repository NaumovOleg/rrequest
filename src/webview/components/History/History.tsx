import { useStore } from '../../state/store'
import { postToHost } from '../../ipc'
import { MethodBadge } from '../common/MethodBadge'

export function History() {
  const history = useStore((s) => s.history)
  return (
    <div className="rm-section">
      <span className="rm-section-title">History</span>
      <div>
        {history.map((e) => (
          <div key={e.id} className="rm-req-row" role="button" tabIndex={0}
            onClick={() => postToHost({ type: 'openRequest', request: e.request })}
            onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); postToHost({ type: 'openRequest', request: e.request }) } }}>
            <MethodBadge method={e.request.method} />
            <span>{e.request.method} {e.request.url}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
