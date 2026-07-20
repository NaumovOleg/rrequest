import { useEffect, useState } from "react";
import "../theme.css";
import { useStore } from "../state/store";
import { onHostMessage, postToHost } from "../ipc";
import { newId, type RestRequest } from "../../shared/types";
import {
  SidebarHeader,
  type SidebarTab,
} from "../views/SidebarHeader/SidebarHeader";
import { Sidebar } from "../views/Sidebar/Sidebar";
import { SidebarEnvironments } from "../views/SidebarEnvironments/SidebarEnvironments";
import { TrashView } from "../views/Trash/TrashView";
import { History } from "../components";

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

export function SidebarApp() {
  const setTree = useStore((s) => s.setTree);
  const setEnvironments = useStore((s) => s.setEnvironments);
  const setActiveEnvId = useStore((s) => s.setActiveEnvId);
  const setWorkspaces = useStore((s) => s.setWorkspaces);
  const setHistory = useStore((s) => s.setHistory);
  const setTrash = useStore((s) => s.setTrash);
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
    });
    postToHost({ type: "ready" });
    postToHost({ type: "loadWorkspaces" });
    postToHost({ type: "loadEnvironments" });
    postToHost({ type: "loadHistory" });
    postToHost({ type: "loadTrash" });
    return off;
  }, [setTree, setEnvironments, setActiveEnvId, setWorkspaces, setHistory, setTrash]);

  return (
    <div className="rm-surface rm-surface--sidebar">
      <SidebarHeader
        tab={tab}
        onTab={setTab}
        onNewHttp={() =>
          postToHost({ type: "openRequest", request: blankRequest() })
        }
        onNewWs={() => postToHost({ type: "openWebSocket" })}
        onNewGrpc={() => postToHost({ type: "openGrpc" })}
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
    </div>
  );
}
