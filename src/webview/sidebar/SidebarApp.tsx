import { useEffect, useState } from "react";
import "../theme.css";
import { useStore } from "../state/store";
import { onHostMessage, postToHost } from "../ipc";
import {
  newId,
  type RestRequest,
  type WsRequest,
  type GrpcRequest,
} from "../../shared/types";
import {
  SidebarHeader,
  type SidebarTab,
} from "../views/SidebarHeader/SidebarHeader";
import { Sidebar } from "../views/Sidebar/Sidebar";
import { SidebarEnvironments } from "../views/SidebarEnvironments/SidebarEnvironments";
import { TrashView } from "../views/Trash/TrashView";
import { History } from "../components";
import { Toaster } from "../elements";

function blankRequest(): RestRequest {
  return {
    id: newId(),
    name: "Untitled",
    method: "GET",
    url: "",
    params: [],
    headers: [],
    body: { mode: "none" },
    preRequestScript: "",
    testScript: "",
  };
}

// New WS/gRPC requests open through openRequest (kinded) so the host keys the
// panel by id (ws:<id> / grpc:<id>) — the SAME key used when the saved request
// is reopened from the sidebar. Opening the singleton "New" panel instead left
// a second panel behind, so clicking the saved item spawned a duplicate tab.
function blankWs(): WsRequest {
  return {
    id: newId(),
    name: "New WebSocket Request",
    kind: "ws",
    url: "",
    headers: [],
  };
}
function blankGrpc(): GrpcRequest {
  return {
    id: newId(),
    name: "New gRPC Request",
    kind: "grpc",
    address: "",
    proto: "",
    service: "",
    method: "",
    message: "",
    metadata: [],
    plaintext: true,
  };
}

export function SidebarApp() {
  const setTree = useStore((s) => s.setTree);
  const setEnvironments = useStore((s) => s.setEnvironments);
  const setActiveEnvId = useStore((s) => s.setActiveEnvId);
  const setWorkspaces = useStore((s) => s.setWorkspaces);
  const setHistory = useStore((s) => s.setHistory);
  const setTrash = useStore((s) => s.setTrash);
  const pushToast = useStore((s) => s.pushToast);
  const [tab, setTab] = useState<SidebarTab>("collections");

  useEffect(() => {
    const off = onHostMessage((m) => {
      if (m.type === "tree") setTree(m.collections);
      else if (m.type === "environments") {
        setEnvironments(m.environments);
        setActiveEnvId(m.activeId);
      } else if (m.type === "workspaces")
        setWorkspaces(m.workspaces, m.activeId);
      else if (m.type === "history") setHistory(m.entries);
      else if (m.type === "trash") setTrash(m.entries);
      else if (m.type === "toast") pushToast(m.level, m.message);
      else if (m.type === "authState")
        useStore.getState().setAccounts(m.accounts);
      else if (m.type === "syncStatus")
        useStore.getState().setSyncLoading(m.loading ? m.scope : null);
    });
    postToHost({ type: "ready" });
    postToHost({ type: "loadWorkspaces" });
    postToHost({ type: "loadEnvironments" });
    postToHost({ type: "loadHistory" });
    postToHost({ type: "loadTrash" });
    return off;
  }, [
    setTree,
    setEnvironments,
    setActiveEnvId,
    setWorkspaces,
    setHistory,
    setTrash,
    pushToast,
  ]);

  return (
    <div className="rm-surface rm-surface--sidebar">
      <SidebarHeader
        tab={tab}
        onTab={setTab}
        onNewHttp={() =>
          postToHost({ type: "openRequest", request: blankRequest() })
        }
        onNewWs={() => postToHost({ type: "openRequest", request: blankWs() })}
        onNewGrpc={() =>
          postToHost({ type: "openRequest", request: blankGrpc() })
        }
      />
      <div className="rm-scroll rm-sbbody">
        {tab === "collections" ? (
          <Sidebar />
        ) : tab === "environments" ? (
          <SidebarEnvironments />
        ) : tab === "trash" ? (
          <TrashView />
        ) : (
          <History />
        )}
      </div>
      <Toaster />
    </div>
  );
}
