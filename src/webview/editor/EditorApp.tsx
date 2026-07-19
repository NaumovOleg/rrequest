import { useEffect } from "react";
import "../theme.css";
import { useStore } from "../state/store";
import { onHostMessage, postToHost } from "../ipc";
import { Tabs, EnvDropdown } from "../components";
import { RequestPanel } from "../views/RequestPanel/RequestPanel";
import { ResponsePanel } from "../views/ResponsePanel/ResponsePanel";
import { WebSocketPanel } from "../views/WebSocket/WebSocketPanel";
import { Environments } from "../views/Environments/Environments";

export function EditorApp() {
  const setTree = useStore((s) => s.setTree);
  const setResponse = useStore((s) => s.setResponse);
  const setEnvironments = useStore((s) => s.setEnvironments);
  const setActiveEnvId = useStore((s) => s.setActiveEnvId);
  const openNewTab = useStore((s) => s.openNewTab);
  const openOrReplaceBlank = useStore((s) => s.openOrReplaceBlank);
  const setPendingSaveCollectionId = useStore(
    (s) => s.setPendingSaveCollectionId,
  );
  const setPendingSaveFolderId = useStore((s) => s.setPendingSaveFolderId);
  const wsMode = useStore((s) => s.wsMode);
  const setWsMode = useStore((s) => s.setWsMode);
  const wsSetStatus = useStore((s) => s.wsSetStatus);
  const wsAppendLog = useStore((s) => s.wsAppendLog);
  const envMode = useStore((s) => s.envMode);
  const setEnvMode = useStore((s) => s.setEnvMode);
  const setEnvEditId = useStore((s) => s.setEnvEditId);

  useEffect(() => {
    const off = onHostMessage((m) => {
      if (m.type === "tree") setTree(m.collections);
      else if (m.type === "environments") {
        setEnvironments(m.environments);
        setActiveEnvId(m.activeId);
      } else if (m.type === "response") setResponse(m.requestId, m.payload);
      else if (m.type === "openInEditor") {
        const r = m.request;
        // Carry the full request (id + auth included) and link it to its
        // collection/folder so editor edits round-trip to the tree.
        openOrReplaceBlank({
          ...r,
          preRequestScript: r.preRequestScript ?? "",
          testScript: r.testScript ?? "",
          collectionId: m.targetCollectionId,
          folderId: m.targetFolderId ?? null,
        });
        setPendingSaveCollectionId(m.targetCollectionId ?? null);
        setPendingSaveFolderId(m.targetFolderId ?? null);
      } else if (m.type === "showEnvironments") {
        setEnvMode(true);
        setEnvEditId(m.id ?? null);
      } else if (m.type === "showWebSocket") {
        setWsMode(true);
      } else if (m.type === "pickedFile") {
        const st = useStore.getState();
        const pending = st.pendingFilePick;
        if (pending) {
          const tab = st.tabs.find((t) => t.id === pending.tabId);
          if (tab && tab.body.mode === "formdata") {
            const items = tab.body.items.map((it, i) =>
              i === pending.index && it.kind === "file"
                ? { ...it, path: m.path, filename: m.filename }
                : it,
            );
            st.setTabBody(pending.tabId, { mode: "formdata", items });
          }
          st.setPendingFilePick(null);
        }
      } else if (m.type === "wsOpen") {
        if (m.connId === useStore.getState().wsConnId) {
          wsSetStatus("open");
          wsAppendLog({ dir: "status", data: "connected", at: Date.now() });
        }
      } else if (m.type === "wsMessage") {
        if (m.connId === useStore.getState().wsConnId)
          wsAppendLog({ dir: "in", data: m.data, at: m.at });
      } else if (m.type === "wsClosed") {
        if (m.connId === useStore.getState().wsConnId) {
          wsSetStatus("closed");
          wsAppendLog({
            dir: "status",
            data: `closed: ${m.code}`,
            at: Date.now(),
          });
        }
      } else if (m.type === "wsError") {
        if (m.connId === useStore.getState().wsConnId)
          wsAppendLog({
            dir: "status",
            data: `error: ${m.message}`,
            at: Date.now(),
          });
      }
    });
    postToHost({ type: "ready" });
    postToHost({ type: "loadEnvironments" });
    if (useStore.getState().tabs.length === 0) openNewTab();
    return off;
  }, [
    setTree,
    setResponse,
    setEnvironments,
    setActiveEnvId,
    openNewTab,
    openOrReplaceBlank,
    setPendingSaveCollectionId,
    setPendingSaveFolderId,
    wsSetStatus,
    wsAppendLog,
    setEnvMode,
    setEnvEditId,
    setWsMode,
  ]);

  return (
    <div className="rm-surface">
      <div className="rm-topbar">
        <button
          className={`rm-btn${wsMode ? " is-active" : ""}`}
          aria-pressed={wsMode}
          onClick={() => setWsMode(!wsMode)}
        >
          WebSocket
        </button>
        <button
          className={`rm-btn${envMode ? " is-active" : ""}`}
          aria-pressed={envMode}
          onClick={() => setEnvMode(!envMode)}
        >
          Environments
        </button>
        <div className="rm-spacer" />
        <EnvDropdown />
      </div>
      {envMode ? (
        <Environments />
      ) : wsMode ? (
        <WebSocketPanel />
      ) : (
        <>
          <Tabs />
          <RequestPanel />
          <ResponsePanel />
        </>
      )}
    </div>
  );
}
