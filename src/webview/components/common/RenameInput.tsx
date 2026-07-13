import { useState } from 'react'
export function RenameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  const commit = () => { const v = value.trim(); if (v) onCommit(v); else onCancel() }
  return (
    <input className="rm-input rm-rename-input" autoFocus aria-label="rename input" value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}
      onBlur={commit} />
  )
}
