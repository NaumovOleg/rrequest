import { useState } from "react";
import { useStore } from "../../state/store";
import { postToHost } from "../../ipc";
import { IconButton } from "../../elements/IconButton";
import { RenameInput } from "../../elements/RenameInput";

export function WorkspaceSwitcher() {
  const workspaces = useStore((s) => s.workspaces);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const active = workspaces.find((w) => w.id === activeWorkspaceId);
  const [renaming, setRenaming] = useState(false);

  return (
    <div className="rm-section">
      <span className="rm-section-title">Workspace</span>
      <div className="rm-row">
        <select
          className="rm-select"
          aria-label="active workspace"
          value={activeWorkspaceId ?? ""}
          onChange={(e) =>
            postToHost({ type: "setActiveWorkspace", id: e.target.value })
          }
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <div className="rm-actions">
          <IconButton
            icon="add"
            label="new workspace"
            onClick={() =>
              postToHost({ type: "createWorkspace", name: "New Workspace" })
            }
          />
          {renaming ? (
            <RenameInput
              initial={active?.name ?? ""}
              onCommit={(name) => {
                if (activeWorkspaceId)
                  postToHost({
                    type: "renameWorkspace",
                    id: activeWorkspaceId,
                    name,
                  });
                setRenaming(false);
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <IconButton
              icon="edit"
              label="rename workspace"
              onClick={() => setRenaming(true)}
            />
          )}
          <IconButton
            icon="trash"
            label="delete workspace"
            onClick={() => {
              if (activeWorkspaceId)
                postToHost({ type: "deleteWorkspace", id: activeWorkspaceId });
            }}
          />
          <button
            className="rm-btn"
            title="Environments"
            onClick={() => postToHost({ type: "openEnvironments" })}
          >
            Environments
          </button>
        </div>
      </div>
    </div>
  );
}
