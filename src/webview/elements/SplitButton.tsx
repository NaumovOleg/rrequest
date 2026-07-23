import { useState, useRef, useEffect } from "react";

export interface SplitItem {
  label: string;
  icon?: string;
  onClick: () => void;
}

/** Primary button with a chevron that reveals a menu of secondary actions. */
export function SplitButton({
  label,
  onClick,
  items,
  disabled,
}: {
  label: string;
  onClick: () => void;
  items: SplitItem[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="rm-split" ref={ref}>
      <button type="button" className="rm-split-main" onClick={onClick} disabled={disabled}>
        {label}
      </button>
      <button
        type="button"
        className="rm-split-toggle"
        aria-label={`${label} options`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="codicon codicon-chevron-down" />
      </button>
      {open && (
        <div className="rm-split-menu" role="menu">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              className="rm-popup-item"
              role="menuitem"
              onClick={() => {
                it.onClick();
                setOpen(false);
              }}
            >
              {it.icon && <span className={`codicon codicon-${it.icon}`} />}{" "}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
