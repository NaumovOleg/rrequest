---
"rrequest": patch
---

Fix a regression where one slow send/gRPC call could freeze the whole extension (webview dispatch was accidentally fully serialized, and an unhandled route error killed it permanently). Also: enable() no longer resets a workspace's poll/push mode, sync-state writes are now race-safe, HTTP responses with a huge declared Content-Length no longer get buffered fully into memory, and gRPC calls now time out instead of hanging forever.
