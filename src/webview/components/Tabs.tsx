import { useState } from "react";
import { useStore } from "../state/store";
import { MethodBadge } from "../elements/MethodBadge";
import type { Tab } from "../state/store";

// Closing a dirty tab silently drops unsaved edits (they only live in the
// editor store until Save). VS Code webviews don't support window.confirm, so
// this is a small in-page modal: Discard (close anyway) or Cancel.
export function Tabs() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const openNewTab = useStore((s) => s.openNewTab);
  const closeTab = useStore((s) => s.closeTab);
  const setActive = useStore((s) => s.setActive);
  const [pendingClose, setPendingClose] = useState<Tab | null>(null);

  const requestClose = (t: Tab) => {
    if (t.dirty) setPendingClose(t);
    else closeTab(t.id);
  };

  return (
    <>
      <div className="rm-tabbar">
        {tabs.map((t) => (
          <span key={t.id} className="rm-row">
            <button
              className={`rm-tab ${t.id === activeTabId ? "is-active" : ""}`}
              aria-pressed={t.id === activeTabId}
              title={`${t.name}${t.dirty ? " (unsaved changes)" : ""}`}
              onClick={() => setActive(t.id)}
            >
              <MethodBadge method={t.method} /> {t.name}
              {t.dirty && (
                <span
                  className="rm-tab-dirty"
                  title="unsaved changes"
                  aria-label="unsaved changes"
                />
              )}
            </button>
            <button
              className="rm-tab-close"
              aria-label={`close ${t.name}`}
              onClick={() => requestClose(t)}
            >
              ×
            </button>
          </span>
        ))}
        <button className="rm-btn--icon" aria-label="+" onClick={openNewTab}>
          +
        </button>
      </div>
      {pendingClose && (
        <div
          className="rm-modal-scrim"
          onClick={() => setPendingClose(null)}
          role="presentation"
        >
          <div className="rm-modal" role="alertdialog" aria-modal="true" aria-label="Close without saving?">
            <div className="rm-modal-title">Unsaved changes</div>
            <div className="rm-modal-body">
              “{pendingClose.name}” has unsaved edits that will be lost. Close
              it anyway?
            </div>
            <div className="rm-modal-actions">
              <button
                className="rm-btn"
                autoFocus
                onClick={() => setPendingClose(null)}
              >
                Cancel
              </button>
              <button
                className="rm-btn rm-btn--danger"
                onClick={() => {
                  const id = pendingClose.id;
                  setPendingClose(null);
                  closeTab(id);
                }}
              >
                Close without saving
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
