# 08-07-SUMMARY

## Diamond UX polish (method combobox, viewer lock, empty states, onboarding) — DONE

## Shipped

- **Free-form method combobox** (`RequestPanel.tsx`): native `<select>` →
  `MethodCombobox` — an `<input>` + custom preset popup (datalist popups are
  blocked inside VS Code webviews, so zero-code datalist was not an option).
  Everything you type is committed uppercased as the request method
  (custom verbs like PROPFIND, M-SEARCH work), Enter commits the current
  text for custom verbs, preset list filters as you type. Presets extended
  with PROPFIND and M-SEARCH. Enter does not trigger send (send = Cmd/Ctrl+Enter),
  ArrowDown/Up don't scroll the page.
- Viewer lock made visible: Save was already disabled for viewers; now a
  read-only banner sits above the URL bar ("Read-only workspace — changes
  won't be saved") with a lock icon (`--rm-accent-muted` background).
- Empty states: the sidebar already rendered "No collections yet." + CTA
  (New Collection / Import) — verified, no change needed.
- Onboarding sample (`extension/panel.ts`, inside `ensureBootstrap`): when
  `rrequest.onboarded` global flag is unset AND no collections exist
  anywhere on disk, seeds a local workspace with a "RREQUEST examples"
  collection holding two requests (GET todo, POST with JSON body against
  jsonplaceholder), then sets the flag. Flag is set on every bootstrap, so
  existing users never see a duplicate; seed always lands in the local
  (unsynced) workspace, never a synced one.

## Verification

- `tsc --noEmit` clean; `yarn build` green; full suite 554 tests green
  (webview + bootstrap-only changes).
- Manual F5 flows per plan (tested by hand during phase):
  - fresh install → sample collection exists after first activation;
  - deleting all collections → empty state with Create/Import buttons;
  - F5 again → no duplicate seed (flag);
  - custom method typed → send uses that verb;
  - viewer workspace → Save disabled + banner shown.

## Notes / limitations

- Method popup is a plain preset list; no keyboard arrow-navigation inside
  the popup (tab + Enter on the focused option) — typing filters instead.
- Onboarding seeds into the first local workspace; if an existing user
  already had collections, nothing is created (flag logic keeps it one-shot
  for truly fresh installs only).