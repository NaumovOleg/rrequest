import { useEffect, useRef, useState } from "react";
import { IconButton } from "../../elements";
import { RenameInput } from "../../elements/RenameInput";
import { useStore } from "../../state/store";
import { useWorkspace } from "../../state/useWorkspace";
import { postToHost } from "../../ipc";
import type { Workspace } from "../../../shared/types";

const ROLE_LABEL = { owner: "Owner", editor: "Editor", viewer: "Viewer" } as const;

/**
 * Compact top-of-sidebar switcher: a single trigger showing the active
 * workspace + its account; clicking opens a scrollable popup that groups every
 * connected Google account with its own workspaces nested underneath (plus a
 * "Local" group). Kept as a dropdown so many accounts don't push the sidebar
 * down. Each workspace binds to one account (multi-account sync backend).
 */
export function AccountsPanel() {
  const accounts = useStore((s) => s.accounts);
  const isViewer = useStore((s) => s.isViewer());
  const { workspaces, activeId, active, create, rename, remove, select } = useWorkspace();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const [typed, setTyped] = useState("");
  const [enablingId, setEnablingId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const localWorkspaces = workspaces.filter(
    (w) => !w.accountId || !accounts.some((a) => a.id === w.accountId),
  );
  const activeAccountEmail = active?.accountId
    ? (accounts.find((a) => a.id === active.accountId)?.email ?? null)
    : null;

  const pick = (id: string) => { select(id); setOpen(false); };
  const enableSync = (workspaceId: string, accountId?: string) => {
    postToHost({ type: "enableSync", workspaceId, accountId });
    setEnablingId(null);
    setOpen(false);
  };

  const rowActions = (w: Workspace, isEditing: boolean) => (
    <span className="rm-acct-ws-actions">
      {w.synced && w.role === "owner" && (
        <IconButton icon="organization" label="Share / invite people" onClick={() => { postToHost({ type: "openMembers", workspaceId: w.id }); setOpen(false); }} />
      )}
      {w.synced && (
        <IconButton icon="sync" label="Sync now" onClick={() => postToHost({ type: "syncNow", workspaceId: w.id })} />
      )}
      {w.role !== "viewer" && !isEditing && (
        <>
          <IconButton icon="edit" label="Rename" onClick={() => setEditingId(w.id)} />
          <IconButton icon="trash" label="Delete" onClick={() => { setTyped(""); setConfirm({ id: w.id, name: w.name }); }} />
        </>
      )}
    </span>
  );

  const workspaceRow = (w: Workspace) => {
    const isActive = w.id === activeId;
    const isEditing = editingId === w.id;
    return (
      <div key={w.id} className={`rm-acct-ws${isActive ? " is-active" : ""}`} role="option" aria-selected={isActive} data-testid={isActive ? "active-workspace" : undefined}>
        <span className="rm-acct-ws-dot">{isActive && <span className="codicon codicon-circle-filled" />}</span>
        {isEditing ? (
          <RenameInput initial={w.name} onCommit={(v) => { rename(w.id, v); setEditingId(null); }} onCancel={() => setEditingId(null)} />
        ) : (
          <button type="button" className="rm-acct-ws-name" onClick={() => pick(w.id)}>{w.name}</button>
        )}
        {w.role && w.role !== "owner" && <span className="rm-role-badge">{ROLE_LABEL[w.role]}</span>}
        {rowActions(w, isEditing)}
      </div>
    );
  };

  const localRow = (w: Workspace) => {
    const isActive = w.id === activeId;
    const isEditing = editingId === w.id;
    const picking = enablingId === w.id;
    return (
      <div key={w.id} className={`rm-acct-ws${isActive ? " is-active" : ""}`} role="option" aria-selected={isActive}>
        <span className="rm-acct-ws-dot">{isActive && <span className="codicon codicon-circle-filled" />}</span>
        {isEditing ? (
          <RenameInput initial={w.name} onCommit={(v) => { rename(w.id, v); setEditingId(null); }} onCancel={() => setEditingId(null)} />
        ) : (
          <button type="button" className="rm-acct-ws-name" onClick={() => pick(w.id)}>{w.name}</button>
        )}
        <span className="rm-acct-ws-actions">
          {!isEditing && (
            <>
              {accounts.length <= 1 ? (
                <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => (accounts.length === 1 ? enableSync(w.id, accounts[0].id) : postToHost({ type: "signIn" }))}>
                  <span className="codicon codicon-cloud-upload" /> {accounts.length === 1 ? "Sync" : "Sign in"}
                </button>
              ) : (
                <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => setEnablingId(picking ? null : w.id)}>
                  <span className="codicon codicon-cloud-upload" /> Sync…
                </button>
              )}
              <IconButton icon="edit" label="Rename" onClick={() => setEditingId(w.id)} />
              <IconButton icon="trash" label="Delete" onClick={() => { setTyped(""); setConfirm({ id: w.id, name: w.name }); }} />
            </>
          )}
        </span>
        {picking && (
          <div className="rm-acct-pick">
            <span className="rm-acct-pick-label">Sync to:</span>
            {accounts.map((a) => (
              <button key={a.id} type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => enableSync(w.id, a.id)}>{a.email}</button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rm-accts" ref={ref}>
      <div className="rm-accts-bar">
        <button type="button" className="rm-accts-trigger" aria-label="Switch account or workspace" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="codicon codicon-account rm-accts-trigger-icon" aria-hidden="true" />
          <span className="rm-accts-current">
            <span className="rm-accts-current-name">{active?.name ?? "No workspace"}</span>
            <span className="rm-accts-current-sub">{activeAccountEmail ?? "Local"}</span>
          </span>
          <span className="codicon codicon-chevron-down rm-accts-chevron" aria-hidden="true" />
        </button>
        {!isViewer && (
          <IconButton icon="cloud-download" label="Import collection" onClick={() => postToHost({ type: "importCollection" })} />
        )}
      </div>

      {open && (
        <div className="rm-accts-popup" role="dialog" aria-label="Accounts and workspaces">
          <div className="rm-accts-scroll">
            {accounts.map((a) => {
              const wss = workspaces.filter((w) => w.accountId === a.id);
              return (
                <div key={a.id} className="rm-acct">
                  <div className="rm-acct-head">
                    <span className="codicon codicon-account" />
                    <span className="rm-acct-email" title={a.email}>{a.email}</span>
                    <IconButton icon="add" label={`New workspace in ${a.email}`} onClick={() => { create("New Workspace", a.id); setOpen(false); }} />
                    <IconButton icon="sign-out" label={`Sign out ${a.email}`} onClick={() => postToHost({ type: "signOut", accountId: a.id })} />
                  </div>
                  <div className="rm-acct-list" role="listbox" aria-label={`${a.email} workspaces`}>
                    {wss.length ? wss.map(workspaceRow) : <div className="rm-acct-empty">No synced workspaces</div>}
                  </div>
                </div>
              );
            })}

            {localWorkspaces.length > 0 && (
              <div className="rm-acct">
                <div className="rm-acct-head">
                  <span className="codicon codicon-device-desktop" />
                  <span className="rm-acct-email">Local (not synced)</span>
                </div>
                <div className="rm-acct-list" role="listbox" aria-label="Local workspaces">
                  {localWorkspaces.map(localRow)}
                </div>
              </div>
            )}
          </div>

          <div className="rm-acct-actions">
            <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => postToHost({ type: "signIn" })}>
              <span className="codicon codicon-add" /> Add account
            </button>
            <button type="button" className="rm-btn rm-btn--ghost rm-btn--sm" onClick={() => { create("New Workspace"); }}>
              <span className="codicon codicon-add" /> New workspace
            </button>
          </div>
        </div>
      )}

      {confirm && (
        <div className="rm-modal-scrim" onClick={() => setConfirm(null)}>
          <div className="rm-modal" role="dialog" aria-label="delete workspace" onClick={(e) => e.stopPropagation()}>
            <div className="rm-modal-title">Delete workspace</div>
            <div className="rm-modal-body">
              This <strong>permanently</strong> deletes “{confirm.name}” and all its collections,
              environments and history. This can’t be undone.<br />
              Type <code>{confirm.name}</code> to confirm.
            </div>
            <input className="rm-input" aria-label="confirm workspace name" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirm.name} />
            <div className="rm-modal-actions">
              <button className="rm-btn" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="rm-btn rm-btn--danger" disabled={typed !== confirm.name} onClick={() => { remove(confirm.id); setConfirm(null); }}>Delete workspace</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
