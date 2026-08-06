import { MenuRows, type PopupMenuItem } from './PopupMenu'

/**
 * A right-click menu anchored at fixed viewport coordinates. Renders the same
 * item rows as PopupMenu (headers, separators, check gutters) so a context menu
 * and a gear menu for the same node look identical.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: PopupMenuItem[]
  onClose: () => void
}) {
  return (
    <div
      className="rm-ctxmenu"
      role="menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuRows items={items} onPick={onClose} />
    </div>
  )
}