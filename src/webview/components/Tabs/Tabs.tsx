import { useStore } from '../../state/store'
import { MethodBadge } from '../common/MethodBadge'

export function Tabs() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const openNewTab = useStore((s) => s.openNewTab)
  const closeTab = useStore((s) => s.closeTab)
  const setActive = useStore((s) => s.setActive)

  return (
    <div className="rm-tabbar">
      {tabs.map((t) => (
        <span key={t.id} className="rm-row">
          <button className={`rm-tab ${t.id === activeTabId ? 'is-active' : ''}`} aria-pressed={t.id === activeTabId}
            onClick={() => setActive(t.id)}>
            <MethodBadge method={t.method} /> {t.name}
          </button>
          <button className="rm-tab-close" aria-label={`close ${t.name}`} onClick={() => closeTab(t.id)}>×</button>
        </span>
      ))}
      <button className="rm-btn--icon" aria-label="+" onClick={openNewTab}>+</button>
    </div>
  )
}
