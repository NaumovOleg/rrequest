# Drive Sync Phase 2 — manual verification

Prereq: `server/` running with a real Google OAuth client (see `server/README.md`), Drive API enabled.

1. Start the backend: `cd server && npm run dev`.
2. In the Extension Development Host (F5), run **rrequest: Sign in to sync (Google)**. Complete Google consent. Expect an info message "signed in as <email>".
3. Select/activate a workspace with at least one collection and one environment (add a secret variable to the environment).
4. Run **rrequest: Enable sync for active workspace**. Expect "workspace sync enabled".
5. In Google Drive, confirm a folder `<hash>-rrequest/` exists containing `<workspaceId>-... .json`. Open it: collections present; the secret variable's value is `""`.
6. Change a request locally, run **rrequest: Sync now**, re-open the Drive file: the change is present.
7. Delete the local collection, run **rrequest: Sync now** (pull): the collection returns; the secret variable's value is still blank in the file but your local secret value is preserved locally.
