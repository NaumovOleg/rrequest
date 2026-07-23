import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../../elements";
import { RenameInput } from "../../elements/RenameInput";
import { useWorkspace } from "../../state/useWorkspace";
import { useStore } from "../../state/store";
import { postToHost } from "../../ipc";
import type { Workspace } from "../../../shared/types";

const ROLE_LABEL = { owner: "Owner", editor: "Editor", viewer: "Viewer" } as const;

/** single-user icon for a workspace only you belong to, two-user icon once it's shared */
const typeIcon = (w: Workspace) => (w.role && w.role !== "owner" ? "organization" : "account");

const RECENTS_MAX = 3;

export function WorkspaceSwitcher() {
  const { workspaces, activeId, active, create, rename, remove, select } = useWorkspace();
  const isViewer = useStore((s) => s.isViewer());
  const isOwner = useStore((s) => s.activeWorkspace()?.role === "owner");
  const authEmail = useStore((s) => s.authEmail);
  const synced = useStore((s) => s.activeSynced());

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const [typed, setTyped] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Track the workspaces this webview has actually visited, most-recent first,
  // so "Recently Visited" reflects real navigation instead of list order.
  useEffect(() => {
    if (!activeId) return;
    setRecentIds((prev) => [activeId, ...prev.filter((id) => id !== activeId)].slice(0, RECENTS_MAX));
  }, [activeId]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const closePopup = () => {
    setOpen(false);
    setQuery("");
    setEditingId(null);
  };

  const openPopup = () => {
    if (open) return;
    setOpen(true);
    setQuery("");
  };

  const pick = (id: string) => {
    select(id);
    closePopup();
  };

  const { recentItems, moreItems } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = workspaces.filter((w) => w.name.toLowerCase().includes(q));
    const matchIds = new Set(matches.map((w) => w.id));
    const recent = recentIds
      .map((id) => workspaces.find((w) => w.id === id))
      .filter((w): w is Workspace => !!w && matchIds.has(w.id));
    const recentSet = new Set(recent.map((w) => w.id));
    const more = matches.filter((w) => !recentSet.has(w.id));
    return { recentItems: recent, moreItems: more };
  }, [workspaces, recentIds, query]);

  const renderRow = (w: Workspace) => {
    const isActive = w.id === active?.id;
    const isEditing = editingId === w.id;
    return (
      <div
        key={w.id}
        className={`rm-ws-row${isActive ? " is-active" : ""}`}
        role="option"
        aria-selected={isActive}
        data-testid={isActive ? "active-workspace" : undefined}
      >
        <span className="rm-ws-check">
          {isActive && <span className="codicon codicon-check" />}
        </span>
        <span className={`codicon codicon-${typeIcon(w)} rm-ws-type-icon`} />
        {isEditing ? (
          <RenameInput
            initial={w.name}
            onCommit={(v) => {
              rename(w.id, v);
              setEditingId(null);
            }}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <button type="button" className="rm-ws-name" onClick={() => pick(w.id)}>
            {w.name}
          </button>
        )}
        {!isViewer && !isEditing && (
          <span className="rm-ws-row-actions">
            <IconButton icon="edit" label="Edit" onClick={() => setEditingId(w.id)} />
            <IconButton
              icon="trash"
              label="Delete"
              onClick={() => {
                setTyped("");
                setConfirm({ id: w.id, name: w.name });
              }}
            />
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="rm-ws-switcher" ref={ref}>
      <div className="rm-ws-trigger">
        <span
          className={`codicon codicon-${active ? typeIcon(active) : "account"} rm-ws-trigger-icon`}
          aria-hidden="true"
        />
        <input
          className="rm-input rm-ws-search"
          aria-label="Switch workspace"
          aria-expanded={open}
          placeholder="Search Workspaces"
          value={open ? query : active?.name ?? ""}
          onFocus={openPopup}
          onClick={openPopup}
          onChange={(e) => {
            openPopup();
            setQuery(e.target.value);
          }}
        />
        <span className="codicon codicon-chevron-down rm-ws-chevron" aria-hidden="true" />
      </div>

      {active?.role && <span className="rm-role-badge">{ROLE_LABEL[active.role]}</span>}

      {authEmail && active && (
        synced ? (
          <div className="rm-sync-status">
            <span className="codicon codicon-cloud" aria-hidden="true" />
            <span className="rm-sync-status-text">
              synced · {ROLE_LABEL[active.role ?? "owner"]}
            </span>
            <button
              type="button"
              className="rm-sync-now"
              onClick={() => postToHost({ type: "syncNow", workspaceId: active.id })}
            >
              Sync Now
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="rm-btn rm-btn--ghost rm-btn--sm rm-sync-enable"
            onClick={() => postToHost({ type: "enableSync", workspaceId: active.id })}
          >
            <span className="codicon codicon-cloud-upload" aria-hidden="true" />
            Enable Sync
          </button>
        )
      )}

      {!isViewer && (
        <IconButton
          icon="cloud-download"
          label="import collection"
          onClick={() => postToHost({ type: "importCollection" })}
        />
      )}

      {isOwner && active && (
        <IconButton
          icon="organization"
          label="members"
          onClick={() => postToHost({ type: "openMembers", workspaceId: active.id })}
        />
      )}

      {open && (
        <div className="rm-ws-popup" role="dialog" aria-label="Workspace switcher">
          {!isViewer && (
            <div className="rm-ws-popup-head">
              <button
                type="button"
                className="rm-btn rm-btn--primary rm-btn--sm rm-ws-create"
                onClick={() => {
                  create("New Workspace");
                  closePopup();
                }}
              >
                Create Workspace
              </button>
            </div>
          )}

          <div className="rm-ws-list" role="listbox" aria-label="Workspaces">
            {recentItems.length > 0 && (
              <>
                <div className="rm-ws-section">Recently Visited</div>
                {recentItems.map(renderRow)}
              </>
            )}
            {moreItems.length > 0 && (
              <>
                <div className="rm-ws-section">More Workspaces</div>
                {moreItems.map(renderRow)}
              </>
            )}
            {recentItems.length === 0 && moreItems.length === 0 && (
              <div className="rm-ws-empty">No workspaces found</div>
            )}
          </div>
        </div>
      )}

      {confirm && (
        <div className="rm-modal-scrim" onClick={() => setConfirm(null)}>
          <div
            className="rm-modal"
            role="dialog"
            aria-label="delete workspace"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rm-modal-title">Delete workspace</div>
            <div className="rm-modal-body">
              This <strong>permanently</strong> deletes “{confirm.name}” and all
              its collections, environments and history. This can’t be undone.
              <br />
              Type <code>{confirm.name}</code> to confirm.
            </div>
            <input
              className="rm-input"
              aria-label="confirm workspace name"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirm.name}
            />
            <div className="rm-modal-actions">
              <button className="rm-btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="rm-btn rm-btn--danger"
                disabled={typed !== confirm.name}
                onClick={() => {
                  remove(confirm.id);
                  setConfirm(null);
                }}
              >
                Delete workspace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
