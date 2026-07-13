# UI Design Pass Smoke Checklist

Press F5 → open restman (sidebar) + a request (editor).

- [ ] Sidebar: workspace switcher, Collections/Environments/History as titled sections; collection rows have a caret + hover; request rows show a colored method badge.
- [ ] Editor tabs: active tab underlined with the accent; each tab shows a colored method badge + name; close × and + present.
- [ ] Request URL bar: colored method dropdown (GET green, POST yellow, DELETE red, …), full-width URL input, primary Send button.
- [ ] Sub-tabs (Params/Headers/Body/Pre-request/Tests) underline the active one; key/value tables have a header row and clean cell borders.
- [ ] Response: status pill colored by range (200 green, 404 yellow, 500 red); time/size muted; Test Results show green PASS / red FAIL badges; Console monospaced.
- [ ] WebSocket panel: status pill (open green / connecting yellow / closed red), colored log rows (in/out/status), headers table.
- [ ] Switch VS Code theme light↔dark → everything re-themes; no unreadable/hard-coded colors.
