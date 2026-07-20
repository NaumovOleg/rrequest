import { useState } from "react";
import { IconButton, ComboInput } from "../../elements";
import { useWorkspace } from "../../state/useWorkspace";
import { postToHost } from "../../ipc";

export function WorkspaceSwitcher() {
  const { workspaces, active, create, rename, remove, select } = useWorkspace();
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const [typed, setTyped] = useState("");

  return (
    <div className="rm-ws-row">
      <ComboInput
        items={workspaces.map((w) => ({ value: w.id, label: w.name }))}
        value={active?.name ?? ""}
        placeholder="No workspace"
        onChange={() => {}}
        onSelect={(item) => select(item.value)}
        onEdit={(item, newName) => rename(item.value, newName)}
        onDelete={(item) => {
          setTyped("");
          setConfirm({ id: item.value, name: item.label });
        }}
      />
      <IconButton
        icon="cloud-download"
        label="import collection"
        onClick={() => postToHost({ type: "importCollection" })}
      />
      <IconButton
        icon="add"
        label="new workspace"
        onClick={() => create("New Workspace")}
      />

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
