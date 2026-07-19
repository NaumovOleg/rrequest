import { IconButton, ComboInput } from "../../elements";
import { useWorkspace } from "../../state/useWorkspace";
import { postToHost } from "../../ipc";

export function WorkspaceSwitcher() {
  const { workspaces, active, create, rename, remove, select } = useWorkspace();

  return (
    <div className="rm-ws-row">
      <ComboInput
        items={workspaces.map((w) => ({ value: w.id, label: w.name }))}
        value={active?.name ?? ""}
        placeholder="No workspace"
        onChange={() => {}}
        onSelect={(item) => select(item.value)}
        onEdit={(item, newName) => rename(item.value, newName)}
        onDelete={(item) => remove(item.value)}
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
    </div>
  );
}
