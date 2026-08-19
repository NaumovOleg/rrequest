import { describe, it, expect, vi } from "vitest";
import {
  folderNameForUser,
  legacyFolderNameForUser,
  resolveSyncFolder,
  getAccessTokenWithRetry,
  isRevokedTokenError,
  DriveAuthError,
} from "../../../server/src/domain/drive-factory";
import { FakeDriveClient } from "../../../server/src/domain/drive-client";
import type { User } from "../../../server/src/stores/types";

const user: User = { id: "user-123", email: "a@x.com", googleSub: "sub-abc", refreshToken: "rt" };

function gaxios(status: number | undefined, error?: string): Error {
  const e = new Error(`http ${status}`) as Error & { response?: unknown };
  e.response = status === undefined ? undefined : { status, data: { error } };
  return e;
}

describe("folderNameForUser", () => {
  it("is stable per googleSub and ends with -rrequest", () => {
    const a = folderNameForUser("sub-abc");
    expect(a).toMatch(/^[0-9a-f]{8}-rrequest$/);
    expect(folderNameForUser("sub-abc")).toBe(a);
    expect(folderNameForUser("sub-xyz")).not.toBe(a);
  });
});

describe("resolveSyncFolder", () => {
  it("reuses the static sub-based folder when it already exists", async () => {
    const drive = new FakeDriveClient();
    await drive.ensureFolder(folderNameForUser(user.googleSub));
    await drive.ensureFolder(legacyFolderNameForUser(user.id));
    const id = await resolveSyncFolder(drive, user);
    // FakeDriveClient maps folder name -> id `folder-<name>`; the sub folder
    // must win over the legacy one.
    expect(id).toBe(`folder-${folderNameForUser(user.googleSub)}`);
  });

  it("migrates: falls back to the legacy user-id folder so old files stay reachable", async () => {
    const drive = new FakeDriveClient();
    await drive.ensureFolder(legacyFolderNameForUser(user.id));
    const id = await resolveSyncFolder(drive, user);
    expect(id).toBe(`folder-${legacyFolderNameForUser(user.id)}`);
  });

  it("creates the static sub-based folder when neither exists, and is idempotent", async () => {
    const drive = new FakeDriveClient();
    const a = await resolveSyncFolder(drive, user);
    expect(a).toBe(`folder-${folderNameForUser(user.googleSub)}`);
    expect(await resolveSyncFolder(drive, user)).toBe(a);
  });
});

describe("isRevokedTokenError", () => {
  it("classifies invalid_grant as revoked, everything transient as not", () => {
    expect(isRevokedTokenError(gaxios(400, "invalid_grant"))).toBe(true);
    expect(isRevokedTokenError(gaxios(400, "invalid_client"))).toBe(false);
    expect(isRevokedTokenError(gaxios(429))).toBe(false);
    expect(isRevokedTokenError(gaxios(500))).toBe(false);
    expect(isRevokedTokenError(new Error("ECONNRESET"))).toBe(false);
  });
});

describe("getAccessTokenWithRetry", () => {
  it("succeeds after transient failures (retried, not treated as revoked)", async () => {
    const refresh = vi
      .fn(() => Promise.resolve({ token: "tok" }))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(gaxios(429));
    await expect(getAccessTokenWithRetry(refresh, { sleep: () => Promise.resolve() })).resolves.toBe("tok");
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("fails fast on invalid_grant without retrying", async () => {
    const refresh = vi.fn().mockRejectedValue(gaxios(400, "invalid_grant"));
    await expect(getAccessTokenWithRetry(refresh)).rejects.toBeInstanceOf(DriveAuthError);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("throws DriveAuthError once retries are exhausted on a persistent transient error", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(
      getAccessTokenWithRetry(refresh, { maxAttempts: 2, sleep: () => Promise.resolve() }),
    ).rejects.toBeInstanceOf(DriveAuthError);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
