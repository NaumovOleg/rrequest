# 08-02 SUMMARY — Variables & secrets & timeout

Done:
- **WS/gRPC interpolation**: `wsConnect` and `grpcInvoke` now run the active
  env's `{{vars}}` through interpolate (url+headers for WS; address, proto,
  service, method, metadata for gRPC). HTTP already did this — parity closed.
  Message body for gRPC stays literal (data, not config) — deliberate.
- **Env secrets at rest**: `EnvironmentStore` takes an optional `SecretsPort`;
  secret-flagged values are stored in VS Code Secret Storage
  (`rrequest.env.<envId>.<key>`) and blanked in the JSON file, hydrated back
  on `list()`. Works with existing sync stripping — sync never saw them, now
  disk doesn't either.
  ponytail: orphaned vault keys on env delete/rename are not purged
  (SecretStorage has no bucket scan); harmless but noted.
- **Timeout**: `rrequest.requestTimeoutMs` setting (default 30000, min 1000)
  plumbed createRouter -> deps.send opts.timeoutMs.

Tests: 3 new (grpc interpolation, ws interpolation, timeout pass-through).
528 total green, tsc clean, build green.