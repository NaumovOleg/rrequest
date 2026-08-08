# 07-04 Summary: No-code checks

## Done
- `test-compile.ts` — `compileChecks(rows)` → pm.test script with exact marker `// rrequest:checks {...}`; `parseChecks(text)` → rows | null (hand-written scripts untouched). Targets: status (`pm.response.code`), header (`.find` on headers array), JSON (dot-path helper incl. array indexes), time (`pm.response.responseTime`). Ops map to sandbox's `expect.to.equal` / `.to.be.above` / `.to.be.below`.
- `AssertPanel.tsx` — row table (target select / operator / expected value; header+json get a selector field too), add/remove rows.
- Tests sub-tab now has Checks/Script toggle; rows state parsed per active tab, recompiled into testScript on every change. Hand-written scripts still work in Script mode; switching modes never destroys data (checks win on next save, Script shows raw bytes).
- Tests: round-trip, sandbox PASS/FAIL wiring, missing-json-path fail.

## Verification
- 5 new tests, `yarn run typecheck` clean, RequestPanel test updated for the default Checks mode.