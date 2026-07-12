# Phase 4 Scripts Smoke Checklist

Press F5 → open restman → open a request in the editor.

- [ ] Pre-request Script tab: `pm.environment.set('ts', String(Date.now()))` with an active environment → Send → the env variable `ts` updates in the sidebar Environments editor.
- [ ] Pre-request mutation: `pm.request.headers.add({ key: 'X-Test', value: '1' })` → Send to https://postman-echo.com/get → the echoed headers include X-Test.
- [ ] Pre-request sets a var used in the URL: env `base`, script `pm.environment.set('base','https://postman-echo.com')`, URL `{{base}}/get` → resolves and 200.
- [ ] Tests tab: `pm.test('status is 200', () => pm.expect(pm.response.code).to.equal(200))` → Send → Response → Test Results shows PASS.
- [ ] A failing test: `pm.test('bad', () => pm.expect(pm.response.code).to.equal(500))` → Test Results shows FAIL with the message.
- [ ] `pm.response.json()` in a test reads the body; `console.log('hi', pm.response.code)` → Console tab shows the line.
- [ ] A script `throw new Error('x')` → Console shows the error; the app does not crash.
- [ ] The saved request still shows the raw `{{var}}`/unmutated values after sending.
