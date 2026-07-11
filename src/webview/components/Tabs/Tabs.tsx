import { useStore } from '../../state/store'

export function Tabs() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const openNewTab = useStore((s) => s.openNewTab)
  const closeTab = useStore((s) => s.closeTab)
  const setActive = useStore((s) => s.setActive)

  return (
    <div className="rm-row">
      {tabs.map((t) => (
        <span key={t.id} className="rm-row">
          <button className="rm-btn" aria-pressed={t.id === activeTabId}
            onClick={() => setActive(t.id)}>
            {t.method} {t.name}
          </button>
          <button className="rm-btn" aria-label={`close ${t.name}`}
            onClick={() => closeTab(t.id)}>×</button>
        </span>
      ))}
      <button className="rm-btn" aria-label="+" onClick={openNewTab}>+</button>
    </div>
  )
}
