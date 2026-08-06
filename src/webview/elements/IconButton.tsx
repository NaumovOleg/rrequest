export function IconButton({ icon, label, onClick, disabled, spin }: { icon: string; label: string; onClick?: () => void; disabled?: boolean; spin?: boolean }) {
  return (
    <button className="rm-icon-btn" aria-label={label} title={label} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick?.() }}>
      <span className={`codicon codicon-${icon}${spin ? ' rm-spin' : ''}`} />
    </button>
  )
}
