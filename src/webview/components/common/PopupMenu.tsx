import { useState, useEffect, useRef } from 'react'
import { IconButton } from './IconButton'
export function PopupMenu({ icon, label, items }: { icon: string; label: string; items: { label: string; icon?: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <span className="rm-popup" ref={ref} style={{ position: 'relative' }}>
      <IconButton icon={icon} label={label} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="rm-popup-menu" role="menu">
          {items.map((it, i) => (
            <button key={i} className="rm-popup-item" role="menuitem"
              onClick={(e) => { e.stopPropagation(); it.onClick(); setOpen(false) }}>
              {it.icon && <span className={`codicon codicon-${it.icon}`} />} {it.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
