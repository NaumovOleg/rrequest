import { useStore } from "./store";
import { postToHost } from "../ipc";

/**
 * Shared workspace layer over the Zustand store + host IPC.
 *
 * State (workspaces / active id) is filled by the host's broadcast snapshot,
 * so both the sidebar and editor webviews stay in sync. Every action below is
 * fire-and-forget: the host persists, then re-broadcasts a fresh snapshot whose
 * `tree` is already filtered to the active workspace — which is why switching
 * or deleting a workspace reloads the active collections in every webview with
 * no extra work here.
 */
export function useWorkspace() {
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeWorkspaceId);
  const active = workspaces.find((w) => w.id === activeId) ?? null;

  return {
    workspaces,
    activeId,
    active,
    create: (name: string) => postToHost({ type: "createWorkspace", name }),
    rename: (id: string, name: string) =>
      postToHost({ type: "renameWorkspace", id, name }),
    remove: (id: string) => postToHost({ type: "deleteWorkspace", id }),
    select: (id: string) => postToHost({ type: "setActiveWorkspace", id }),
  };
}
