export function IconButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button className="rm-icon-btn" aria-label={label} title={label} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick?.() }}>
      <span className={`codicon codicon-${icon}`} />
    </button>
  )
}
