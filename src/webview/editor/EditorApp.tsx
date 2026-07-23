import { useEffect } from "react";
import "../theme.css";
import { useStore } from "../state/store";
import { onHostMessage, postToHost } from "../ipc";
import { RequestPanel } from "../views/RequestPanel/RequestPanel";
import { WebSocketPanel } from "../views/WebSocket/WebSocketPanel";
import { Environments } from "../views/Environments/Environments";
import { GrpcPanel } from "../views/Grpc/GrpcPanel";
import { Members } from "../views/Members/Members";
import { Toaster } from "../elements";

export function EditorApp() {
  const setTree = useStore((s) => s.setTree);
  const setResponse = useStore((s) => s.setResponse);
  const setEnvironments = useStore((s) => s.setEnvironments);
  const setActiveEnvId = useStore((s) => s.setActiveEnvId);
  const openLinkedTab = useStore((s) => s.openLinkedTab);
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
  const grpcMode = useStore((s) => s.grpcMode);
  const setGrpcMode = useStore((s) => s.setGrpcMode);
  const membersMode = useStore((s) => s.membersMode);
  const setMembersMode = useStore((s) => s.setMembersMode);
  const setMembersWorkspaceId = useStore((s) => s.setMembersWorkspaceId);
  const setMembers = useStore((s) => s.setMembers);
  const pushToast = useStore((s) => s.pushToast);
  const active = useStore((s) => s.tabs.find((x) => x.id === s.activeTabId));
  const activeLabel = active ? `${active.method} ${active.name}` : undefined;
  const activeMethod = active?.method;

  // Keep the VS Code editor tab titled + iconed after the request. gRPC/WebSocket
  // panels post their own title/icon, so skip them here.
  useEffect(() => {
    if (wsMode || grpcMode) return;
    if (membersMode) {
      postToHost({ type: "setTitle", title: "Members" });
    } else if (envMode) {
      postToHost({ type: "setTitle", title: "Environments" });
    } else if (activeLabel && activeMethod) {
      postToHost({ type: "setTitle", title: activeLabel, icon: `method-${activeMethod}` });
    }
  }, [activeLabel, activeMethod, envMode, wsMode, grpcMode, membersMode]);

  useEffect(() => {
    const off = onHostMessage((m) => {
      if (m.type === "tree") setTree(m.collections);
      else if (m.type === "environments") {
        setEnvironments(m.environments);
        setActiveEnvId(m.activeId);
      } else if (m.type === "response") setResponse(m.requestId, m.payload);
      else if (m.type === "openInEditor") {
        const r = m.request;
        // Each request opens in its own editor tab (focus it if already open).
        openLinkedTab(
          {
            ...r,
            preRequestScript: r.preRequestScript ?? "",
            testScript: r.testScript ?? "",
          },
          m.targetCollectionId,
          m.targetFolderId ?? null,
        );
        setPendingSaveCollectionId(m.targetCollectionId ?? null);
        setPendingSaveFolderId(m.targetFolderId ?? null);
      } else if (m.type === "showEnvironments") {
        setEnvMode(true);
        setEnvEditId(m.id ?? null);
      } else if (m.type === "showWebSocket" || m.type === "openWsRequest") {
        setWsMode(true);
      } else if (m.type === "showGrpc" || m.type === "openGrpcRequest") {
        setGrpcMode(true);
      } else if (m.type === "showMembers") {
        setMembersMode(true);
        setMembersWorkspaceId(m.workspaceId);
      } else if (m.type === "members") {
        setMembers(m.members);
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
      } else if (m.type === "toast") {
        pushToast(m.level, m.message);
      }
    });
    postToHost({ type: "ready" });
    postToHost({ type: "loadEnvironments" });
    // No auto-blank tab: each panel is opened with exactly one request/env/ws
    // message by the host, so it renders that and nothing else.
    return off;
  }, [
    setTree,
    setResponse,
    setEnvironments,
    setActiveEnvId,
    openLinkedTab,
    setPendingSaveCollectionId,
    setPendingSaveFolderId,
    wsSetStatus,
    wsAppendLog,
    setEnvMode,
    setEnvEditId,
    setWsMode,
    setGrpcMode,
    setMembersMode,
    setMembersWorkspaceId,
    setMembers,
    pushToast,
  ]);

  return (
    <div className="rm-surface">
      {envMode ? (
        <Environments />
      ) : wsMode ? (
        <WebSocketPanel />
      ) : grpcMode ? (
        <GrpcPanel />
      ) : membersMode ? (
        <Members />
      ) : (
        <RequestPanel />
      )}
      <Toaster />
    </div>
  );
}
