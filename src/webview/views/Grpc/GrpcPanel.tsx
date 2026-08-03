import { useState, useEffect, useRef } from "react";
import { newId, type GrpcRequest, type KeyValue } from "../../../shared/types";
import { useStore } from "../../state/store";
import { postToHost, onHostMessage } from "../../ipc";

const SAMPLE_PROTO = `syntax = "proto3";
package helloworld;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply) {}
}
message HelloRequest { string name = 1; }
message HelloReply { string message = 1; }`;

function parseMetadata(text: string): KeyValue[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(":");
      return {
        key: i < 0 ? l : l.slice(0, i).trim(),
        value: i < 0 ? "" : l.slice(i + 1).trim(),
        enabled: true,
      };
    });
}

function metaToText(md: KeyValue[]): string {
  return md.map((m) => `${m.key}: ${m.value}`).join("\n");
}

type Result = { ok: boolean; message?: string; error?: string; timeMs: number };

export function GrpcPanel() {
  const tree = useStore((s) => s.tree);
  const [id, setId] = useState(() => newId());
  const [name, setName] = useState("New gRPC Request");
  const [address, setAddress] = useState("localhost:50051");
  const [plaintext, setPlaintext] = useState(true);
  const [proto, setProto] = useState(SAMPLE_PROTO);
  const [service, setService] = useState("helloworld.Greeter");
  const [method, setMethod] = useState("SayHello");
  const [message, setMessage] = useState('{\n  "name": "rrequest"\n}');
  const [metadata, setMetadata] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [linkedCollectionId, setLinkedCollectionId] = useState<string | null>(null);
  const [linkedFolderId, setLinkedFolderId] = useState<string | null>(null);
  const [saveCollectionId, setSaveCollectionId] = useState("");
  const [saveFolderId, setSaveFolderId] = useState("");
  const reqId = useRef<string | null>(null);

  useEffect(() => {
    return onHostMessage((m) => {
      if (m.type === "grpcResponse" && m.requestId === reqId.current) {
        setPending(false);
        setResult({ ok: m.ok, message: m.message, error: m.error, timeMs: m.timeMs });
      }
    });
  }, []);

  // The opened request is stashed in the store by EditorApp before this panel
  // mounts (see WsOpen/GrpcOpen) — read it here rather than racing the message.
  const grpcOpen = useStore((s) => s.grpcOpen);
  useEffect(() => {
    if (!grpcOpen) return;
    const r = grpcOpen.request;
    if (r) {
      setId(r.id);
      setName(r.name);
      setAddress(r.address);
      setPlaintext(r.plaintext);
      setProto(r.proto);
      setService(r.service);
      setMethod(r.method);
      setMessage(r.message);
      setMetadata(metaToText(r.metadata ?? []));
      setLinkedCollectionId(grpcOpen.collectionId);
      setLinkedFolderId(grpcOpen.folderId);
      setSaveCollectionId(grpcOpen.collectionId ?? "");
      setSaveFolderId(grpcOpen.folderId ?? "");
    } else {
      // Fresh "New gRPC" request.
      setId(newId());
      setName("New gRPC Request");
      setLinkedCollectionId(null);
      setLinkedFolderId(null);
      setSaveCollectionId("");
      setSaveFolderId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grpcOpen?.seq]);

  useEffect(() => {
    postToHost({ type: "setTitle", title: `gRPC ${name}` });
  }, [name]);

  const currentItem = (): GrpcRequest => ({
    id,
    name,
    kind: "grpc",
    address,
    proto,
    service,
    method,
    message,
    metadata: parseMetadata(metadata),
    plaintext,
  });

  const invoke = () => {
    const rid = newId();
    reqId.current = rid;
    setPending(true);
    setResult(null);
    const it = currentItem();
    postToHost({
      type: "grpcInvoke",
      requestId: rid,
      address: it.address,
      proto: it.proto,
      service: it.service,
      method: it.method,
      message: it.message,
      metadata: it.metadata,
      plaintext: it.plaintext,
    });
  };

  const save = () => {
    const collectionId = linkedCollectionId || saveCollectionId;
    if (!collectionId) return;
    postToHost({
      type: "saveRequest",
      collectionId,
      folderId: linkedCollectionId ? linkedFolderId : saveFolderId || null,
      request: currentItem(),
    });
    setLinkedCollectionId(collectionId);
    setLinkedFolderId(linkedCollectionId ? linkedFolderId : saveFolderId || null);
  };

  const saveFolders = tree.find((c) => c.id === saveCollectionId)?.folders ?? [];
  const linkedCollection = linkedCollectionId
    ? tree.find((c) => c.id === linkedCollectionId)
    : undefined;
  const linkedFolder =
    linkedCollection && linkedFolderId
      ? (linkedCollection.folders ?? []).find((f) => f.id === linkedFolderId)
      : undefined;

  return (
    <div className="rm-reqpane">
      <header className="rm-req-meta">
        <input
          className="rm-input rm-req-name"
          aria-label="grpc name"
          placeholder="Request name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="rm-req-meta-actions">
          {linkedCollectionId ? (
            <span className="rm-req-target">
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
            disabled={!linkedCollectionId && !saveCollectionId}
            onClick={save}
          >
            Save
          </button>
        </div>
      </header>

      <div className="rm-urlbar">
        <input
          className="rm-input rm-url-input"
          aria-label="grpc address"
          placeholder="host:port"
          style={{ flex: 1 }}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <label className="rm-inline-check">
          <input
            type="checkbox"
            checked={plaintext}
            onChange={(e) => setPlaintext(e.target.checked)}
          />
          plaintext
        </label>
        <button
          className="rm-btn rm-btn--primary"
          disabled={pending || !address || !service || !method}
          onClick={invoke}
        >
          {pending ? "Invoking…" : "Invoke"}
        </button>
      </div>

      <div className="rm-req-split">
        <section className="rm-req-config" style={{ flex: "0 0 50%" }}>
          <div className="rm-req-config-body rm-grpc-form">
            <label className="rm-graphql-label">Service (package.Service)</label>
            <input
              className="rm-input"
              aria-label="grpc service"
              value={service}
              onChange={(e) => setService(e.target.value)}
            />
            <label className="rm-graphql-label">Method (unary)</label>
            <input
              className="rm-input"
              aria-label="grpc method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            />
            <label className="rm-graphql-label">Proto definition</label>
            <textarea
              className="rm-input rm-code-input"
              aria-label="grpc proto"
              rows={8}
              value={proto}
              onChange={(e) => setProto(e.target.value)}
            />
            <label className="rm-graphql-label">Request message (JSON)</label>
            <textarea
              className="rm-input rm-code-input"
              aria-label="grpc message"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <label className="rm-graphql-label">Metadata (key: value per line)</label>
            <textarea
              className="rm-input rm-code-input"
              aria-label="grpc metadata"
              rows={2}
              value={metadata}
              onChange={(e) => setMetadata(e.target.value)}
            />
          </div>
        </section>
        <div className="rm-split-handle" aria-hidden="true" />
        <section className="rm-req-response">
          {!result ? (
            <div className="rm-blank" style={{ margin: "auto" }}>
              <span className="codicon codicon-server-process rm-blank-icon" />
              <div className="rm-blank-title">No response yet</div>
              <div className="rm-blank-hint">
                Fill in the service, method and message, then Invoke.
              </div>
            </div>
          ) : (
            <div className="rm-panel">
              <div className="rm-statusline">
                <span
                  className={`rm-status-pill ${result.ok ? "is-2xx" : "is-5xx"}`}
                >
                  {result.ok ? "OK" : "ERROR"}
                </span>
                <span className="rm-meta">Time: {result.timeMs} ms</span>
              </div>
              <pre className="rm-code">
                {result.ok ? result.message : result.error}
              </pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
