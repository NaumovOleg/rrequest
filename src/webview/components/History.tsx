import { useState } from "react";
import { useStore } from "../state/store";
import { postToHost } from "../ipc";
import { MethodBadge } from "../elements/MethodBadge";
import type { HistoryEntry } from "../../shared/types";

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}
function dayLabel(at: number): string {
  const d = new Date(at);
  const now = new Date();
  if (sameDay(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function statusClass(status: number): string {
  if (status >= 200 && status < 300) return "is-2xx";
  if (status >= 300 && status < 400) return "is-3xx";
  if (status >= 400 && status < 500) return "is-4xx";
  if (status >= 500) return "is-5xx";
  return "is-err";
}

// Group consecutive entries (already newest-first) by their day label.
function groupByDay(history: HistoryEntry[]): { label: string; items: HistoryEntry[] }[] {
  const groups: { label: string; items: HistoryEntry[] }[] = [];
  for (const e of history) {
    const label = dayLabel(e.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  }
  return groups;
}

export function History() {
  const history = useStore((s) => s.history);
  const [q, setQ] = useState("");
  const [confirming, setConfirming] = useState(false);

  const haystack = (e: HistoryEntry) =>
    `${e.request.method} ${e.request.url} ${e.request.name} ${e.status ?? ""}`.toLowerCase();
  const shown = q.trim()
    ? history.filter((e) => haystack(e).includes(q.trim().toLowerCase()))
    : history;
  const groups = groupByDay(shown);

  // VS Code webviews don't support window.confirm, so the destructive clear
  // asks via an in-page modal (same pattern as tab close). Confirming only
  // posts the message; the fresh snapshot clears the list.
  const clear = () => {
    if (history.length === 0) return;
    setConfirming(true);
  };

  return (
    <div className="rm-tree">
      <div className="rm-tree-head">
        <span className="rm-section-title">History</span>
        <div className="rm-actions">
          <button className="rm-icon-btn" aria-label="clear history" title="Clear history"
            disabled={history.length === 0} onClick={clear}>
            <span className="codicon codicon-clear-all" aria-hidden="true" />
          </button>
        </div>
      </div>
      {history.length === 0 ? (
        <div className="rm-empty">No requests sent yet.</div>
      ) : (
        <>
          <div className="rm-tree-search">
            <span className="codicon codicon-search rm-tree-search-icon" aria-hidden="true" />
            <input
              className="rm-input rm-tree-search-input"
              aria-label="search history"
              placeholder="Search history"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button className="rm-icon-btn rm-tree-search-clear" aria-label="clear search" onClick={() => setQ("")}>
                <span className="codicon codicon-close" aria-hidden="true" />
              </button>
            )}
          </div>
          {shown.length === 0 && <div className="rm-empty">No matches for “{q}”.</div>}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="rm-hist-day">{g.label}</div>
              {g.items.map((e) => {
                const label = e.request.name || e.request.url || "Untitled";
                const open = () => postToHost({ type: "openRequest", request: e.request });
                return (
                  <button
                    key={e.id}
                    className="rm-hist-row"
                    title={e.request.url}
                    onClick={open}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        open();
                      }
                    }}
                  >
                    <MethodBadge method={e.request.method} />
                    <span className="rm-tree-label rm-hist-label">{label}</span>
                    {e.status > 0 && (
                      <span className={`rm-hist-status ${statusClass(e.status)}`}>
                        {e.status}
                      </span>
                    )}
                    <span className="rm-hist-time">{timeLabel(e.at)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </>
      )}
      {confirming && (
        <div
          className="rm-modal-scrim"
          onClick={() => setConfirming(false)}
          role="presentation"
        >
          <div className="rm-modal" role="alertdialog" aria-modal="true" aria-label="Clear history?">
            <div className="rm-modal-title">Clear history</div>
            <div className="rm-modal-body">
              Clear all {history.length} request history entr{history.length === 1 ? "y" : "ies"}?
              This cannot be undone.
            </div>
            <div className="rm-modal-actions">
              <button className="rm-btn" autoFocus onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                className="rm-btn rm-btn--danger"
                onClick={() => {
                  setConfirming(false);
                  postToHost({ type: "clearHistory" });
                }}
              >
                Clear history
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
