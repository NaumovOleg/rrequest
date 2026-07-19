import { useState, useRef, useEffect } from "react";
import { IconButton } from "./IconButton";
import { RenameInput } from "./RenameInput";

export interface ComboItem {
  value: string;
  label: string;
}

export const ComboInput = ({
  value,
  onChange,
  items,
  placeholder,
  onSelect,
  onEdit,
  onDelete,
}: {
  value: string;
  onChange: (v: string) => void;
  items: ComboItem[];
  placeholder?: string;
  /** Called when a dropdown item is picked. Defaults to onChange(item.value). */
  onSelect?: (item: ComboItem) => void;
  /** Renders an edit icon on each item only when provided. Receives the new text on commit. */
  onEdit?: (item: ComboItem, newValue: string) => void;
  /** Renders a delete icon on each item only when provided. */
  onDelete?: (item: ComboItem) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ComboItem | null>(null);
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

  const pick = (item: ComboItem) => {
    if (onSelect) onSelect(item);
    else onChange(item.value);
    setOpen(false);
  };

  const startEdit = (item: ComboItem) => {
    setOpen(false);
    setEditing(item);
  };

  const finishEdit = (newValue: string) => {
    if (editing) onEdit?.(editing, newValue);
    setEditing(null);
    setOpen(true);
  };

  const cancelEdit = () => {
    setEditing(null);
    setOpen(true);
  };

  return (
    <div className="rm-combo" ref={ref}>
      {editing ? (
        <RenameInput
          initial={editing.label ?? editing.value}
          onCommit={finishEdit}
          onCancel={cancelEdit}
        />
      ) : (
        <input
          className="rm-input rm-combo-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
        />
      )}
      {open && !editing && items.length > 0 && (
        <div className="rm-combo-list" role="listbox">
          {items.map((it, i) => (
            <div key={i} className="rm-combo-item" role="option">
              <button
                type="button"
                className="rm-combo-label"
                onClick={() => pick(it)}
              >
                {it.label ?? it.value}
              </button>
              {onEdit && (
                <IconButton
                  icon="edit"
                  label="Edit"
                  onClick={() => startEdit(it)}
                />
              )}
              {onDelete && (
                <IconButton
                  icon="trash"
                  label="Delete"
                  onClick={() => onDelete(it)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
