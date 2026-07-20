import { useState, useMemo } from "react";
import { useStore } from "../../state/store";
import { postToHost } from "../../ipc";
import { IconButton, MethodBadge } from "../../elements";
import { itemKind, type CollectionItem, type Collection, type Folder, type TrashEntry } from "../../../shared/types";

type Restore = { entryId: string; folderId?: string; requestId?: string };
type ReqNode = { item: CollectionItem; restore: Restore; purge?: string };
type FolderNode = { id: string; name: string; requests: ReqNode[]; restore?: Restore; purge?: string };
type ColNode = { id: string; name: string; folders: Map<string, FolderNode>; requests: ReqNode[]; restore?: Restore; purge?: string };

// Merge every trash entry into a single collection tree so two requests deleted
// from the same folder show under one collection/folder, not as flat rows.
function buildTree(entries: TrashEntry[]) {
  const cols = new Map<string, ColNode>();
  const envs: TrashEntry[] = [];
  const getCol = (id: string, name: string): ColNode => {
    let c = cols.get(id);
    if (!c) { c = { id, name, folders: new Map(), requests: [] }; cols.set(id, c); }
    else if (name && c.name.startsWith("(")) c.name = name;
    return c;
  };
  const getFolder = (c: ColNode, id: string, name: string): FolderNode => {
    let f = c.folders.get(id);
    if (!f) { f = { id, name, requests: [] }; c.folders.set(id, f); }
    return f;
  };

  for (const e of entries) {
    if (e.kind === "environment") { envs.push(e); continue; }
    if (e.kind === "request") {
      const p = e.path!;
      const c = getCol(p.collectionId, p.collectionName);
      const r: ReqNode = { item: e.data as CollectionItem, restore: { entryId: e.id }, purge: e.id };
      if (p.folderId) getFolder(c, p.folderId, p.folderName ?? "(folder)").requests.push(r);
      else c.requests.push(r);
    } else if (e.kind === "folder") {
      const p = e.path!;
      const c = getCol(p.collectionId, p.collectionName);
      const fd = e.data as Folder;
      const f = getFolder(c, fd.id, fd.name);
      f.restore = { entryId: e.id };
      f.purge = e.id;
      for (const r of fd.requests) f.requests.push({ item: r, restore: { entryId: e.id, requestId: r.id } });
    } else {
      const col = e.data as Collection;
      const c = getCol(col.id, col.name);
      c.restore = { entryId: e.id };
      c.purge = e.id;
      for (const fd of col.folders ?? []) {
        const f = getFolder(c, fd.id, fd.name);
        f.restore = { entryId: e.id, folderId: fd.id };
        for (const r of fd.requests) f.requests.push({ item: r, restore: { entryId: e.id, folderId: fd.id, requestId: r.id } });
      }
      for (const r of col.requests) c.requests.push({ item: r, restore: { entryId: e.id, requestId: r.id } });
    }
  }
  return { collections: [...cols.values()], envs };
}

function itemBadge(r: CollectionItem) {
  const k = itemKind(r);
  if (k === "grpc") return <span className="rm-method rm-method--OTHER">gRPC</span>;
  if (k === "ws") return <span className="rm-method rm-method--OTHER">WS</span>;
  return <MethodBadge method={(r as { method: string }).method} />;
}

export function TrashView() {
  const trash = useStore((s) => s.trash);
  const { collections, envs } = useMemo(() => buildTree(trash), [trash]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setExpanded((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const open = (k: string) => expanded.has(k);

  const restore = (t: Restore) => postToHost({ type: "restoreTrash", ...t });
  const purge = (entryId: string) => postToHost({ type: "purgeTrash", entryId });

  const reqRow = (r: ReqNode) => (
    <div key={r.item.id} className="rm-req-row">
      {itemBadge(r.item)} <span className="rm-tree-label">{r.item.name}</span>
      <div className="rm-actions">
        <IconButton icon="redo" label={`restore ${r.item.name}`} onClick={() => restore(r.restore)} />
        {r.purge && <IconButton icon="trash" label={`delete forever ${r.item.name}`} onClick={() => purge(r.purge!)} />}
      </div>
    </div>
  );

  const folderRow = (c: ColNode, f: FolderNode) => {
    const key = `f:${c.id}:${f.id}`;
    return (
      <div key={f.id}>
        <div className="rm-tree-row" onClick={() => toggle(key)}>
          <span className="rm-tree-caret" role="button" aria-label={`toggle ${f.name}`}>
            {open(key) ? "▾" : "▸"}
          </span>{" "}
          <span className={`codicon codicon-folder${open(key) ? "-opened" : ""}`} />{" "}
          <span className="rm-tree-label">{f.name}</span>
          <div className="rm-actions">
            {f.restore && <IconButton icon="redo" label={`restore ${f.name}`} onClick={() => restore(f.restore!)} />}
            {f.purge && <IconButton icon="trash" label={`delete forever ${f.name}`} onClick={() => purge(f.purge!)} />}
          </div>
        </div>
        {open(key) && <div className="rm-tree-children">{f.requests.map(reqRow)}</div>}
      </div>
    );
  };

  const colRow = (c: ColNode) => {
    const key = `c:${c.id}`;
    return (
      <div key={c.id}>
        <div className="rm-tree-row" onClick={() => toggle(key)}>
          <span className="rm-tree-caret" role="button" aria-label={`toggle ${c.name}`}>
            {open(key) ? "▾" : "▸"}
          </span>{" "}
          <span className="rm-tree-label">{c.name}</span>
          <div className="rm-actions">
            {c.restore && <IconButton icon="redo" label={`restore ${c.name}`} onClick={() => restore(c.restore!)} />}
            {c.purge && <IconButton icon="trash" label={`delete forever ${c.name}`} onClick={() => purge(c.purge!)} />}
          </div>
        </div>
        {open(key) && (
          <div className="rm-tree-children">
            {[...c.folders.values()].map((f) => folderRow(c, f))}
            {c.requests.map(reqRow)}
          </div>
        )}
      </div>
    );
  };

  const isEmpty = collections.length === 0 && envs.length === 0;
  return (
    <div className="rm-tree">
      <div className="rm-tree-head">
        <span className="rm-section-title">Trash</span>
      </div>
      {isEmpty ? (
        <div className="rm-empty">Trash is empty.</div>
      ) : (
        <>
          {collections.map(colRow)}
          {envs.map((e) => {
            const name = (e.data as { name: string }).name;
            return (
              <div key={e.id} className="rm-tree-row">
                <span className="rm-trash-kind">env</span>{" "}
                <span className="rm-tree-label">{name}</span>
                <div className="rm-actions">
                  <IconButton icon="redo" label={`restore ${name}`} onClick={() => restore({ entryId: e.id })} />
                  <IconButton icon="trash" label={`delete forever ${name}`} onClick={() => purge(e.id)} />
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
