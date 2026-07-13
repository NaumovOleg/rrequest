# restman UI Design Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the whole UI to a Postman-like layout using a `--vscode-*`-driven design system (theme-adaptive light/dark), with color-coded HTTP methods — no behavior changes.

**Architecture:** One expanded `theme.css` design system (CSS custom properties mapped from `--vscode-*` + component classes) plus a pure `methodClass()` helper and a `<MethodBadge/>`. Each component is restyled by applying the new classes / light structural wrappers — message flows, store, and handlers are untouched.

**Tech Stack:** CSS + existing React/Vitest. No new deps.

## Global Constraints

- NO behavior change: no new messages, store fields, or flows; only className/markup/CSS. Every existing behavior test must keep passing without weakening assertions.
- All colors reference the design-system custom properties (which map to `--vscode-*`); no literal hex on themed surfaces (rgba fallbacks inside `var(..., fallback)` are allowed).
- Method colors via `rm-method--<UPPERCASE METHOD>` classes from `methodClass(method)`; unknown/HEAD/OPTIONS → `rm-method--OTHER`.
- `theme.css` is imported by both bundles already (editor + sidebar) — one stylesheet serves both.
- TDD; run `npx tsc --noEmit` each task and confirm clean; run `npm run build` before the final commit; small commits.

---

## File Structure

```
New:
  src/webview/method-color.ts                         // methodClass() (pure)
  src/webview/components/common/MethodBadge.tsx        // colored method label
  + tests

Modified (restyle — classes/markup only):
  src/webview/theme.css                                // the design system
  src/webview/components/Tabs/Tabs.tsx
  src/webview/components/RequestPanel/RequestPanel.tsx
  src/webview/components/ResponsePanel/ResponsePanel.tsx
  src/webview/components/Sidebar/Sidebar.tsx
  src/webview/components/WorkspaceSwitcher/WorkspaceSwitcher.tsx
  src/webview/components/Environments/Environments.tsx
  src/webview/components/History/History.tsx
  src/webview/components/WebSocket/WebSocketPanel.tsx
  src/webview/editor/EditorApp.tsx
  src/webview/sidebar/SidebarApp.tsx
```

---

## Task 1: Design system — theme.css, methodClass, MethodBadge

**Files:**
- Modify: `src/webview/theme.css`
- Create: `src/webview/method-color.ts`, `src/webview/components/common/MethodBadge.tsx`
- Test: `test/webview/method-color.test.ts`, `test/webview/MethodBadge.test.tsx`, `test/webview/theme.test.ts` (extend existing)

- [ ] **Step 1: Write the failing tests**

`test/webview/method-color.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { methodClass } from '../../src/webview/method-color'

describe('methodClass', () => {
  it('maps known methods to rm-method--<METHOD>', () => {
    expect(methodClass('GET')).toBe('rm-method--GET')
    expect(methodClass('POST')).toBe('rm-method--POST')
    expect(methodClass('DELETE')).toBe('rm-method--DELETE')
  })
  it('maps HEAD/OPTIONS/unknown to rm-method--OTHER', () => {
    expect(methodClass('HEAD')).toBe('rm-method--OTHER')
    expect(methodClass('OPTIONS')).toBe('rm-method--OTHER')
    expect(methodClass('WAT' as any)).toBe('rm-method--OTHER')
  })
})
```

`test/webview/MethodBadge.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MethodBadge } from '../../src/webview/components/common/MethodBadge'

describe('MethodBadge', () => {
  it('renders the method with its color class', () => {
    render(<MethodBadge method="GET" />)
    const el = screen.getByText('GET')
    expect(el.className).toContain('rm-method')
    expect(el.className).toContain('rm-method--GET')
  })
})
```

Extend `test/webview/theme.test.ts` (keep the existing assertions) with:
```ts
it('defines the design-system custom properties and component classes', () => {
  const css = fs.readFileSync('src/webview/theme.css', 'utf8')
  expect(css).toContain('--rm-accent')
  expect(css).toContain('--rm-m-get')
  expect(css).toContain('.rm-method--GET')
  expect(css).toContain('.rm-tab')
  expect(css).toContain('.rm-kvtable')
  expect(css).toContain('.rm-status-pill')
  expect(css).toContain('.rm-log-row')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/webview/method-color.test.ts test/webview/MethodBadge.test.tsx test/webview/theme.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement — method-color.ts**

`src/webview/method-color.ts`:
```ts
import type { HttpMethod } from '../shared/types'

const COLORED: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export function methodClass(method: string): string {
  return (COLORED as string[]).includes(method) ? `rm-method--${method}` : 'rm-method--OTHER'
}
```

- [ ] **Step 4: Implement — MethodBadge.tsx**

`src/webview/components/common/MethodBadge.tsx`:
```tsx
import { methodClass } from '../../method-color'

export function MethodBadge({ method }: { method: string }) {
  return <span className={`rm-method ${methodClass(method)}`}>{method}</span>
}
```

- [ ] **Step 5: Implement — theme.css (replace the file with the design system)**

`src/webview/theme.css`:
```css
:root {
  --rm-bg: var(--vscode-editor-background);
  --rm-panel-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --rm-fg: var(--vscode-foreground);
  --rm-muted: var(--vscode-descriptionForeground, rgba(128,128,128,0.9));
  --rm-border: var(--vscode-panel-border, var(--vscode-widget-border, rgba(128,128,128,0.25)));
  --rm-hover: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12));
  --rm-active: var(--vscode-list-activeSelectionBackground, rgba(128,128,128,0.2));
  --rm-accent: var(--vscode-button-background, #0e639c);
  --rm-accent-fg: var(--vscode-button-foreground, #fff);
  --rm-accent-hover: var(--vscode-button-hoverBackground, var(--rm-accent));
  --rm-input-bg: var(--vscode-input-background);
  --rm-input-fg: var(--vscode-input-foreground);
  --rm-input-border: var(--vscode-input-border, var(--rm-border));
  --rm-error: var(--vscode-errorForeground, #f14c4c);
  --rm-success: var(--vscode-testing-iconPassed, var(--vscode-charts-green, #3fb950));
  --rm-warn: var(--vscode-charts-yellow, #d7ba7d);
  --rm-sp-1: 4px; --rm-sp-2: 8px; --rm-sp-3: 12px; --rm-sp-4: 16px;
  --rm-radius: 4px;
  --rm-m-get: var(--vscode-charts-green, #3fb950);
  --rm-m-post: var(--vscode-charts-yellow, #d7ba7d);
  --rm-m-put: var(--vscode-charts-blue, #4aa5f0);
  --rm-m-patch: var(--vscode-charts-purple, #b180d7);
  --rm-m-delete: var(--vscode-charts-red, var(--vscode-errorForeground, #f14c4c));
  --rm-m-other: var(--rm-muted);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--rm-bg);
  color: var(--rm-fg);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
}

/* layout */
.rm-surface { display: flex; flex-direction: column; height: 100vh; background: var(--rm-bg); color: var(--rm-fg); }
.rm-topbar { display: flex; align-items: center; gap: var(--rm-sp-2); padding: var(--rm-sp-1) var(--rm-sp-2); border-bottom: 1px solid var(--rm-border); }
.rm-row { display: flex; gap: var(--rm-sp-2); align-items: center; }
.rm-panel { border: 1px solid var(--rm-border); border-radius: var(--rm-radius); }
.rm-section { padding: var(--rm-sp-2); }
.rm-section-title { font-weight: 600; text-transform: uppercase; font-size: 0.85em; letter-spacing: .04em; color: var(--rm-muted); margin-bottom: var(--rm-sp-1); }
.rm-scroll { overflow: auto; }
.rm-spacer { flex: 1; }

/* buttons */
.rm-btn { background: transparent; color: var(--rm-fg); border: 1px solid var(--rm-border); border-radius: var(--rm-radius); padding: 3px 10px; cursor: pointer; font-size: 0.95em; }
.rm-btn:hover { background: var(--rm-hover); }
.rm-btn:disabled { opacity: .5; cursor: default; }
.rm-btn--primary { background: var(--rm-accent); color: var(--rm-accent-fg); border-color: transparent; }
.rm-btn--primary:hover { background: var(--rm-accent-hover); }
.rm-btn--ghost, .rm-btn--icon { border-color: transparent; background: transparent; padding: 2px 6px; }
.rm-btn--ghost:hover, .rm-btn--icon:hover { background: var(--rm-hover); }

/* inputs */
.rm-input, .rm-select { background: var(--rm-input-bg); color: var(--rm-input-fg); border: 1px solid var(--rm-input-border); border-radius: var(--rm-radius); padding: 4px 6px; font: inherit; }
.rm-input:focus, .rm-select:focus { outline: 1px solid var(--rm-accent); outline-offset: -1px; }

/* method colors */
.rm-method { font-weight: 700; font-size: 0.85em; letter-spacing: .03em; }
.rm-method--GET { color: var(--rm-m-get); }
.rm-method--POST { color: var(--rm-m-post); }
.rm-method--PUT { color: var(--rm-m-put); }
.rm-method--PATCH { color: var(--rm-m-patch); }
.rm-method--DELETE { color: var(--rm-m-delete); }
.rm-method--OTHER { color: var(--rm-m-other); }

/* tabs */
.rm-tabbar { display: flex; align-items: stretch; gap: 0; border-bottom: 1px solid var(--rm-border); overflow-x: auto; }
.rm-tab { display: inline-flex; align-items: center; gap: var(--rm-sp-1); padding: var(--rm-sp-1) var(--rm-sp-2); border: none; background: transparent; color: var(--rm-fg); border-bottom: 2px solid transparent; cursor: pointer; white-space: nowrap; }
.rm-tab:hover { background: var(--rm-hover); }
.rm-tab.is-active { border-bottom-color: var(--rm-accent); }
.rm-tab-close { border: none; background: transparent; color: var(--rm-muted); cursor: pointer; padding: 0 4px; }
.rm-tab-close:hover { color: var(--rm-fg); }

/* url bar */
.rm-urlbar { display: flex; gap: var(--rm-sp-1); align-items: stretch; padding: var(--rm-sp-2); }
.rm-method-select { min-width: 90px; font-weight: 700; }
.rm-url-input { flex: 1; }

/* sub-tabs */
.rm-subtabs { display: flex; gap: var(--rm-sp-3); padding: 0 var(--rm-sp-2); border-bottom: 1px solid var(--rm-border); }
.rm-subtab { background: transparent; border: none; border-bottom: 2px solid transparent; color: var(--rm-muted); padding: var(--rm-sp-1) 0; cursor: pointer; }
.rm-subtab:hover { color: var(--rm-fg); }
.rm-subtab.is-active { color: var(--rm-fg); border-bottom-color: var(--rm-accent); }

/* key/value tables */
.rm-kvtable { width: 100%; border-collapse: collapse; }
.rm-kvtable th { text-align: left; font-size: 0.8em; text-transform: uppercase; color: var(--rm-muted); padding: var(--rm-sp-1) var(--rm-sp-2); border-bottom: 1px solid var(--rm-border); }
.rm-kvtable td { border-bottom: 1px solid var(--rm-border); padding: 0; }
.rm-kv-input { width: 100%; background: transparent; color: var(--rm-fg); border: none; padding: 4px 8px; font: inherit; }
.rm-kv-input:focus { outline: 1px solid var(--rm-accent); outline-offset: -1px; }

/* tree */
.rm-tree { display: flex; flex-direction: column; }
.rm-tree-row { display: flex; align-items: center; gap: var(--rm-sp-1); padding: 3px var(--rm-sp-2); cursor: pointer; border-radius: var(--rm-radius); }
.rm-tree-row:hover { background: var(--rm-hover); }
.rm-tree-caret { width: 14px; color: var(--rm-muted); }
.rm-tree-children { padding-left: var(--rm-sp-3); }
.rm-req-row { display: flex; align-items: center; gap: var(--rm-sp-2); padding: 2px var(--rm-sp-2) 2px var(--rm-sp-3); cursor: pointer; border-radius: var(--rm-radius); }
.rm-req-row:hover { background: var(--rm-hover); }

/* response status */
.rm-statusline { display: flex; align-items: center; gap: var(--rm-sp-3); padding: var(--rm-sp-1) var(--rm-sp-2); border-bottom: 1px solid var(--rm-border); }
.rm-status-pill { font-weight: 700; padding: 1px 8px; border-radius: 10px; border: 1px solid currentColor; font-size: 0.85em; }
.rm-status-pill.is-2xx { color: var(--rm-success); }
.rm-status-pill.is-3xx { color: var(--rm-m-put); }
.rm-status-pill.is-4xx { color: var(--rm-warn); }
.rm-status-pill.is-5xx, .rm-status-pill.is-err { color: var(--rm-error); }
.rm-meta { color: var(--rm-muted); font-size: 0.9em; }
.rm-badge { font-weight: 700; font-size: 0.8em; padding: 1px 6px; border-radius: var(--rm-radius); }
.rm-badge.is-pass { color: var(--rm-success); }
.rm-badge.is-fail { color: var(--rm-error); }

/* error banner */
.rm-error-banner { color: var(--rm-error); padding: var(--rm-sp-2); }

/* code / pre */
.rm-code { background: var(--rm-input-bg); border: 1px solid var(--rm-border); border-radius: var(--rm-radius); padding: var(--rm-sp-2); white-space: pre-wrap; margin: var(--rm-sp-2); font-family: var(--vscode-editor-font-family, monospace); }

/* websocket log */
.rm-log { flex: 1; overflow: auto; padding: var(--rm-sp-1) var(--rm-sp-2); font-family: var(--vscode-editor-font-family, monospace); font-size: 0.95em; }
.rm-log-row { display: flex; gap: var(--rm-sp-2); padding: 1px 0; }
.rm-log-dir { min-width: 44px; color: var(--rm-muted); }
.rm-log-time { color: var(--rm-muted); }
.rm-log-row.is-in .rm-log-dir { color: var(--rm-m-get); }
.rm-log-row.is-out .rm-log-dir { color: var(--rm-m-put); }
.rm-log-row.is-status .rm-log-dir { color: var(--rm-muted); }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/webview/method-color.test.ts test/webview/MethodBadge.test.tsx test/webview/theme.test.ts && npx vitest run && npx tsc --noEmit`
Expected: PASS; existing component tests still green (they don't assert removed classes — the old `.rm-row`/`.rm-btn`/`.rm-input`/`.rm-select`/`.rm-panel` classes remain defined).

- [ ] **Step 7: Commit**

```bash
git add src/webview/theme.css src/webview/method-color.ts src/webview/components/common/MethodBadge.tsx test/webview/method-color.test.ts test/webview/MethodBadge.test.tsx test/webview/theme.test.ts
git commit -m "feat(ui): design system in theme.css + methodClass + MethodBadge"
```

---

## Task 2: Tabs restyle

**Files:**
- Modify: `src/webview/components/Tabs/Tabs.tsx`
- Test: `test/webview/Tabs.test.tsx` (append one assertion)

**Restyle:** wrap in `.rm-tabbar`; each tab is `<button className="rm-tab {is-active}">` containing `<MethodBadge method={t.method}/>` + the name; the close button becomes `.rm-tab-close`; the `+` becomes `.rm-btn--icon`. Keep all handlers, `aria-label`s (`close <name>`, `+`), and `aria-pressed` on the active tab exactly as they are.

- [ ] **Step 1: Write the failing test (append)**

```ts
it('renders a method badge and marks the active tab', () => {
  useStore.getState().openNewTab()
  useStore.getState().updateActive({ method: 'POST' })
  render(<Tabs />)
  expect(document.querySelector('.rm-method--POST')).toBeTruthy()
  expect(document.querySelector('.rm-tab.is-active')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/Tabs.test.tsx`
Expected: FAIL — no `.rm-method--POST` / `.rm-tab.is-active`.

- [ ] **Step 3: Implement**

Update `Tabs.tsx` markup: import `MethodBadge` (`../common/MethodBadge`); render:
```tsx
    <div className="rm-tabbar">
      {tabs.map((t) => (
        <span key={t.id} className="rm-row">
          <button className={`rm-tab ${t.id === activeTabId ? 'is-active' : ''}`} aria-pressed={t.id === activeTabId}
            onClick={() => setActive(t.id)}>
            <MethodBadge method={t.method} /> {t.name}
          </button>
          <button className="rm-tab-close" aria-label={`close ${t.name}`} onClick={() => closeTab(t.id)}>×</button>
        </span>
      ))}
      <button className="rm-btn--icon" aria-label="+" onClick={openNewTab}>+</button>
    </div>
```
Keep the same `useStore` selectors/handlers.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/Tabs.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/Tabs/Tabs.tsx test/webview/Tabs.test.tsx
git commit -m "feat(ui): restyle tabs with method badges and active underline"
```

---

## Task 3: RequestPanel restyle

**Files:**
- Modify: `src/webview/components/RequestPanel/RequestPanel.tsx`
- Test: `test/webview/RequestPanel.test.tsx` (append one assertion)

**Restyle (classes/markup only — keep ALL handlers, aria-labels, selectors, disabled logic):**
- The method/URL/Send row → `<div className="rm-urlbar">`; method `<select>` gets `rm-select rm-method-select` + a `methodClass(active.method)` class so the selected method is colored; URL input gets `rm-input rm-url-input`; Send button gets `rm-btn rm-btn--primary`.
- The sub-tab row → `<div className="rm-subtabs">` with each button `className={`rm-subtab ${sub===t?'is-active':''}`}`.
- The param/header `KeyValueTable`s → add `className="rm-kvtable"` to the `<table>`, a header row `<thead><tr><th></th><th>Key</th><th>Value</th></tr></thead>`, and `rm-kv-input` on the row inputs (keep placeholders + onChange).
- Save row and curl row: buttons `rm-btn` (Save → `rm-btn`, keep disabled logic); wrap each in `.rm-row` with `padding`.

- [ ] **Step 1: Write the failing test (append)**

```ts
it('colors the method select and marks the active sub-tab', () => {
  useStore.getState().updateActive({ method: 'DELETE' })
  render(<RequestPanel />)
  const sel = screen.getByLabelText('method')
  expect(sel.className).toContain('rm-method--DELETE')
  // params sub-tab active by default
  expect(document.querySelector('.rm-subtab.is-active')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/RequestPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Import `methodClass` (`../../method-color`). Apply the classes described above. Example for the method select:
```tsx
          <select className={`rm-select rm-method-select ${methodClass(active.method)}`} aria-label="method" value={active.method}
            onChange={(e) => update({ method: e.target.value as HttpMethod })}>
```
Example sub-tab row:
```tsx
      <div className="rm-subtabs">
        {(['params','headers','body','pre-request','tests'] as SubTab[]).map((t) => (
          <button key={t} className={`rm-subtab ${sub === t ? 'is-active' : ''}`} onClick={() => setSub(t)}>{t}</button>
        ))}
      </div>
```
(Apply `rm-urlbar`/`rm-url-input`/`rm-btn--primary` and the `rm-kvtable`/`rm-kv-input` classes to the respective elements. Do not change any behavior.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/RequestPanel.test.tsx && npx tsc --noEmit`
Expected: PASS (the existing RequestPanel tests still pass — selectors like `getByLabelText('method')`, `getByRole('button', {name:/send/i})`, placeholders are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/RequestPanel/RequestPanel.tsx test/webview/RequestPanel.test.tsx
git commit -m "feat(ui): restyle request panel — url bar, sub-tabs, colored method, kv tables"
```

---

## Task 4: ResponsePanel restyle

**Files:**
- Modify: `src/webview/components/ResponsePanel/ResponsePanel.tsx`
- Test: `test/webview/ResponsePanel.test.tsx` (append one assertion)

**Restyle:**
- Status line → `.rm-statusline`; the status becomes a `<span className={`rm-status-pill ${pillClass}`}>{status} {statusText}</span>` where `pillClass` is `is-2xx`/`is-3xx`/`is-4xx`/`is-5xx` by range (and `is-err` when `error` is set). Time/size wrapped in `.rm-meta`.
- Sub-tab row → `.rm-subtabs` with `.rm-subtab`/`is-active`.
- Test Results rows: the PASS/FAIL label becomes `<span className={`rm-badge ${t.passed?'is-pass':'is-fail'}`}>`.
- Body `<pre>`/console → `.rm-code`. Error banner → keep `role="alert"`, class `.rm-error-banner`.

Add a small pure helper inside the file: `function pillClass(status: number): string` returning `is-2xx`/`is-3xx`/`is-4xx`/`is-5xx` (default `is-5xx` for anything ≥500 or 0).

- [ ] **Step 1: Write the failing test (append)**

```ts
it('shows a status pill colored by range and PASS/FAIL badges', () => {
  useStore.getState().setResponse(activeId(), {
    status: 404, statusText: 'Not Found', headers: [], body: '{}', bodyTruncated: false, timeMs: 1, sizeBytes: 2, cookies: [],
    testResults: [{ name: 'x', passed: true }],
  })
  render(<ResponsePanel />)
  expect(document.querySelector('.rm-status-pill.is-4xx')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /test results/i }))
  expect(document.querySelector('.rm-badge.is-pass')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/ResponsePanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `pillClass` and apply the classes. Keep the existing text (`Status: ... Time: ... ms Size: ... B`) reachable — the tests assert `/200/`, `/42 ms/`, `/7 B/` etc.; keep those substrings (e.g. render `Time: {timeMs} ms` and `Size: {sizeBytes} B` inside `.rm-meta`, and the pill text `{status} {statusText}` — note the existing status test asserts `/200/` which the pill text still contains). Keep the error branch `role="alert"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/ResponsePanel.test.tsx && npx tsc --noEmit`
Expected: PASS (existing status/time/size, error-banner, truncation, and test-results/console tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/ResponsePanel/ResponsePanel.tsx test/webview/ResponsePanel.test.tsx
git commit -m "feat(ui): restyle response panel — status pill, sub-tabs, pass/fail badges"
```

---

## Task 5: Sidebar tree restyle

**Files:**
- Modify: `src/webview/components/Sidebar/Sidebar.tsx`
- Test: `test/webview/Sidebar.test.tsx` (append one assertion)

**Restyle:** the Collections header → `.rm-section` with a `.rm-section-title` "Collections" and action buttons (`New Request`/`Import`/`+ New`) as `.rm-btn--ghost`/`.rm-btn`; each collection row → `.rm-tree-row` with a `.rm-tree-caret` (▸/▾) + the name span; children in `.rm-tree-children`; each request row → `.rm-req-row` with a `<MethodBadge method={r.method}/>` + name; export/+Request buttons `.rm-btn--ghost`. Keep the collapse/expand state, all `aria-label`s (`export native for …`, `export postman for …`, `add request to …`), the `getByText('<name>')` name span, `New Request`, and all `postToHost` calls unchanged.

- [ ] **Step 1: Write the failing test (append)**

```ts
it('renders a method badge for a request row', () => {
  const request = { id: 'r1', name: 'Get Users', method: 'GET' as const, url: 'u', params: [], headers: [], body: { mode: 'none' as const } }
  useStore.getState().setTree([{ id: 'c1', name: 'My Coll', workspaceId: 'w1', requests: [request] }])
  render(<Sidebar />)
  fireEvent.click(screen.getByText('My Coll'))
  expect(document.querySelector('.rm-method--GET')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/Sidebar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Import `MethodBadge`. Apply the tree classes + method badge on request rows. Keep the request-open button behavior — the request row's clickable element must still contain the request name text node so `getByText('Get Users')` matches, and clicking it still posts `openRequest`. Example request row:
```tsx
                <div key={r.id} className="rm-req-row" onClick={() => postToHost({ type: 'openRequest', request: r })}>
                  <MethodBadge method={r.method} /> <span>{r.name}</span>
                </div>
```
(Keep the expand caret button carrying the collection name span so its `getByText` + toggle still work.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/Sidebar.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/Sidebar/Sidebar.tsx test/webview/Sidebar.test.tsx
git commit -m "feat(ui): restyle collection tree with rows, carets, method badges"
```

---

## Task 6: WorkspaceSwitcher / Environments / History restyle

**Files:**
- Modify: `src/webview/components/WorkspaceSwitcher/WorkspaceSwitcher.tsx`, `src/webview/components/Environments/Environments.tsx`, `src/webview/components/History/History.tsx`
- Test: existing tests must still pass (no new assertions required; add one History method-badge assertion).

**Restyle:** each becomes a `.rm-section` with a `.rm-section-title`; the workspace `<select>` gets `rm-select`; env list rows use `.rm-tree-row`/`.rm-btn--ghost`; the env variable table gets `.rm-kvtable`/`.rm-kv-input`; History rows use `.rm-req-row` with a `<MethodBadge method={e.request.method}/>` before the url. Keep all handlers, `aria-label`s (`active workspace`, `rename workspace`, `delete <name>`, etc.), and text (`getByText`/`getByRole` selectors) unchanged.

- [ ] **Step 1: Write the failing test (append to History test)**

Add to `test/webview/History.test.tsx`:
```ts
it('shows a method badge for a history entry', () => {
  const request = { id: 'r1', name: 'H', method: 'DELETE' as const, url: 'https://api/h', params: [], headers: [], body: { mode: 'none' as const } }
  useStore.getState().setHistory([{ id: 'h1', request, status: 200, at: 1 }])
  render(<History />)
  expect(document.querySelector('.rm-method--DELETE')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/History.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Apply the section/table/badge classes to the three components (import `MethodBadge` in History). Keep the History click posting `openRequest{request}` and the `{method} {url}` text reachable (the existing History test clicks `getByText('GET https://api/h')` — keep the url text; the badge is an additional element, so render `<MethodBadge/> <span>{e.request.method} {e.request.url}</span>` OR keep the button text `${method} ${url}` and add the badge separately — ensure `getByText('GET https://api/h')` still matches a single node).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/History.test.tsx test/webview/WorkspaceSwitcher.test.tsx test/webview/Environments.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/WorkspaceSwitcher src/webview/components/Environments src/webview/components/History test/webview/History.test.tsx
git commit -m "feat(ui): restyle workspace switcher, environments, history sections"
```

---

## Task 7: WebSocketPanel restyle

**Files:**
- Modify: `src/webview/components/WebSocket/WebSocketPanel.tsx`
- Test: `test/webview/WebSocketPanel.test.tsx` (append one assertion)

**Restyle:** wrap in `.rm-surface`; the URL row → `.rm-urlbar` (url `rm-input rm-url-input`, Connect `rm-btn rm-btn--primary`, Disconnect `rm-btn`, a status `<span className={`rm-status-pill ${wsStatus==='open'?'is-2xx':wsStatus==='connecting'?'is-4xx':'is-err'}`}>{wsStatus}</span>`); the headers table → `.rm-kvtable`/`.rm-kv-input`; the composer → `.rm-urlbar` (input `rm-input`, Send `rm-btn rm-btn--primary`); the log → `.rm-log` with each row `<div className={`rm-log-row is-${e.dir}`}><span className="rm-log-dir">{e.dir}</span><span>{e.data}</span></div>`. Keep all aria-labels (`websocket url`, `websocket message`, `ws header key N`, etc.), button names (`/^connect$/i`, `/^send$/i`, `/disconnect/i`), disabled logic, and handlers.

- [ ] **Step 1: Write the failing test (append)**

```ts
it('shows a status pill and colored log rows', () => {
  useStore.getState().wsStartConnect('c1'); useStore.getState().wsSetStatus('open')
  useStore.getState().wsAppendLog({ dir: 'in', data: 'hi', at: 1 })
  render(<WebSocketPanel />)
  expect(document.querySelector('.rm-status-pill.is-2xx')).toBeTruthy()
  expect(document.querySelector('.rm-log-row.is-in')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/webview/WebSocketPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Apply the classes described. Keep the headers-table aria-labels and all button/gating behavior unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/webview/WebSocketPanel.test.tsx && npx tsc --noEmit`
Expected: PASS (existing WS panel tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/webview/components/WebSocket/WebSocketPanel.tsx test/webview/WebSocketPanel.test.tsx
git commit -m "feat(ui): restyle websocket panel — url bar, status pill, colored log"
```

---

## Task 8: EditorApp + SidebarApp layout

**Files:**
- Modify: `src/webview/editor/EditorApp.tsx`, `src/webview/sidebar/SidebarApp.tsx`
- Test: existing EditorApp/SidebarApp tests must still pass (no new assertions required).

**Restyle:** EditorApp's outer container → `.rm-surface`; the top bar → `.rm-topbar` with the WebSocket toggle (`.rm-btn` + `.is-active` when `wsMode`), a `.rm-spacer`, and `<EnvDropdown/>` (rm-select) on the right. SidebarApp's outer container → a vertical `.rm-surface`-like column with `.rm-scroll`; each child section spaced via the section classes. Keep the toggle behavior (aria-pressed), the conditional body (`wsMode ? <WebSocketPanel/> : Tabs+RequestPanel+ResponsePanel`), and all mount/effect logic unchanged.

- [ ] **Step 1: Verify current tests + build baseline**

Run: `npx vitest run test/webview/EditorApp.test.tsx test/webview/SidebarApp.test.tsx`
Expected: PASS (baseline before restyle).

- [ ] **Step 2: Implement the layout classes**

Apply `.rm-surface`/`.rm-topbar`/`.rm-spacer`/`.rm-scroll` per above; keep the WebSocket toggle `aria-pressed={wsMode}` and the conditional body intact.

- [ ] **Step 3: Run tests + full suite + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests PASS; tsc clean; both bundles build.

- [ ] **Step 4: Commit**

```bash
git add src/webview/editor/EditorApp.tsx src/webview/sidebar/SidebarApp.tsx
git commit -m "feat(ui): restyle editor + sidebar app layout (surface, topbar)"
```

---

## Task 9: Manual smoke — visual pass

**Files:**
- Create: `docs/superpowers/plans/ui-design-smoke-checklist.md`

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 2: Write the checklist**

`docs/superpowers/plans/ui-design-smoke-checklist.md`:
```markdown
# UI Design Pass Smoke Checklist

Press F5 → open restman (sidebar) + a request (editor).

- [ ] Sidebar: workspace switcher, Collections/Environments/History as titled sections; collection rows have a caret + hover; request rows show a colored method badge.
- [ ] Editor tabs: active tab underlined with the accent; each tab shows a colored method badge + name; close × and + present.
- [ ] Request URL bar: colored method dropdown (GET green, POST yellow, DELETE red, …), full-width URL input, primary Send button.
- [ ] Sub-tabs (Params/Headers/Body/Pre-request/Tests) underline the active one; key/value tables have a header row and clean cell borders.
- [ ] Response: status pill colored by range (200 green, 404 yellow, 500 red); time/size muted; Test Results show green PASS / red FAIL badges; Console monospaced.
- [ ] WebSocket panel: status pill (open green / connecting yellow / closed red), colored log rows (in/out/status), headers table.
- [ ] Switch VS Code theme light↔dark → everything re-themes; no unreadable/hard-coded colors.
```

- [ ] **Step 3: Manually run it**

Press F5, follow the checklist. Fix visual issues before proceeding.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/ui-design-smoke-checklist.md
git commit -m "chore: ui design pass smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage:** design system + methodClass + MethodBadge (Task 1); tabs (2); request panel url bar/sub-tabs/colored method/kv tables (3); response status pill + badges (4); collection tree (5); workspace/env/history sections (6); websocket panel (7); app layouts (8); manual visual smoke (9).
- **No behavior change:** every task keeps handlers, aria-labels, selectors, and disabled logic; new assertions only check presence of the new classes; existing behavior tests remain unweakened. The old base classes (`.rm-row`/`.rm-btn`/`.rm-input`/`.rm-select`/`.rm-panel`) stay defined in theme.css so nothing that still uses them breaks.
- **Type consistency:** `methodClass(method: string): string` used by MethodBadge (1), RequestPanel (3), Tabs/tree/History via MethodBadge (2,5,6). Class names are consistent between theme.css definitions (1) and component usage (2-8).
- **Theme-adaptive:** all colors are `var(--vscode-*)`-backed custom properties; light/dark handled by VS Code; the theme.test asserts no hard-coded hex on body.
