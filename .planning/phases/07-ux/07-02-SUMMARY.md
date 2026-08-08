# 07-02 Summary: Repeat last request

## Done
- `store.lastSent` — deep copy (`structuredClone`) of the exact payload sent (base URL without query string; params re-appended on send, matching `send()`), set immediately before `postToHost(sendRequest)`, untouched by cancels.
- ResponsePanel:
  - "↻ Repeat" button in the status line (shown when `lastSent != null`).
  - "Repeat last" action on the blank state ("No response yet").
- Repeat opens the payload in a fresh tab (`openOrReplaceBlank`), marks it in-flight, re-sends, and updates `lastSent` so repeated repeats work.

## Notes
- History.tsx was listed in the plan but has no re-run affordance today; the response header is the natural home, so no History change was needed.
- Works across tab switches because the store keeps the payload independent of the active tab.

## Verification
- `yarn test` green (existing suite), typecheck clean.