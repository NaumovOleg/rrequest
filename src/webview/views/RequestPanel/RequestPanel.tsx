import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { buildUrlFromParams, parseParamsFromUrl } from "../../state/url-sync";
import { postToHost } from "../../ipc";
import type {
  Auth,
  HttpMethod,
  KeyValue,
  RequestBody,
} from "../../../shared/types";
import { FormDataEditor, EnvDropdown } from "../../components";
import { EnvVarInput } from "../../elements";
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

const SUBTABS: { id: SubTab; label: string }[] = [
  { id: "params", label: "Params" },
  { id: "authorization", label: "Authorization" },
  { id: "headers", label: "Headers" },
  { id: "body", label: "Body" },
  { id: "cookies", label: "Cookies" },
  { id: "pre-request", label: "Pre-request Script" },
  { id: "tests", label: "Tests" },
];

// Upsert (or remove) the Content-Type header without touching other headers.
function upsertContentType(headers: KeyValue[], ct: string | null): KeyValue[] {
  const rest = headers.filter((h) => h.key.toLowerCase() !== "content-type");
  return ct ? [...rest, { key: "Content-Type", value: ct, enabled: true }] : rest;
}
// Headers the transport fills in automatically (shown greyed, like Postman).
// User-Agent is omitted here because it's an editable default header already.
function autoHeaders(url: string, body: RequestBody): { key: string; value: string }[] {
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
}: {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
}) => {
  const update = (i: number, patch: Partial<KeyValue>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const withBlank = [
    ...rows,
    { key: "", value: "", enabled: true, description: "" },
  ];
  return (
    <table className="rm-kvtable">
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
                checked={r.enabled}
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
              <input
                className="rm-input rm-kv-input"
                placeholder="value"
                value={r.value}
                onChange={(e) =>
                  i < rows.length && update(i, { value: e.target.value })
                }
              />
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
  const active = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const isViewer = useStore((s) => s.isViewer());
  const update = useStore((s) => s.updateActive);
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
  useEffect(() => {
    setSaveCollectionId(pendingSaveCollectionId ?? "");
  }, [pendingSaveCollectionId]);
  useEffect(() => {
    setSaveFolderId(pendingSaveFolderId ?? "");
  }, [pendingSaveFolderId]);
  // Linked tabs (opened from a collection) autosave their edits back to the
  // tree, debounced, so any field change — name included — stays in sync. A
  // viewer can't mutate the shared tree (the router would reject it anyway),
  // so skip firing the request entirely rather than let it round-trip into a
  // rejection toast.
  useEffect(() => {
    if (!active || !active.collectionId || isViewer) return;
    const t = setTimeout(() => {
      const { collectionId, folderId, ...request } = active;
      postToHost({
        type: "saveRequest",
        collectionId: collectionId!,
        folderId: folderId ?? null,
        request,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [active, isViewer]);
  if (!active) return <div className="rm-panel">No request open</div>;

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
    update({ body, headers: upsertContentType(active.headers, contentTypeFor(body)) });

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

  const save = () => {
    if (isViewer) return;
    const { collectionId: linkC, folderId: linkF, ...request } = active;
    const collectionId = linkC || saveCollectionId;
    if (!collectionId) return;
    postToHost({
      type: "saveRequest",
      collectionId,
      folderId: linkC ? (linkF ?? null) : saveFolderId || null,
      request,
    });
  };

  const saveFolders =
    tree.find((c) => c.id === saveCollectionId)?.folders ?? [];
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
        <div className="rm-req-meta-actions">
          {active.collectionId ? (
            <span className="rm-req-target" title="saved location">
              {linkedCollection?.name ?? "Collection"}
              {linkedFolder ? ` / ${linkedFolder.name}` : ""}
            </span>
          ) : (
            <>
              <select
                className="rm-select"
                aria-label="save to collection"
                value={saveCollectionId}
                onChange={(e) => setSaveCollectionId(e.target.value)}
              >
                <option value="" disabled>
                  Select collection
                </option>
                {tree.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                className="rm-select"
                aria-label="save to folder"
                value={saveFolderId}
                onChange={(e) => setSaveFolderId(e.target.value)}
              >
                <option value="">(root)</option>
                {saveFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <button
            className="rm-btn"
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
          <select
            className={`rm-select rm-method-select ${methodClass(active.method)}`}
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
        />
        <button
          className="rm-btn rm-btn--primary"
          disabled={!active.url}
          onClick={send}
        >
          Send
        </button>
      </div>

      <div className="rm-req-split" ref={splitRef}>
        <section
          className="rm-req-config"
          style={{ flex: `0 0 ${splitPct}%` }}
        >
          <div className="rm-subtab-bar">
            <select
              className="rm-select rm-subtab-select"
              aria-label="request section"
              value={sub}
              onChange={(e) => setSub(e.target.value as SubTab)}
            >
              {SUBTABS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rm-req-config-body">
            {sub === "params" && (
              <KeyValueTable rows={active.params} onChange={onParamsChange} />
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
                          className={`codicon codicon-chevron-${showAuto ? "down" : "right"}`}
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
              />
            )}
            {sub === "body" && (
              <div>
                <div className="rm-row">
                  <select
                    className="rm-select"
                    aria-label="body mode"
                    value={active.body.mode}
                    onChange={(e) => {
                      const mode = e.target.value;
                      if (mode === "none") setBody({ mode: "none" });
                      else if (mode === "raw")
                        setBody({
                          mode: "raw",
                          type: "json",
                          text:
                            active.body.mode === "raw" ? active.body.text : "",
                        });
                      else if (mode === "urlencoded")
                        setBody({
                          mode: "urlencoded",
                          items:
                            active.body.mode === "urlencoded"
                              ? active.body.items
                              : [],
                        });
                      else if (mode === "formdata")
                        setBody({
                          mode: "formdata",
                          items:
                            active.body.mode === "formdata"
                              ? active.body.items
                              : [],
                        });
                      else if (mode === "graphql") {
                        // GraphQL is POSTed as JSON; default the method to POST.
                        if (active.method === "GET") update({ method: "POST" });
                        setBody({
                          mode: "graphql",
                          query:
                            active.body.mode === "graphql"
                              ? active.body.query
                              : "",
                          variables:
                            active.body.mode === "graphql"
                              ? active.body.variables
                              : "",
                        });
                      }
                    }}
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
                      {active.body.type === "json" && (
                        <button className="rm-btn" onClick={beautify}>
                          Beautify
                        </button>
                      )}
                    </>
                  )}
                </div>
                {active.body.mode === "raw" && (
                  <textarea
                    className="rm-input rm-code-input"
                    aria-label="body"
                    rows={10}
                    style={{ width: "100%" }}
                    value={active.body.text}
                    onChange={(e) =>
                      active.body.mode === "raw" &&
                      setBody({ ...active.body, text: e.target.value })
                    }
                  />
                )}
                {active.body.mode === "urlencoded" && (
                  <KeyValueTable
                    rows={active.body.items}
                    onChange={(items) =>
                      active.body.mode === "urlencoded" &&
                      setBody({ mode: "urlencoded", items })
                    }
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
                    <label className="rm-graphql-label">
                      Variables (JSON)
                    </label>
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
                className="rm-input"
                aria-label="pre-request script"
                rows={8}
                style={{ width: "100%" }}
                value={active.preRequestScript ?? ""}
                onChange={(e) => update({ preRequestScript: e.target.value })}
              />
            )}
            {sub === "tests" && (
              <textarea
                className="rm-input"
                aria-label="test script"
                rows={8}
                style={{ width: "100%" }}
                value={active.testScript ?? ""}
                onChange={(e) => update({ testScript: e.target.value })}
              />
            )}

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
