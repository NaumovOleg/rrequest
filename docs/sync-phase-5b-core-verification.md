# Drive Sync DS-Phase 5b-core — manual verification (extension role enforcement)

Prereq: backend running (DS-Phase 5a) with two Google accounts (OWNER, MEMBER); OWNER has enabled sync on `w1` and shared it with MEMBER; both signed into rrequest.

## A. Role recorded
1. As MEMBER, open/sync `w1`. Confirm the local `sync-state.json` for `w1` shows `role: "editor"` (or `"viewer"`) matching the share, and it updates if OWNER changes the role (after a pull / refreshRoles).

## B. Viewer is read-only in the extension (no round-trip)
1. OWNER shares `w1` with MEMBER as **viewer**; MEMBER pulls so `sync-state.role` = `viewer`.
2. In MEMBER's rrequest, with `w1` active, attempt any edit (new collection/request/folder, rename, delete, save request, edit environment). The change is blocked and a read-only toast/error is surfaced; the local tree is unchanged (no mutation applied).
3. Non-mutating actions still work: opening a request, sending a request, viewing history/environments.

## C. Removed member drops sync, keeps local
1. With MEMBER (editor) actively synced on `w1`, OWNER removes MEMBER (`DELETE .../members/:id`).
2. MEMBER's next push or pull returns 403 → sync silently drops (`sync-state.synced` becomes `false`) but the local collections/environments for `w1` REMAIN intact and editable locally.
3. Re-sharing MEMBER lets them re-enable sync and resume.

## D. Downgrade editor→viewer
1. OWNER downgrades MEMBER from editor to viewer; MEMBER pulls (or refreshRoles runs).
2. MEMBER's `sync-state.role` becomes `viewer`; further edits are blocked as in B.
