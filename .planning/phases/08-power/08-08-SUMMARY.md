# 08-08-SUMMARY

## Bulk operations in the collections tree — DONE

Multi-select (cmd/ctrl/shift-click on rows) with a floating bulk bar:
Delete, Duplicate, Move…, Clear. Only the three ops users actually need —
no bulk reorder/export. No host changes: bulk fires the existing per-item
messages.

## Shipped

- `src/webview/views/Sidebar/Sidebar.tsx`:
  - `selected: Set<string>` + `toggleSelect`/`clearSelection`; row
    `onMouseDown` with cmd/ctrl/shift → additive toggle (preventDefault so
    the click doesn't also expand/activate); plain click clears an active
    selection and behaves as usual; document `mousedown` outside the tree
    clears.
  - Kind-aware resolver `infoOf` maps a selected id back to
    collection/folder/request with its location, so bulk actions reuse the
    existing messages: `deleteRequest/deleteFolder/deleteCollection`,
    `duplicateRequest/duplicateFolder/duplicateCollection`,
    `moveRequest/moveFolder`. No new WebviewMessage/HostMessage types.
  - Bulk bar (hidden for viewers): `N selected` + Delete / Duplicate /
    Move… (PopupMenu listing collections + folders as destinations) + clear.
  - Move with a collection selected: blocked with an error toast (a
    collection can't live inside another collection); folder→folder moves
    are skipped (folders don't nest).
- `src/webview/theme.css`: `.rm-selected` (rows) and `.rm-bulk-bar`.

## Docs/scripts sync (verified, no code change needed)

All descriptions and scripts travel with the owning object, so bulk ops
can't desync them:
- duplicate (request/folder/collection) spreads `{ ...src }` — description,
  preRequestScript, testScript are copied (messaging.ts:356/371/400).
- move (request/folder) moves the object as-is (messaging.ts:719/735).
- delete sends the whole object to trash; restore brings docs/scripts back
  (messaging.ts:599).
- saveRequest persists the whole object including description
  (messaging.ts:337).
- Bulky deletes are safe when a parent and child are both selected: after
  the parent goes, the child id is no longer resolvable and its message is
  a host no-op.

## Verification

- `tsc --noEmit` clean; full suite stays 554 green (webview-only change;
  per-item host messages were already covered by existing tests).
- Manual F5 flow per plan: seed a few requests, shift-click all, bulk
  delete → Trash; duplicate batch; move batch via the popup; viewer role
  sees no bulk bar.

## Known limitations

- Bulk delete keeps per-item trash semantics (each item lands in Trash
  separately; no single undo of the whole batch).
- Move popup lists collections + folders as flat rows; long trees scroll
  in the popup menu's own container.
- Shift-click is additive-select, not a range (tree range selection is
  ambiguous with nested folders; not needed for the three ops).