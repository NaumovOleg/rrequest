# 07-03 Summary: Code snippets

## Done
- `src/webview/codegen.ts` — pure generators:
  - `toCurlString` — `--request`/`--header`/`--data`, shell-quoted with `'\''` escaping.
  - `toJsFetch` — fetch call with headers object + body.
  - `toPythonRequests` — `json=` kwarg when the raw body parses as JSON, otherwise `data=`, `timeout=30` dropped for simplicity (kept minimal).
  - `toGoHttp` — `http.NewRequest` + `io.ReadAll` + `fmt.Println` round trip.
  - Form-data with files → returns a comment explaining why it can't generate (download/upload asymmetry), never a broken command.
- RequestPanel "Code" sub-tab: language select (cURL / JS / Python / Go) + Copy button with toast.
- Tests: `test/webview/codegen.test.ts` — curl escaping, header/body mapping, JSON-detect for python, generateCode dispatch, file guards.

## Verification
- 7 new tests pass, full suite green, typecheck clean.