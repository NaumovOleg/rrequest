import { SplitButton } from "../../elements";
import { WorkspaceSwitcher } from "../WorkspaceSwitcher/WorkspaceSwitcher";

export type SidebarTab = "collections" | "environments" | "history";

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
  return (
    <header className="rm-sbhead">
      <WorkspaceSwitcher />
      <SplitButton
        label="New HTTP Request"
        onClick={onNewHttp}
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
      </div>
    </header>
  );
}
