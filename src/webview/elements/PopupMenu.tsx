import { useState, useEffect, useRef } from 'react'
import { IconButton } from './IconButton'

/**
 * Menu entries. Headers and separators are structure, not choices — they render
 * as plain markup rather than dead buttons (the old menu faked both with
 * `onClick: () => {}` items and leading spaces in the label, which HTML
 * collapses, so nothing actually looked nested).
 *
 * `checked` drives a check gutter shared by every row, so labels line up whether
 * or not they're selectable. `hint` is muted trailing text (an account email,
 * a format) that shouldn't compete with the label for attention.
 */
export type PopupMenuItem =
  | { kind: 'header'; label: string }
  | { kind: 'separator' }
  | {
      kind?: 'item'
      label: string
      icon?: string
      hint?: string
      checked?: boolean
      disabled?: boolean
      onClick: () => void
    }

type Header = { kind: 'header'; label: string }
type Separator = { kind: 'separator' }
const isHeader = (it: PopupMenuItem): it is Header => it.kind === 'header'
const isSeparator = (it: PopupMenuItem): it is Separator => it.kind === 'separator'

// An item belongs to a section when a header precedes it with no separator in
// between; those get indented so the grouping reads at a glance.
function indented(items: PopupMenuItem[], i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    if (isSeparator(items[j])) return false
    if (isHeader(items[j])) return true
  }
  return false
}

export function PopupMenu({ icon, label, items }: { icon: string; label: string; items: PopupMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <span className="rm-popup" ref={ref} style={{ position: 'relative' }}>
      <IconButton icon={icon} label={label} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="rm-popup-menu" role="menu" aria-label={label}>
          {items.map((it, i) => {
            if (isHeader(it)) return <div key={i} className="rm-popup-header" role="presentation">{it.label}</div>
            if (isSeparator(it)) return <div key={i} className="rm-popup-sep" role="separator" />
            const cls = ['rm-popup-item']
            if (indented(items, i)) cls.push('rm-popup-item--sub')
            if (it.checked) cls.push('is-checked')
            return (
              <button key={i} type="button" className={cls.join(' ')} role="menuitem"
                aria-checked={it.checked} disabled={it.disabled}
                onClick={(e) => { e.stopPropagation(); it.onClick(); setOpen(false) }}>
                <span className="rm-popup-gutter" aria-hidden="true">
                  {it.checked
                    ? <span className="codicon codicon-check" />
                    : it.icon ? <span className={`codicon codicon-${it.icon}`} /> : null}
                </span>
                <span className="rm-popup-label">{it.label}</span>
                {it.hint && <span className="rm-popup-hint">{it.hint}</span>}
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}
