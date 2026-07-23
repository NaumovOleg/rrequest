# Drive Sync DS-Phase 5b-ui — manual verification (sharing UX)

Prereq: DS-Phase 5a + 5b-core running; two Google accounts; both in restman.

## A. Members panel (owner)
1. As OWNER, open the active synced workspace's **Members** entry → the Members panel opens.
2. Enter a MEMBER email, pick a role (Editor/Viewer), **Send Invite** → the member appears in the list (pending if no account yet); Google emails them (DS-Phase 5a).
3. Remove a member with the ✕ → they disappear and lose access.

## B. Viewer read-only UX
1. Share as **Viewer**; the MEMBER's active workspace shows a **Viewer** role badge; New Request/Collection, rename, delete, +folder, and Save are hidden/disabled.
2. Any attempted mutation surfaces a read-only **toast**; the local tree doesn't change.
3. Open/send a request, view history/environment values — still work.

## C. Toasts
1. A viewer edit attempt and a sync/permission error both render a toast (auto-dismiss + click-to-dismiss), in both the sidebar and editor surfaces.

## D. Switcher popup
1. Open the workspace switcher → search filters the list; owned vs shared workspaces show distinct role/type icons; the active workspace is checked. Create Workspace works.
