import { useEffect, useRef, useState } from "react";
import { IconButton, PopupMenu } from "../../elements";
import { RenameInput } from "../../elements/RenameInput";
import { useStore } from "../../state/store";
import { useWorkspace } from "../../state/useWorkspace";
import { postToHost } from "../../ipc";
import type { Workspace } from "../../../shared/types";

const ROLE_LABEL = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
} as const;

const AVATAR_COLORS = [
  "#e0823d",
  "#3fb950",
  "#4aa5f0",
  "#b180d7",
  "#d7ba7d",
  "#f14c4c",
  "#39c5cf",
];

// Deterministic color per email so an account reads the same everywhere.
function avatarColor(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++)
    h = ((h << 5) - h + email.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initialsOf(email: string): string {
  const s = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
  if (!s) return "?";
  const caps = s.match(/[A-Z0-9]/g) ?? [];
  return (caps.length >= 2 ? caps[0] + caps[1] : s.slice(0, 2)).toUpperCase();
}

/** Inline "new workspace" row: type a name, Enter creates, Escape cancels. */
function WorkspaceCreateRow({
  onCommit,
  onCancel,
}: {
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const done = useRef(false);
  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };
  const commit = () => {
    const v = value.trim();
    if (v) finish(() => onCommit(v));
    else finish(onCancel);
  };
  return (
    <div className="rm-acct-create" role="presentation">
      <input
        className="rm-input rm-create-input"
        aria-label="new workspace name"
        autoFocus
        placeholder="Workspace name…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(onCancel);
          }
        }}
      />
    </div>
  );
}

/**
 * Top-of-sidebar workspace switcher: a trigger showing the active workspace +
 * its account (or "Local"); clicking opens a scrollable popup that groups every
 * connected account with its workspaces nested underneath. Inline creation
 * (type a name, press Enter), a filter box, and a primary sign-in CTA replace
 * the old "create 'New Workspace', then rename it" and the buried "Add account".
 */
export function AccountsPanel() {
  const accounts = useStore((s) => s.accounts);
  const isViewer = useStore((s) => s.isViewer());
  const syncLoading = useStore((s) => s.syncLoading);
  // Whether a sync in flight covers a given row: 'all' (startup/sign-in)
  // spins everything; an account scope spins its head + workspaces; a
  // workspace scope spins only that row. Keeps one click from spinning every
  // sync icon in the popup.
  const coversAccount = (id: string) =>
    !!syncLoading &&
    (syncLoading.kind === "all" ||
      (syncLoading.kind === "account" && syncLoading.id === id));
  const coversWorkspace = (id: string) =>
    !!syncLoading &&
    (syncLoading.kind === "all" ||
      (syncLoading.kind === "workspace" && syncLoading.id === id) ||
      (syncLoading.kind === "account" &&
        workspaces.find((w) => w.id === id)?.accountId === syncLoading.id));
  const { workspaces, activeId, active, create, rename, remove, select } =
    useWorkspace();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(
    null
  );
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  // accountId is the workspace's target account; undefined means a local one.
  const [creating, setCreating] = useState<{ accountId?: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const localWorkspaces = workspaces.filter(
    (w) => !w.accountId || !accounts.some((a) => a.id === w.accountId)
  );
  const activeAccountEmail = active?.accountId
    ? accounts.find((a) => a.id === active.accountId)?.email ?? null
    : null;

  const pick = (id: string) => {
    select(id);
    setOpen(false);
  };

  // Binds an existing workspace to an account (the recovery path when creating
  // "in" an account left it local, and the only way to promote a workspace that
  // started out local). One account -> a single button; several -> a picker.
  const syncToAccount = (w: Workspace) => {
    const enable = (accountId: string) =>
      postToHost({ type: "enableSync", workspaceId: w.id, accountId });
    if (accounts.length === 0) return null;
    if (accounts.length === 1) {
      return (
        <IconButton
          icon="cloud-upload"
          label={`Sync “${w.name}” to ${accounts[0].email}`}
          onClick={() => enable(accounts[0].id)}
        />
      );
    }
    return (
      <PopupMenu
        icon="cloud-upload"
        label={`Sync “${w.name}” to an account`}
        items={[
          { kind: "header", label: "Sync to account" },
          ...accounts.map((a) => ({
            label: a.email,
            icon: "account",
            onClick: () => enable(a.id),
          })),
        ]}
      />
    );
  };

  const rowActions = (w: Workspace, isEditing: boolean) => (
    <span className="rm-acct-ws-actions">
      {/* A workspace listed under an account but not actually synced (enable
          failed, or sync was dropped on sign-out) can be re-bound from here. */}
      {!w.synced && w.role !== "viewer" && !isEditing && syncToAccount(w)}
      {w.synced && w.role === "owner" && (
        <IconButton
          icon="organization"
          label="Share / invite people"
          onClick={() => {
            postToHost({ type: "openMembers", workspaceId: w.id });
            setOpen(false);
          }}
        />
      )}
      {w.synced && (
        <IconButton
          icon="sync"
          spin={coversWorkspace(w.id)}
          disabled={coversWorkspace(w.id)}
          label="Sync now"
          onClick={() => postToHost({ type: "syncNow", workspaceId: w.id })}
        />
      )}
      {w.synced && (
        <IconButton
          icon={w.pollEnabled === false ? "sync-ignored" : "debug-pause"}
          label={
            w.pollEnabled === false
              ? `Resume auto-sync for “${w.name}” — pull it on a schedule again`
              : `Pause auto-sync for “${w.name}” — stop pulling it (pushes still work)`
          }
          onClick={() =>
            postToHost({
              type: "setWorkspacePolling",
              workspaceId: w.id,
              enabled: w.pollEnabled === false,
            })
          }
        />
      )}
      {w.role !== "viewer" && !isEditing && (
        <>
          <IconButton
            icon="edit"
            label="Rename"
            onClick={() => setEditingId(w.id)}
          />
          <IconButton
            icon="trash"
            label="Delete"
            onClick={() => {
              setTyped("");
              setConfirm({ id: w.id, name: w.name });
            }}
          />
        </>
      )}
    </span>
  );

  // Shared row for both account-bound and local workspaces: avatar dot, name,
  // role badge, hover actions.
  const workspaceRow = (w: Workspace) => {
    const isActive = w.id === activeId;
    const isEditing = editingId === w.id;
    return (
      <div
        key={w.id}
        className={`rm-acct-ws${isActive ? " is-active" : ""}`}
        role="option"
        aria-selected={isActive}
        data-testid={isActive ? "active-workspace" : undefined}
      >
        <span className="rm-acct-ws-dot">
          {isActive && <span className="codicon codicon-circle-filled" />}
        </span>
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
          <button
            type="button"
            className="rm-acct-ws-name"
            onClick={() => pick(w.id)}
          >
            {w.name}
          </button>
        )}
        {w.role && w.role !== "owner" && (
          <span className="rm-role-badge">{ROLE_LABEL[w.role]}</span>
        )}
        {rowActions(w, isEditing)}
      </div>
    );
  };

  const q = query.trim().toLowerCase();
  const wsMatches = (w: Workspace) => !q || w.name.toLowerCase().includes(q);
  const filteredLocal = localWorkspaces.filter(wsMatches);
  const accountGroups = accounts
    .map((a) => {
      const wss = workspaces.filter(
        (w) => w.accountId === a.id && wsMatches(w)
      );
      return {
        account: a,
        wss,
        visible: !q || a.email.toLowerCase().includes(q) || wss.length > 0,
      };
    })
    .filter((g) => g.visible || creating?.accountId === g.account.id);

  const showLocal =
    filteredLocal.length > 0 ||
    (creating !== null && creating.accountId === undefined);

  const triggerAvatar = activeAccountEmail ? (
    <span
      className="rm-avatar"
      style={{ background: avatarColor(activeAccountEmail) }}
    >
      {initialsOf(activeAccountEmail)}
    </span>
  ) : (
    <span
      className="codicon codicon-device-desktop rm-accts-trigger-icon"
      aria-hidden="true"
    />
  );

  return (
    <div className="rm-accts" ref={ref}>
      <div className="rm-accts-bar">
        <button
          type="button"
          className="rm-accts-trigger"
          aria-label="Switch account or workspace"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {syncLoading?.kind === "all" ? (
            <span
              className={`codicon codicon-loading rm-spin rm-accts-trigger-icon`}
              aria-hidden="true"
            />
          ) : (
            triggerAvatar
          )}
          <span className="rm-accts-current">
            <span className="rm-accts-current-name">
              {active?.name ?? "No workspace"}
            </span>
            <span className="rm-accts-current-sub">
              {activeAccountEmail ?? "Local · not synced"}
            </span>
          </span>
          <span
            className="codicon codicon-chevron-down rm-accts-chevron"
            aria-hidden="true"
          />
        </button>
        {!isViewer && (
          <IconButton
            icon="cloud-download"
            label="Import collection"
            onClick={() => postToHost({ type: "importCollection" })}
          />
        )}
      </div>

      {open && (
        <div
          className="rm-accts-popup"
          role="dialog"
          aria-label="Accounts and workspaces"
        >
          <div className="rm-accts-scroll">
            <div className="rm-accts-search">
              <span
                className="codicon codicon-search rm-accts-search-icon"
                aria-hidden="true"
              />
              <input
                className="rm-input rm-accts-search-input"
                aria-label="filter workspaces"
                placeholder="Filter workspaces…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  className="rm-icon-btn"
                  aria-label="clear workspace filter"
                  onClick={() => setQuery("")}
                >
                  <span className="codicon codicon-close" />
                </button>
              )}
            </div>

            {accountGroups.map(({ account: a, wss }) => (
              <div key={a.id} className="rm-acct">
                <div className="rm-acct-head">
                  <span
                    className="rm-avatar rm-avatar--sm"
                    style={{ background: avatarColor(a.email) }}
                  >
                    {initialsOf(a.email)}
                  </span>
                  <span className="rm-acct-email" title={a.email}>
                    {a.email}
                  </span>
                  <IconButton
                    icon="sync"
                    spin={coversAccount(a.id)}
                    disabled={coversAccount(a.id)}
                    label={`Force sync ${a.email} — pull all its workspaces now`}
                    onClick={() =>
                      postToHost({ type: "syncAccount", accountId: a.id })
                    }
                  />
                  <IconButton
                    icon="add"
                    label={`New workspace in ${a.email}`}
                    onClick={() =>
                      setCreating(
                        creating?.accountId === a.id
                          ? null
                          : { accountId: a.id }
                      )
                    }
                  />
                  <IconButton
                    icon="sign-out"
                    label={`Sign out ${a.email}`}
                    onClick={() =>
                      postToHost({ type: "signOut", accountId: a.id })
                    }
                  />
                </div>
                <div
                  className="rm-acct-list"
                  role="listbox"
                  aria-label={`${a.email} workspaces`}
                >
                  {creating?.accountId === a.id && (
                    <WorkspaceCreateRow
                      onCommit={(name) => {
                        create(name, a.id);
                        setCreating(null);
                      }}
                      onCancel={() => setCreating(null)}
                    />
                  )}
                  {wss.length ? (
                    wss.map(workspaceRow)
                  ) : (
                    <div className="rm-acct-empty">No synced workspaces</div>
                  )}
                </div>
              </div>
            ))}

            {showLocal && (
              <div className="rm-acct">
                <div className="rm-acct-head">
                  <span className="codicon codicon-device-desktop" />
                  <span className="rm-acct-email">Local (not synced)</span>
                </div>
                <div
                  className="rm-acct-list"
                  role="listbox"
                  aria-label="Local workspaces"
                >
                  {creating !== null && creating.accountId === undefined && (
                    <WorkspaceCreateRow
                      onCommit={(name) => {
                        create(name);
                        setCreating(null);
                      }}
                      onCancel={() => setCreating(null)}
                    />
                  )}
                  {filteredLocal.map(workspaceRow)}
                </div>
              </div>
            )}
          </div>

          <div className="rm-acct-actions">
            <button
              type="button"
              className={`rm-btn rm-btn--sm ${
                accounts.length === 0 ? "rm-btn--primary" : "rm-btn--ghost"
              }`}
              onClick={() => postToHost({ type: "signIn" })}
            >
              <span className="codicon codicon-account" />{" "}
              {accounts.length === 0 ? "Sign in to sync" : "Add account"}
            </button>
            {!isViewer && (
              <button
                type="button"
                className="rm-btn rm-btn--sm rm-btn--ghost"
                onClick={() =>
                  setCreating(
                    creating !== null && creating.accountId === undefined
                      ? null
                      : {}
                  )
                }
              >
                <span className="codicon codicon-add" /> New workspace
              </button>
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
