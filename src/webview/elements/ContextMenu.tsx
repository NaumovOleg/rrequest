import { useLayoutEffect, useRef, useState } from "react";
import { MenuRows, type PopupMenuItem } from "./PopupMenu";

const MARGIN = 6;

/**
 * A right-click menu anchored at fixed viewport coordinates. Renders the same
 * item rows as PopupMenu (headers, separators, check gutters) so a context menu
 * and a gear menu for the same node look identical. The menu is measured after
 * mount and clamped, so a right-click near the editor's right edge flips it
 * back into view instead of clipping off-screen.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: PopupMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxX = Math.max(MARGIN, window.innerWidth - rect.width - MARGIN);
    const maxY = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN);
    setPos({
      top: Math.min(y, maxY),
      left: Math.min(x, maxX),
    });
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="rm-ctxmenu"
      role="menu"
      style={pos}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuRows items={items} onPick={onClose} />
    </div>
  );
}
