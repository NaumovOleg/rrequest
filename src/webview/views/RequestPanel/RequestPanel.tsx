import { useEffect, useState } from "react";
import { useStore } from "../../state/store";
import { buildUrlFromParams } from "../../state/url-sync";
import { postToHost } from "../../ipc";
import type { Auth, HttpMethod, KeyValue } from "../../../shared/types";
import { FormDataEditor } from "../../components";
import { parseCurl, toCurl } from "../../curl";
import { methodClass } from "../../method-color";

const METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];
type SubTab =
  | "params"
  | "authorization"
  | "headers"
  | "body"
  | "pre-request"
  | "tests";

function KeyValueTable({
  rows,
  onChange,
}: {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
}) {
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
          <tr key={i} className="rm-row">
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
}

function AuthEditor({
  auth,
  onChange,
}: {
  auth: Auth;
  onChange: (a: Auth) => void;
}) {
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
}

export function RequestPanel() {
  const [sub, setSub] = useState<SubTab>("params");
  const [saveCollectionId, setSaveCollectionId] = useState("");
  const [saveFolderId, setSaveFolderId] = useState("");
  const [curlText, setCurlText] = useState("");
  const active = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const update = useStore((s) => s.updateActive);
  const openNewTab = useStore((s) => s.openNewTab);
  const tree = useStore((s) => s.tree);
  const pendingSaveCollectionId = useStore((s) => s.pendingSaveCollectionId);
  const pendingSaveFolderId = useStore((s) => s.pendingSaveFolderId);
  useEffect(() => {
    setSaveCollectionId(pendingSaveCollectionId ?? "");
  }, [pendingSaveCollectionId]);
  useEffect(() => {
    setSaveFolderId(pendingSaveFolderId ?? "");
  }, [pendingSaveFolderId]);
  // Linked tabs (opened from a collection) autosave their edits back to the
  // tree, debounced, so any field change — name included — stays in sync.
  useEffect(() => {
    if (!active || !active.collectionId) return;
    const t = setTimeout(() => {
      const { collectionId, folderId, ...request } = active;
      postToHost({ type: "saveRequest", collectionId: collectionId!, folderId: folderId ?? null, request });
    }, 400);
    return () => clearTimeout(t);
  }, [active]);
  if (!active) return <div className="rm-panel">No request open</div>;

  const send = () => {
    const url = buildUrlFromParams(active.url, active.params);
    postToHost({
      type: "sendRequest",
      requestId: active.id,
      payload: { ...active, url },
    });
  };

  const save = () => {
    postToHost({
      type: "saveRequest",
      collectionId: saveCollectionId,
      folderId: saveFolderId || null,
      request: active,
    });
  };

  const saveFolders =
    tree.find((c) => c.id === saveCollectionId)?.folders ?? [];

  return (
    <div className="rm-panel">
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
        <input
          className="rm-input rm-url-input"
          placeholder="URL"
          style={{ flex: 1 }}
          value={active.url}
          onChange={(e) => update({ url: e.target.value })}
        />
        <button
          className="rm-btn rm-btn--primary"
          disabled={!active.url}
          onClick={send}
        >
          Send
        </button>
      </div>

      <div className="rm-row" style={{ padding: "var(--rm-sp-2, 8px)" }}>
        <input
          className="rm-input"
          aria-label="request name"
          placeholder="Request name"
          value={active.name}
          onChange={(e) => update({ name: e.target.value })}
        />
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
        <button className="rm-btn" disabled={!saveCollectionId} onClick={save}>
          Save
        </button>
      </div>

      <div className="rm-row" style={{ padding: "var(--rm-sp-2, 8px)" }}>
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

      <div className="rm-subtabs">
        {(
          [
            "params",
            "authorization",
            "headers",
            "body",
            "pre-request",
            "tests",
          ] as SubTab[]
        ).map((t) => (
          <button
            key={t}
            className={`rm-subtab ${sub === t ? "is-active" : ""}`}
            onClick={() => setSub(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {sub === "params" && (
        <KeyValueTable
          rows={active.params}
          onChange={(params) => update({ params })}
        />
      )}
      {sub === "authorization" && (
        <AuthEditor
          auth={active.auth ?? { type: "none" }}
          onChange={(auth) => update({ auth })}
        />
      )}
      {sub === "headers" && (
        <KeyValueTable
          rows={active.headers}
          onChange={(headers) => update({ headers })}
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
                if (mode === "none") update({ body: { mode: "none" } });
                else if (mode === "raw")
                  update({
                    body: {
                      mode: "raw",
                      type: "json",
                      text: active.body.mode === "raw" ? active.body.text : "",
                    },
                  });
                else if (mode === "formdata")
                  update({
                    body: {
                      mode: "formdata",
                      items:
                        active.body.mode === "formdata"
                          ? active.body.items
                          : [],
                    },
                  });
              }}
            >
              <option value="none">none</option>
              <option value="raw">raw</option>
              <option value="formdata">form-data</option>
            </select>
          </div>
          {active.body.mode === "raw" && (
            <textarea
              className="rm-input"
              aria-label="body"
              rows={8}
              style={{ width: "100%" }}
              value={active.body.text}
              onChange={(e) =>
                update({
                  body: { mode: "raw", type: "json", text: e.target.value },
                })
              }
            />
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
    </div>
  );
}
