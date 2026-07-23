import { useEffect } from 'react'
import { useStore } from '../state/store'

function Toast({ id, level, message }: { id: string; level: 'error' | 'info'; message: string }) {
  const dismiss = useStore((s) => s.dismissToast)
  useEffect(() => {
    const t = setTimeout(() => dismiss(id), 4000)
    return () => clearTimeout(t)
  }, [id, dismiss])
  return (
    <div className={`rm-toast rm-toast--${level}`} role="status" onClick={() => dismiss(id)}>
      <span className={`codicon codicon-${level === 'error' ? 'error' : 'info'} rm-toast-icon`} aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}

export function Toaster() {
  const toasts = useStore((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="rm-toaster" aria-live="polite">
      {toasts.map((t) => <Toast key={t.id} {...t} />)}
    </div>
  )
}
