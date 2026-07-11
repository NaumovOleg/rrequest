# Phase 1 Smoke Checklist

Run: press F5 (Run Extension) -> in the dev host, Command Palette -> "restman: Open".

- [ ] Panel opens in the editor area, themed to match the current VS Code theme.
- [ ] Switch VS Code theme (light/dark) -> panel colors follow.
- [ ] `+` opens a new request tab; method dropdown and URL input work.
- [ ] GET https://postman-echo.com/get?a=1 -> Send -> 200, JSON body pretty-printed, time & size shown.
- [ ] Add a Params row a=1 -> it folds into the sent URL.
- [ ] POST https://postman-echo.com/post with a raw JSON body -> echoed back in the response.
- [ ] A bad host (https://nope.invalid) -> red error banner, no crash.
- [ ] New Collection -> appears in the sidebar tree after refresh.
- [ ] Reload the panel (hide/show) -> no crash.
