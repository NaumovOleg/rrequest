# 08-04-SUMMARY

## Response examples (save / open / diff) — DONE

One-click "save response as example" on a request (Status + headers + body +
timestamp), an Examples dropdown to reopen any example, and a live diff modal
comparing a saved example against the current response.

## Shipped

- types.ts: `Example` type; `RestRequest.examples?: Example[]`; messages
  `saveExample {requestId, example}` and `deleteExample {requestId, exampleId}`
  (the webview builds the example from its response state — the host never
  crosses the full body back and forth).
- messaging.ts: `findRequestIn` (locate a request anywhere in the collection
  tree by id — no collectionId/folderId needed from the webview),
  `saveExample` appends with a 50-example cap (oldest trimmed), `deleteExample`
  filters. Both return the tree snapshot so the sidebar/list refresh.
- `src/webview/state/diff.ts` (new): `diffLines` — LCS line diff with a
  4M-cell cap (falls back to "everything changed", so a 10 MB body never
  allocates a quadratic table). No new deps.
- ResponsePanel.tsx: "Save example" button (toolbar, disabled for unsaved/
  unlinked requests), "Examples (N)" popup listing saved examples
  (name = "status statusText · time", Diff/delete actions), diff modal with
  two panes — example (removed lines) vs live response (added lines), common
  lines in both; recomputes on every response change (re-send while the modal
  is open updates the comparison).
- theme.css: `.rm-diff-*`, `.rm-example-row` styles reusing rm-error/rm-success
  colors.
- store.ts: `locateInTree` exported for the panel to read examples from the
  live tree.

## Verification

- test/extension/diff.test.ts: 5 tests (identity, middle insert/remove,
  append, interleaved same-lines, cell-cap fallback).
- messaging.test.ts: 5 new tests (save appends, save finds request in folder,
  cap 50 + trim oldest, no-op for ghost requests, delete by id).
- Full suite: 543 tests green (was 533). `tsc` clean, build green.

## Known limitations

- Diff is line-based only (no unified-markers/line numbers) — enough to spot
  payload shape drift; a proper diff engine (jsdiff/`diff`) is a dependency
  we deliberately skipped.
- Examples are only attached while viewing the response of a request that
  exists in a collection; unsaved scratch tabs can't take examples.