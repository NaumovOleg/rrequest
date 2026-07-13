# restman — UI Design Pass Design

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan
**Scope:** A visual design pass over the whole UI — a `--vscode-*`-driven design system + restyle of every surface to a Postman-like layout that stays theme-adaptive (light/dark). Branch `ui-design` (stacked on `phase5-websockets`). No behavior changes.

## Goals

- The extension looks like a real REST client (Postman layout from `design.png`), not bare `rm-*` boxes.
- All colors come from `--vscode-*` variables so it fits the IDE and adapts to light/dark automatically.
- HTTP methods are color-coded (GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS) in tabs, the collection tree, and the method dropdown.
- Consistent spacing, typography, borders, hover/active states across the sidebar and editor surfaces.
- Zero behavior change — only markup class names, structure for layout, and CSS. Existing behavior tests keep passing.

## Decisions

- **Style:** VS Code-native — Postman's structure/layout, VS Code theme colors. No fixed hex on themed surfaces.
- **Method colors:** map to `--vscode-charts-*` (they exist and adapt per theme): GET→green, POST→yellow, PUT→blue, PATCH→purple, DELETE→red, HEAD/OPTIONS→foreground/muted. Applied via a `rm-method--<METHOD>` class computed by a pure `methodClass(method)` helper.
- **No component-behavior rewrites:** styling is applied by adding/adjusting `className`s and light structural wrappers; message flows, store, and handlers are untouched.
- **Design system in `theme.css`:** one expanded stylesheet defines CSS custom properties (spacing, radius, colors mapped from `--vscode-*`) and component classes; both bundles already import it.

## Design system (`theme.css`)

CSS custom properties (mapped from VS Code vars, with sensible fallbacks):
```
--rm-bg            : var(--vscode-editor-background)
--rm-panel-bg      : var(--vscode-sideBar-background, var(--vscode-editor-background))
--rm-fg            : var(--vscode-foreground)
--rm-muted         : var(--vscode-descriptionForeground, ...)
--rm-border        : var(--vscode-panel-border, var(--vscode-widget-border, rgba(128,128,128,.25)))
--rm-hover         : var(--vscode-list-hoverBackground)
--rm-active        : var(--vscode-list-activeSelectionBackground)
--rm-accent        : var(--vscode-button-background)
--rm-accent-fg     : var(--vscode-button-foreground)
--rm-input-bg      : var(--vscode-input-background)
--rm-input-border  : var(--vscode-input-border, var(--rm-border))
--rm-error         : var(--vscode-errorForeground)
--rm-success       : var(--vscode-testing-iconPassed, var(--vscode-charts-green, green))
--rm-sp-1..4       : 4px / 8px / 12px / 16px
--rm-radius        : 4px
```
Method colors:
```
--rm-m-get    : var(--vscode-charts-green)
--rm-m-post   : var(--vscode-charts-yellow)
--rm-m-put    : var(--vscode-charts-blue)
--rm-m-patch  : var(--vscode-charts-purple)
--rm-m-delete : var(--vscode-charts-red, var(--vscode-errorForeground))
--rm-m-other  : var(--rm-muted)
.rm-method--GET{color:var(--rm-m-get)} ... .rm-method--DELETE{...} etc.
```
Component classes (used across the restyle):
- Layout: `.rm-surface` (fills height, bg/fg/font), `.rm-topbar`, `.rm-section`, `.rm-section-title`.
- Tabs: `.rm-tabbar`, `.rm-tab` (+ `.is-active` underline via border-bottom accent), `.rm-tab-close`.
- URL bar: `.rm-urlbar` (flex row), `.rm-method-select`, `.rm-url-input`, `.rm-send` (primary button).
- Buttons: `.rm-btn` (default), `.rm-btn--primary` (accent bg), `.rm-btn--ghost`/`.rm-btn--icon` (borderless).
- Sub-tabs: `.rm-subtabs`, `.rm-subtab` (+ `.is-active` underline).
- Tables: `.rm-kvtable` (full width, header row `.rm-kvtable-head`, cell borders, checkbox/key/value/description columns), `.rm-kv-input` (borderless cell input).
- Tree: `.rm-tree`, `.rm-tree-row` (hover), `.rm-tree-caret`, `.rm-tree-indent`, `.rm-req-row` (with a `.rm-method` badge + name).
- Response: `.rm-statusline`, `.rm-status-pill` (+ `.is-2xx`/`.is-4xx`/`.is-5xx`/`.is-err` colors), `.rm-meta` (time/size), `.rm-badge` (+ `.is-pass`/`.is-fail`).
- WS log: `.rm-log`, `.rm-log-row` (+ `.is-in`/`.is-out`/`.is-status` accent), `.rm-log-dir`, `.rm-log-time`.
- Inputs/panels: `.rm-input`, `.rm-select`, `.rm-panel`, `.rm-scroll` (overflow auto).

All colors reference the custom properties above; no literal hex on themed surfaces (rgba fallbacks inside `var(...)` defaults are allowed).

## Surfaces restyled

- **Editor top bar** — a slim toolbar: WebSocket toggle (segmented look), spacer, active-environment dropdown on the right.
- **Tabs** — a proper tab bar: active tab underlined with the accent, method badge (colored) + name, a subtle close `×`, and the `+` new-tab button.
- **RequestPanel** — the Postman URL bar (colored method `<select>` + full-width URL input + primary Send), a save row, a curl row, underlined sub-tabs (Params/Headers/Body/Pre-request/Tests), and `.rm-kvtable` param/header tables with a header row.
- **ResponsePanel** — a status line with a colored status pill (2xx green / 4xx yellow / 5xx+error red), time & size meta, underlined sub-tabs (Body/Headers/Cookies/Test Results/Console), PASS/FAIL badges in Test Results, a monospaced Console.
- **Sidebar tree** — indented collection rows with an expand caret and hover, request rows with a colored method badge, compact icon-ish action buttons (New Request/Import/+New/Export/+Request).
- **WorkspaceSwitcher / Environments / History** — consistent sidebar sections with titles, the workspace `<select>` styled, env/history rows with hover; the env variable table uses `.rm-kvtable`.
- **WebSocketPanel** — a URL bar + Connect/Disconnect (primary/again), a status pill, a headers `.rm-kvtable`, a composer, and a `.rm-log` with direction-colored rows + timestamps.

## Non-goals

- No new features or behavior changes (no new messages, store fields, or flows).
- No icon font / SVG icon set (use text/unicode glyphs already present, `▸▾ × +`); a real icon set is a later option.
- No animation beyond simple hover transitions.
- Not pixel-identical to Postman — VS Code-native adaptation.

## Testing (TDD, light)

Since this is CSS/markup, tests assert structure not pixels:
- **`method-color`** — `methodClass('GET')==='rm-method--GET'`, etc.; unknown → `rm-method--OTHER`.
- **`theme.css`** — contains the key custom properties (`--rm-accent`, `--rm-m-get`, …) and the key component classes (`.rm-tab`, `.rm-kvtable`, `.rm-status-pill`, `.rm-log-row`, `.rm-method--GET`); still no hard-coded hex on `body`.
- **components** — each restyled component still passes its existing behavior tests; where a new class matters (method badge present, active tab class, status-pill class by status range), add a targeted assertion. No existing assertion is weakened.

## Files

New: `src/webview/method-color.ts` (+ test), `src/webview/components/common/MethodBadge.tsx` (+ test).
Modified: `src/webview/theme.css` (the design system), and every component's markup/classes: `Tabs`, `RequestPanel`, `ResponsePanel`, `Sidebar`, `WorkspaceSwitcher`, `Environments`, `History`, `WebSocketPanel`, `EditorApp`, `SidebarApp` (+ their tests as needed).

## Open questions

None blocking. Iteration happens against the real extension (F5); this spec sets the system, details refine live.
