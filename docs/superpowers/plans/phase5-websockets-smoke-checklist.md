# Phase 5 WebSockets Smoke Checklist

Press F5 → open restman → in the editor top bar, click "WebSocket".

- [ ] The WebSocket panel shows: URL input, Connect button, message composer, log.
- [ ] Connect to `wss://echo.websocket.org` (or `wss://ws.postman-echo.com/raw`) → status becomes "open"; a "connected" status entry appears.
- [ ] Type a message + Send → an "out" entry appears; the echo server's reply appears as an "in" entry.
- [ ] Disconnect → status "closed"; a "closed" status entry appears.
- [ ] Connect to a bad url (`wss://nope.invalid`) → an "error"/"closed" status entry appears; the app does not crash.
- [ ] Toggle "WebSocket" off → the HTTP request editor returns; toggle on → the WS panel + its log are still there.
- [ ] Custom header: add a header in the WS panel (if the headers UI is present) and connect to an echo that reflects headers → the header is sent on the handshake.
