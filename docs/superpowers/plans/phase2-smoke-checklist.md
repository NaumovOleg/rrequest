# Phase 2 Smoke Checklist

Press F5 → in the dev host, open restman (activity-bar icon or "restman: Open").

- [ ] Sidebar shows an Environments section; "New Environment" creates one.
- [ ] Editing an environment: add a variable `base = https://postman-echo.com`, Save.
- [ ] The top-bar environment dropdown lists the new environment; select it.
- [ ] In a request, set URL to `{{base}}/get` and Send → resolves to https://postman-echo.com/get, 200.
- [ ] Add a header `Authorization: Bearer {{token}}` with `token=abc` in the env → echoed response shows `Bearer abc`.
- [ ] An unknown `{{missing}}` in the URL is sent literally (echo shows `{{missing}}`).
- [ ] Switch the dropdown to "No Environment" → `{{base}}` is sent literally.
- [ ] Delete the active environment → dropdown falls back to "No Environment".
- [ ] Reopen the panel (hide/show) → the previously active environment is still selected (globalState persistence).
