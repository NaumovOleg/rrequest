import { SplitButton } from "../../elements";
import { WorkspaceSwitcher } from "../WorkspaceSwitcher/WorkspaceSwitcher";
import { useStore } from "../../state/store";
import { postToHost } from "../../ipc";

export type SidebarTab = "collections" | "environments" | "history" | "trash";

export function SidebarHeader({
  tab,
  onTab,
  onNewHttp,
  onNewWs,
  onNewGrpc,
}: {
  tab: SidebarTab;
  onTab: (t: SidebarTab) => void;
  onNewHttp: () => void;
  onNewWs: () => void;
  onNewGrpc: () => void;
}) {
  const isViewer = useStore((s) => s.isViewer());
  const authEmail = useStore((s) => s.authEmail);
  return (
    <header className="rm-sbhead">
      <div className="rm-account">
        {authEmail ? (
          <>
            <span className="codicon codicon-account" />
            <span className="rm-account-email" title={authEmail}>{authEmail}</span>
            <button type="button" className="rm-linkbtn" onClick={() => postToHost({ type: "signOut" })}>
              Sign out
            </button>
          </>
        ) : (
          <button type="button" className="rm-btn rm-btn--ghost" onClick={() => postToHost({ type: "signIn" })}>
            <span className="codicon codicon-account" /> Sign in with Google
          </button>
        )}
      </div>
      <WorkspaceSwitcher />
      <SplitButton
        label="New HTTP Request"
        onClick={onNewHttp}
        disabled={isViewer}
        items={[
          { label: "New HTTP Request", icon: "add", onClick: onNewHttp },
          { label: "New gRPC Request", icon: "server-process", onClick: onNewGrpc },
          { label: "New WebSocket", icon: "plug", onClick: onNewWs },
        ]}
      />
      <div className="rm-sbtabs" role="tablist">
        <button
          type="button"
          className={`rm-sbtab${tab === "collections" ? " is-active" : ""}`}
          role="tab"
          aria-selected={tab === "collections"}
          aria-label="Collections"
          title="Collections"
          onClick={() => onTab("collections")}
        >
          <span className="codicon codicon-library" />
        </button>
        <button
          type="button"
          className={`rm-sbtab${tab === "environments" ? " is-active" : ""}`}
          role="tab"
          aria-selected={tab === "environments"}
          aria-label="Environments"
          title="Environments"
          onClick={() => onTab("environments")}
        >
          <span className="codicon codicon-globe" />
        </button>
        <button
          type="button"
          className={`rm-sbtab${tab === "history" ? " is-active" : ""}`}
          role="tab"
          aria-selected={tab === "history"}
          aria-label="History"
          title="History"
          onClick={() => onTab("history")}
        >
          <span className="codicon codicon-history" />
        </button>
        <button
          type="button"
          className={`rm-sbtab${tab === "trash" ? " is-active" : ""}`}
          role="tab"
          aria-selected={tab === "trash"}
          aria-label="Trash"
          title="Trash"
          onClick={() => onTab("trash")}
        >
          <span className="codicon codicon-trash" />
        </button>
      </div>
    </header>
  );
}
