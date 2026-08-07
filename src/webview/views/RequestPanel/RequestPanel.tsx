import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { buildUrlFromParams, parseParamsFromUrl } from "../../state/url-sync";
import { getUiState, postToHost, setUiState } from "../../ipc";
import type {
  Auth,
  HttpMethod,
  KeyValue,
  RequestBody,
} from "../../../shared/types";
import { FormDataEditor, EnvDropdown } from "../../components";
import { CodeTextarea, EnvVarInput, MenuRows } from "../../elements";
import { ResponsePanel } from "../ResponsePanel/ResponsePanel";
import { parseCurl, toCurl } from "../../curl";
import { methodClass } from "../../method-color";

const METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "QUERY",
  "DELETE",
  "HEAD",
  "OPTIONS",
];
type SubTab =
  | "params"
  | "authorization"
  | "headers"
  | "body"
  | "cookies"
  | "pre-request"
  | "tests";

const SUBTABS: { id: SubTab; label: string; icon: string }[] = [
  { id: "params", label: "Params", icon: "symbol-parameter" },
  { id: "authorization", label: "Authorization", icon: "shield" },
  { id: "headers", label: "Headers", icon: "list-unordered" },
  { id: "body", label: "Body", icon: "bracket" },
  { id: "cookies", label: "Cookies", icon: "archive" },
  { id: "pre-request", label: "Pre-request Script", icon: "run-all" },
  { id: "tests", label: "Tests", icon: "beaker" },
];

// Delicate dropdown fallback for the request section tabs when the chips
// don't fit one line: a single chip trigger showing the active tab, opening
// the same MenuRows list (with the same icons and a check gutter) instead of
// a plain native <select>.
function SubTabSelect({
  value,
  onChange,
}: {
  value: SubTab;
  onChange: (v: SubTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const current = SUBTABS.find((t) => t.id === value) ?? SUBTABS[0];
  return (
    <span className="rm-subtab-drop" ref={ref}>
      <button
        type="button"
        className="rm-chip rm-subtab-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className={`codicon codicon-${current.icon}`}
          aria-hidden="true"
        />
        {current.label}
        <span
          className={`codicon codicon-chevron-${open ? "up" : "down"}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="rm-popup-menu" role="menu" aria-label="request section">
          <MenuRows
            items={SUBTABS.map((t) => ({
              label: t.label,
              icon: t.icon,
              checked: t.id === value,
              onClick: () => onChange(t.id),
            }))}
            onPick={() => setOpen(false)}
          />
        </div>
      )}
    </span>
  );
}

// Split pasted text ("a=1&b=2", one pair per line, or a mix) into rows. Only
// tokens that contain '=' count, so pasting a random sentence does nothing.
function parseKvText(text: string): KeyValue[] {
  const out: KeyValue[] = [];
  for (const part of text.split(/[&\n]/)) {
    const t = part.trim();
    if (!t.includes("=")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    out.push({
      key: t.slice(0, i).trim(),
      value: t.slice(i + 1).trim(),
      enabled: true,
    });
  }
  return out;
}

// First JSON error as (1-based) line + message, or null when valid. Parsing a
// huge body on every keystroke is wasteful, so skip anything over 200 KB.
function jsonErrorAt(text: string): { line: number; message: string } | null {
  if (text.length > 200_000) return null;
  try {
    JSON.parse(text);
    return null;
  } catch (e: any) {
    const pos = e?.position ?? 0;
    const line = text.slice(0, pos).split("\n").length;
    return { line, message: String(e?.message ?? "Invalid JSON") };
  }
}

// Upsert (or remove) the Content-Type header without touching other headers.
function upsertContentType(headers: KeyValue[], ct: string | null): KeyValue[] {
  const rest = headers.filter((h) => h.key.toLowerCase() !== "content-type");
  return ct
    ? [...rest, { key: "Content-Type", value: ct, enabled: true }]
    : rest;
}
// Headers the transport fills in automatically (shown greyed, like Postman).
// User-Agent is omitted here because it's an editable default header already.
function autoHeaders(
  url: string,
  body: RequestBody,
): { key: string; value: string }[] {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    /* incomplete url */
  }
  const list = [
    { key: "Host", value: host || "<calculated when sent>" },
    { key: "Accept-Encoding", value: "gzip, deflate, br" },
    { key: "Connection", value: "keep-alive" },
  ];
  if (body.mode !== "none")
    list.push({ key: "Content-Length", value: "<calculated when sent>" });
  return list;
}

function contentTypeFor(body: RequestBody): string | null {
  if (body.mode === "raw")
    return body.type === "json"
      ? "application/json"
      : body.type === "xml"
      ? "application/xml"
      : "text/plain";
  if (body.mode === "urlencoded") return "application/x-www-form-urlencoded";
  if (body.mode === "graphql") return "application/json";
  return null; // none, formdata (client sets the multipart boundary)
}

const KeyValueTable = ({
  rows,
  onChange,
  knownVars,
  envValues,
}: {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  // When supplied, the value cells become {{var}}-highlighting inputs and
  // pasting multi-line / & -separated text splices rows into the table.
  knownVars?: Set<string>;
  envValues?: Map<string, string>;
}) => {
  const update = (i: number, patch: Partial<KeyValue>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const withBlank = [
    ...rows,
    { key: "", value: "", enabled: true, description: "" },
  ];
  const onTablePaste = (e: React.ClipboardEvent) => {
    if (!knownVars) return;
    const parsed = parseKvText(e.clipboardData.getData("text/plain"));
    if (parsed.length === 0) return;
    e.preventDefault();
    onChange([...rows, ...parsed]);
  };
  return (
    <table className="rm-kvtable" onPaste={onTablePaste}>
      <thead>
        <tr>
          <th></th>
          <th>Key</th>
          <th>Value</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {withBlank.map((r, i) => (
          <tr key={i}>
            <td>
              <input
                type="checkbox"
                checked={r.enabled !== false}
                onChange={(e) =>
                  i < rows.length && update(i, { enabled: e.target.checked })
                }
              />
            </td>
            <td>
              <input
                className="rm-input rm-kv-input"
                placeholder="key"
                value={r.key}
                onChange={(e) => {
                  if (i < rows.length) update(i, { key: e.target.value });
                  else
                    onChange([
                      ...rows,
                      { key: e.target.value, value: "", enabled: true },
                    ]);
                }}
              />
            </td>
            <td>
              {knownVars ? (
                <EnvVarInput
                  className="rm-kv-input rm-kv-envinput"
                  placeholder="value"
                  value={r.value}
                  onChange={(v) => i < rows.length && update(i, { value: v })}
                  knownVars={knownVars}
                  values={envValues}
                />
              ) : (
                <input
                  className="rm-input rm-kv-input"
                  placeholder="value"
                  value={r.value}
                  onChange={(e) =>
                    i < rows.length && update(i, { value: e.target.value })
                  }
                />
              )}
            </td>
            <td>
              <input
                className="rm-input rm-kv-input"
                placeholder="description"
                value={r.description ?? ""}
                onChange={(e) =>
                  i < rows.length && update(i, { description: e.target.value })
                }
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const AuthEditor = ({
  auth,
  onChange,
}: {
  auth: Auth;
  onChange: (a: Auth) => void;
}) => {
  const setType = (type: Auth["type"]) => {
    if (type === "none") onChange({ type: "none" });
    else if (type === "bearer")
      onChange({
        type: "bearer",
        token: auth.type === "bearer" ? auth.token : "",
      });
    else if (type === "basic")
      onChange({
        type: "basic",
        username: auth.type === "basic" ? auth.username : "",
        password: auth.type === "basic" ? auth.password : "",
      });
    else
      onChange({
        type: "apikey",
        key: auth.type === "apikey" ? auth.key : "",
        value: auth.type === "apikey" ? auth.value : "",
        in: auth.type === "apikey" ? auth.in : "header",
      });
  };
  return (
    <div className="rm-section rm-authform">
      <div className="rm-row">
        <label>Type</label>
        <select
          className="rm-select"
          aria-label="auth type"
          value={auth.type}
          onChange={(e) => setType(e.target.value as Auth["type"])}
        >
          <option value="none">No Auth</option>
          <option value="bearer">Bearer Token</option>
          <option value="basic">Basic Auth</option>
          <option value="apikey">API Key</option>
        </select>
      </div>
      {auth.type === "bearer" && (
        <div className="rm-row">
          <label>Token</label>
          <input
            className="rm-input"
            aria-label="bearer token"
            value={auth.token}
            onChange={(e) =>
              onChange({ type: "bearer", token: e.target.value })
            }
          />
        </div>
      )}
      {auth.type === "basic" && (
        <>
          <div className="rm-row">
            <label>Username</label>
            <input
              className="rm-input"
              aria-label="basic username"
              value={auth.username}
              onChange={(e) => onChange({ ...auth, username: e.target.value })}
            />
          </div>
          <div className="rm-row">
            <label>Password</label>
            <input
              className="rm-input"
              aria-label="basic password"
              type="password"
              value={auth.password}
              onChange={(e) => onChange({ ...auth, password: e.target.value })}
            />
          </div>
        </>
      )}
      {auth.type === "apikey" && (
        <>
          <div className="rm-row">
            <label>Key</label>
            <input
              className="rm-input"
              aria-label="apikey key"
              value={auth.key}
              onChange={(e) => onChange({ ...auth, key: e.target.value })}
            />
          </div>
          <div className="rm-row">
            <label>Value</label>
            <input
              className="rm-input"
              aria-label="apikey value"
              value={auth.value}
              onChange={(e) => onChange({ ...auth, value: e.target.value })}
            />
          </div>
          <div className="rm-row">
            <label>Add to</label>
            <select
              className="rm-select"
              aria-label="apikey location"
              value={auth.in}
              onChange={(e) =>
                onChange({ ...auth, in: e.target.value as "header" | "query" })
              }
            >
              <option value="header">Header</option>
              <option value="query">Query Params</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
};

export function RequestPanel() {
  const [sub, setSub] = useState<SubTab>("params");
  const [saveCollectionId, setSaveCollectionId] = useState("");
  const [saveFolderId, setSaveFolderId] = useState("");
  const [curlText, setCurlText] = useState("");
  const [splitPct, setSplitPct] = useState(50);
  const [showAuto, setShowAuto] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const bodyCache = useRef<{
    id: string | null;
    byMode: Partial<Record<RequestBody["mode"], RequestBody>>;
  }>({ id: null, byMode: {} });
  const active = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const isViewer = useStore((s) => s.isViewer());
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const update = useStore((s) => s.updateActive);
  const reconcileActiveUrl = useStore((s) => s.reconcileActiveUrl);
  const markTabSaved = useStore((s) => s.markTabSaved);
  const openNewTab = useStore((s) => s.openNewTab);
  const tree = useStore((s) => s.tree);
  const pendingSaveCollectionId = useStore((s) => s.pendingSaveCollectionId);
  const pendingSaveFolderId = useStore((s) => s.pendingSaveFolderId);
  const knownVars = useStore((s) => {
    const e = s.environments.find((x) => x.id === s.activeEnvId);
    return new Set(
      (e?.variables ?? []).filter((v) => v.enabled && v.key).map((v) => v.key),
    );
  });
  // name -> value for the active environment, for the {{var}} hover hints.
  const envValues = useStore((s) => {
    const e = s.environments.find((x) => x.id === s.activeEnvId);
    const m = new Map<string, string>();
    for (const v of e?.variables ?? [])
      if (v.enabled && v.key) m.set(v.key, v.value);
    return m;
  });
  // Where the last Save went (per workspace), so an unsaved request can be
  // saved with one click instead of re-picking collection + folder.
  const lastSaveTarget = useRef<{
    workspaceId?: string;
    collectionId?: string;
    folderId?: string;
  } | null>(null);
  const persistSaveTarget = (collectionId: string, folderId: string) =>
    setUiState("lastSaveTarget", {
      workspaceId: activeWorkspaceId,
      collectionId,
      folderId,
    });
  useEffect(() => {
    lastSaveTarget.current = getUiState(
      "lastSaveTarget",
      null as {
        workspaceId?: string;
        collectionId?: string;
        folderId?: string;
      } | null,
    );
  }, []);
  // On load, make the URL bar reflect the request's params (a saved request may
  // carry params but a query-less url). Keyed on the request id so it runs once
  // per opened request and never marks the tab dirty.
  useEffect(() => {
    reconcileActiveUrl();
  }, [active?.id, reconcileActiveUrl]);
  useEffect(() => {
    setSaveCollectionId(pendingSaveCollectionId ?? "");
  }, [pendingSaveCollectionId]);
  useEffect(() => {
    setSaveFolderId(pendingSaveFolderId ?? "");
  }, [pendingSaveFolderId]);
  // Prefill the save target from the last save in this workspace (once per tab
  // id — never fight an explicit selection or a pending target from the host).
  const prefilledTab = useRef<string | null>(null);
  useEffect(() => {
    if (active?.collectionId || pendingSaveCollectionId) return;
    if (prefilledTab.current === active?.id) return;
    prefilledTab.current = active?.id ?? null;
    const saved = lastSaveTarget.current;
    if (
      !saved?.collectionId ||
      saved.workspaceId !== activeWorkspaceId ||
      !tree.some((c) => c.id === saved.collectionId)
    )
      return;
    setSaveCollectionId(saved.collectionId);
    setSaveFolderId(saved.folderId ?? "");
  }, [
    active?.id,
    active?.collectionId,
    activeWorkspaceId,
    tree,
    pendingSaveCollectionId,
  ]);
  // Cmd/Ctrl+S saves the active request, like saving a file in VS Code. The
  // editor is a webview (VS Code's own save is a no-op for a webview panel), so
  // we catch the shortcut in-page and route it to the same save() the button
  // uses. The ref binds the listener once while always calling the latest
  // closure (which captures the current tab + chosen save target).
  const saveRef = useRef<() => void>(() => {});
  const sendRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "s"
      ) {
        e.preventDefault();
        saveRef.current();
      }
      // Cmd/Ctrl+Enter sends the request, mirroring Postman/Insomnia.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === "Enter") {
        e.preventDefault();
        sendRef.current();
      }
      // Cmd/Ctrl+E jumps to the environment picker (Postman-style shortcut).
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "e"
      ) {
        e.preventDefault();
        (
          document.querySelector(
            '[aria-label="active environment"]',
          ) as HTMLSelectElement | null
        )?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Fit the section tabs into one row when there's room; else collapse them
  // into a dropdown. A hidden same-size chip row is measured against the bar.
  // (Declared before the early return below — it's a hook. The bar only exists
  // once a request tab is open, so the effect re-runs when `active` appears;
  // with [] deps it would run once at mount, measure nothing, and stay on the
  // chips branch forever.)
  const navWrapRef = useRef<HTMLDivElement | null>(null);
  const chipsMeasureRef = useRef<HTMLDivElement | null>(null);
  const [navFits, setNavFits] = useState(true);
  const hasActiveTab = !!active;
  useEffect(() => {
    const el = navWrapRef.current;
    if (!el) return;
    const measure = () => {
      const need = chipsMeasureRef.current?.scrollWidth ?? 0;
      // clientWidth includes the bar's horizontal padding, but the chips row
      // only gets the content box — compare against that, or the last chip
      // wraps onto a second line instead of switching to the dropdown.
      const cs = getComputedStyle(el);
      const avail =
        el.clientWidth -
        parseFloat(cs.paddingLeft) -
        parseFloat(cs.paddingRight);
      setNavFits(need + 20 <= avail + 1);
    };
    measure();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    // Fonts may not be ready at mount; chip widths change once they land.
    void document.fonts?.ready.then(measure);
    return () => ro?.disconnect();
  }, [hasActiveTab]);
  // No autosave: editor edits stay local (the tab shows a dirty dot) and only
  // reach the sidebar/tree when the user hits Save — see `save()` below.
  if (!active)
    return (
      <div className="rm-panel">
        <div className="rm-blank">
          <span
            className="codicon codicon-request rm-blank-icon"
            aria-hidden="true"
          />
          <div className="rm-blank-title">No request open</div>
          <div className="rm-blank-hint">
            Open a request from the sidebar or create a new one to start.
          </div>
        </div>
      </div>
    );

  const send = () => {
    // url already carries the query (kept in sync with params); send the base
    // so the client appends the params exactly once.
    const base = active.url.split("?")[0];
    postToHost({
      type: "sendRequest",
      requestId: active.id,
      payload: { ...active, url: base },
    });
  };

  // --- keep params list and the URL query string in sync (both directions) ---
  const onUrlChange = (url: string) => {
    const { params } = parseParamsFromUrl(url);
    update({ url, params });
  };
  const onParamsChange = (params: KeyValue[]) => {
    const base = active.url.split("?")[0];
    update({ params, url: buildUrlFromParams(base, params) });
  };
  // Changing the body keeps the Content-Type header in step with it.
  const setBody = (body: RequestBody) =>
    update({
      body,
      headers: upsertContentType(active.headers, contentTypeFor(body)),
    });

  // The body model only holds the active mode, so switching mode would drop the
  // other modes' content. `bodyCache` (declared with the other refs, above the
  // early return) stashes each mode's body keyed by the active tab so e.g.
  // raw → none → raw restores what was there instead of wiping it.
  const switchBodyMode = (mode: RequestBody["mode"]) => {
    if (!active || mode === active.body.mode) return;
    const cache = bodyCache.current;
    if (cache.id !== active.id) {
      cache.id = active.id;
      cache.byMode = {};
    }
    cache.byMode[active.body.mode] = active.body; // remember the mode we're leaving
    // GraphQL is POSTed as JSON; default the method to POST.
    if (mode === "graphql" && active.method === "GET")
      update({ method: "POST" });
    const restored = cache.byMode[mode];
    if (restored) {
      setBody(restored);
      return;
    }
    switch (mode) {
      case "none":
        setBody({ mode: "none" });
        break;
      case "raw":
        setBody({ mode: "raw", type: "json", text: "" });
        break;
      case "urlencoded":
        setBody({ mode: "urlencoded", items: [] });
        break;
      case "formdata":
        setBody({ mode: "formdata", items: [] });
        break;
      case "graphql":
        setBody({ mode: "graphql", query: "", variables: "" });
        break;
    }
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX;
    const startPct = splitPct;
    const move = (ev: MouseEvent) => {
      const pct = startPct + ((ev.clientX - startX) / rect.width) * 100;
      setSplitPct(Math.min(80, Math.max(20, pct)));
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  const beautify = () => {
    if (active.body.mode !== "raw") return;
    try {
      update({
        body: {
          ...active.body,
          text: JSON.stringify(JSON.parse(active.body.text), null, 2),
        },
      });
    } catch {
      /* leave invalid JSON untouched */
    }
  };

  // Edit the raw body in a real VS Code tab (untitled doc, right language).
  const openBodyInEditor = () => {
    if (active.body.mode !== "raw") return;
    const language =
      active.body.type === "json"
        ? "json"
        : active.body.type === "xml"
        ? "xml"
        : "plaintext";
    postToHost({
      type: "openTextDocument",
      content: active.body.text,
      language,
    });
  };
  const jsonError =
    active.body.mode === "raw" && active.body.type === "json"
      ? jsonErrorAt(active.body.text)
      : null;
  const jsonValid =
    active.body.mode === "raw" &&
    active.body.type === "json" &&
    active.body.text.trim() !== "" &&
    !jsonError;

  const save = () => {
    if (isViewer) return;
    const {
      collectionId: linkC,
      folderId: linkF,
      dirty: _dirty,
      ...request
    } = active;
    const collectionId = linkC || saveCollectionId;
    if (!collectionId) return;
    postToHost({
      type: "saveRequest",
      collectionId,
      folderId: linkC ? linkF ?? null : saveFolderId || null,
      request,
    });
    // Remember where this save went so the next unsaved request starts there.
    if (!linkC) persistSaveTarget(collectionId, saveFolderId || "");
    // Committed to the tree -> tab is clean again (clears the dirty dot and
    // lets subsequent tree broadcasts refresh this tab).
    markTabSaved(active.id);
  };
  // Keep the Cmd/Ctrl+S handler pointed at the latest save closure.
  saveRef.current = save;
  sendRef.current = send;

  const linkedCollection = active.collectionId
    ? tree.find((c) => c.id === active.collectionId)
    : undefined;
  const linkedFolder =
    linkedCollection && active.folderId
      ? (linkedCollection.folders ?? []).find((f) => f.id === active.folderId)
      : undefined;

  return (
    <div className="rm-reqpane">
      <header className="rm-req-meta">
        <input
          className="rm-input rm-req-name"
          aria-label="request name"
          placeholder="Request name"
          value={active.name}
          onChange={(e) => update({ name: e.target.value })}
        />
        {active.dirty && (
          <span
            className="rm-tab-dirty"
            title="unsaved changes"
            aria-label="unsaved changes"
          />
        )}
        <div className="rm-req-meta-actions">
          {active.collectionId ? (
            <span className="rm-req-target" title="saved location">
              {linkedCollection?.name ?? "Collection"}
              {linkedFolder ? ` / ${linkedFolder.name}` : ""}
            </span>
          ) : (
            <select
              className="rm-select"
              aria-label="save to collection"
              value={
                saveCollectionId
                  ? saveFolderId
                    ? `${saveCollectionId}::${saveFolderId}`
                    : saveCollectionId
                  : ""
              }
              onChange={(e) => {
                const v = e.target.value;
                const sep = v.indexOf("::");
                const c = sep < 0 ? v : v.slice(0, sep);
                const f = sep < 0 ? "" : v.slice(sep + 2);
                setSaveCollectionId(c);
                setSaveFolderId(f);
                if (c) persistSaveTarget(c, f);
              }}
            >
              <option value="" disabled>
                Select collection
              </option>
              {tree.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  <option value={c.id}>{c.name} (root)</option>
                  {(c.folders ?? []).map((f) => (
                    <option key={f.id} value={`${c.id}::${f.id}`}>
                      {c.name} / {f.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          <button
            className={`rm-btn${active.dirty ? " is-active" : ""}`}
            title={active.dirty ? "Save (unsaved changes)" : "Save"}
            disabled={isViewer || (!active.collectionId && !saveCollectionId)}
            onClick={save}
          >
            Save
          </button>
          <EnvDropdown />
        </div>
      </header>

      <div className="rm-urlbar">
        <label>
          <span style={{ display: "none" }}>method</span>
          {/* Native select — datalist popups are blocked inside VS Code
              webviews, so a real <select> is the only way to pick a method.
              Kept colored by the active method like the old text input. */}
          <select
            className={`rm-input rm-method-select ${methodClass(
              active.method,
            )}`}
            aria-label="method"
            value={active.method}
            onChange={(e) => update({ method: e.target.value as HttpMethod })}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <EnvVarInput
          className="rm-url-input"
          placeholder="URL"
          value={active.url}
          onChange={onUrlChange}
          knownVars={knownVars}
          values={envValues}
        />
        <button
          className="rm-btn rm-btn--primary"
          title="Send (⌘/Ctrl+Enter)"
          disabled={!active.url}
          onClick={send}
        >
          Send
        </button>
      </div>

      <div className="rm-req-split" ref={splitRef}>
        <section className="rm-req-config" style={{ flex: `0 0 ${splitPct}%` }}>
          <div className="rm-subtab-bar" ref={navWrapRef}>
            {/* hidden same-size chip row used only to measure fit */}
            <div
              className="rm-chip-measure"
              ref={chipsMeasureRef}
              aria-hidden="true"
            >
              {SUBTABS.map((t) => (
                <span key={t.id} className="rm-chip">
                  <span
                    className={`codicon codicon-${t.icon}`}
                    aria-hidden="true"
                  />
                  {t.label}
                </span>
              ))}
            </div>
            {navFits ? (
              <div
                className="rm-chips rm-subtab-chips"
                role="tablist"
                aria-label="request section"
              >
                {SUBTABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={sub === t.id}
                    className={`rm-chip${sub === t.id ? " is-active" : ""}`}
                    onClick={() => setSub(t.id)}
                  >
                    <span
                      className={`codicon codicon-${t.icon}`}
                      aria-hidden="true"
                    />
                    {t.label}
                  </button>
                ))}
              </div>
            ) : (
              <SubTabSelect value={sub} onChange={setSub} />
            )}
          </div>

          <div className="rm-req-config-body">
            {sub === "params" && (
              <KeyValueTable
                rows={active.params}
                onChange={onParamsChange}
                knownVars={knownVars}
                envValues={envValues}
              />
            )}
            {sub === "authorization" && (
              <AuthEditor
                auth={active.auth ?? { type: "none" }}
                onChange={(auth) => update({ auth })}
              />
            )}
            {sub === "headers" && (
              <>
                <KeyValueTable
                  rows={active.headers}
                  onChange={(headers) => update({ headers })}
                  knownVars={knownVars}
                  envValues={envValues}
                />
                {(() => {
                  const auto = autoHeaders(active.url, active.body);
                  return (
                    <div className="rm-auto-headers">
                      <button
                        type="button"
                        className="rm-auto-toggle"
                        aria-expanded={showAuto}
                        onClick={() => setShowAuto((v) => !v)}
                      >
                        <span
                          className={`codicon codicon-chevron-${
                            showAuto ? "down" : "right"
                          }`}
                        />{" "}
                        {showAuto ? "Hide" : "Show"} auto-generated headers (
                        {auto.length})
                      </button>
                      {showAuto && (
                        <table className="rm-kvtable rm-auto-table">
                          <tbody>
                            {auto.map((h) => (
                              <tr key={h.key}>
                                <td>
                                  <span className="codicon codicon-lock" />
                                </td>
                                <td>{h.key}</td>
                                <td>{h.value}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
            {sub === "cookies" && (
              <KeyValueTable
                rows={active.cookies ?? []}
                onChange={(cookies) => update({ cookies })}
                knownVars={knownVars}
                envValues={envValues}
              />
            )}
            {sub === "body" && (
              <div className="rm-body-pane">
                <div className="rm-row">
                  <select
                    className="rm-select"
                    aria-label="body mode"
                    value={active.body.mode}
                    onChange={(e) =>
                      switchBodyMode(e.target.value as RequestBody["mode"])
                    }
                  >
                    <option value="none">none</option>
                    <option value="raw">raw</option>
                    <option value="urlencoded">x-www-form-urlencoded</option>
                    <option value="formdata">form-data</option>
                    <option value="graphql">GraphQL</option>
                  </select>
                  {active.body.mode === "raw" && (
                    <>
                      <select
                        className="rm-select"
                        aria-label="raw type"
                        value={active.body.type}
                        onChange={(e) =>
                          active.body.mode === "raw" &&
                          setBody({
                            ...active.body,
                            type: e.target.value as "json" | "text" | "xml",
                          })
                        }
                      >
                        <option value="json">JSON</option>
                        <option value="text">Text</option>
                        <option value="xml">XML</option>
                      </select>
                      <div className="rm-spacer" />
                      <button className="rm-btn" onClick={openBodyInEditor}>
                        Open in editor
                      </button>
                      {active.body.type === "json" && (
                        <button className="rm-btn" onClick={beautify}>
                          Beautify
                        </button>
                      )}
                    </>
                  )}
                </div>
                {active.body.mode === "raw" && (
                  <>
                    <CodeTextarea
                      className="rm-code-input"
                      aria-label="body"
                      highlight={active.body.type === "json" ? "json" : "none"}
                      value={active.body.text}
                      onChange={(e) =>
                        active.body.mode === "raw" &&
                        setBody({ ...active.body, text: e.target.value })
                      }
                    />
                    {jsonError && (
                      <div
                        className="rm-body-error"
                        role="alert"
                        title={jsonError.message}
                      >
                        JSON error at line {jsonError.line}
                      </div>
                    )}
                    {jsonValid && <div className="rm-body-ok">Valid JSON</div>}
                  </>
                )}
                {active.body.mode === "urlencoded" && (
                  <KeyValueTable
                    rows={active.body.items}
                    onChange={(items) =>
                      active.body.mode === "urlencoded" &&
                      setBody({ mode: "urlencoded", items })
                    }
                    knownVars={knownVars}
                    envValues={envValues}
                  />
                )}
                {active.body.mode === "graphql" && (
                  <div className="rm-graphql">
                    <label className="rm-graphql-label">Query</label>
                    <textarea
                      className="rm-input rm-code-input"
                      aria-label="graphql query"
                      rows={8}
                      style={{ width: "100%" }}
                      value={active.body.query}
                      onChange={(e) =>
                        active.body.mode === "graphql" &&
                        setBody({ ...active.body, query: e.target.value })
                      }
                    />
                    <label className="rm-graphql-label">Variables (JSON)</label>
                    <textarea
                      className="rm-input rm-code-input"
                      aria-label="graphql variables"
                      rows={4}
                      style={{ width: "100%" }}
                      value={active.body.variables}
                      onChange={(e) =>
                        active.body.mode === "graphql" &&
                        setBody({ ...active.body, variables: e.target.value })
                      }
                    />
                  </div>
                )}
                {active.body.mode === "formdata" && <FormDataEditor />}
              </div>
            )}
            {sub === "pre-request" && (
              <textarea
                className="rm-input rm-code-input"
                aria-label="pre-request script"
                rows={8}
                style={{ width: "100%" }}
                value={active.preRequestScript ?? ""}
                onChange={(e) => update({ preRequestScript: e.target.value })}
              />
            )}
            {sub === "tests" && (
              <textarea
                className="rm-input rm-code-input"
                aria-label="test script"
                rows={8}
                style={{ width: "100%" }}
                value={active.testScript ?? ""}
                onChange={(e) => update({ testScript: e.target.value })}
              />
            )}
          </div>

          {/* Pinned to the bottom of the config pane: sibling of the scrolling
              config-body, so it stays visible even when the tab above is empty. */}
          <div className="rm-curlrow">
            <button
              className="rm-btn"
              onClick={() => {
                void navigator.clipboard.writeText(toCurl(active));
              }}
            >
              Copy as cURL
            </button>
            <input
              className="rm-input"
              aria-label="curl command"
              placeholder="Paste curl command"
              value={curlText}
              onChange={(e) => setCurlText(e.target.value)}
            />
            <button
              className="rm-btn"
              onClick={() => {
                const p = parseCurl(curlText);
                openNewTab();
                update(p);
                setCurlText("");
              }}
            >
              Import from cURL
            </button>
          </div>
        </section>

        <div
          className="rm-split-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="resize request and response"
          onMouseDown={startResize}
        />
        <section
          className="rm-req-response"
          style={{ flex: `1 1 ${100 - splitPct}%` }}
        >
          <ResponsePanel />
        </section>
      </div>
    </div>
  );
}
