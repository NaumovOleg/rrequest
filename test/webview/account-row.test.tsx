import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { AccountsPanel } from "../../src/webview/views/AccountsPanel/AccountsPanel";
import { useStore } from "../../src/webview/state/store";
import * as ipc from "../../src/webview/ipc";

beforeEach(() => useStore.getState().__reset());

describe("AccountsPanel", () => {
  it("signed out → Add account posts signIn", () => {
    const post = vi.spyOn(ipc, "postToHost").mockImplementation(() => {});
    useStore.getState().setAccounts([]);
    render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /switch account/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /sign in to sync|add account/i })
    );
    expect(post).toHaveBeenCalledWith({ type: "signIn" });
  });

  it("shows each account with a sign-out that carries its id", () => {
    const post = vi.spyOn(ipc, "postToHost").mockImplementation(() => {});
    useStore.getState().setAccounts([{ id: "a1", email: "me@x.com" }]);
    render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /switch account/i }));
    expect(screen.getByText("me@x.com")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /sign out me@x\.com/i })
    );
    expect(post).toHaveBeenCalledWith({ type: "signOut", accountId: "a1" });
  });

  it("nests each account's workspaces under it and selects on click", () => {
    const post = vi.spyOn(ipc, "postToHost").mockImplementation(() => {});
    useStore.getState().setAccounts([{ id: "a1", email: "me@x.com" }]);
    useStore.getState().setWorkspaces(
      [
        {
          id: "w1",
          name: "Owned",
          role: "owner",
          synced: true,
          accountId: "a1",
        },
        { id: "wl", name: "LocalWs" },
      ],
      "w1"
    );
    render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /switch account/i }));
    // both the account's synced workspace and the local one are listed in the popup
    expect(screen.getByRole("button", { name: "LocalWs" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Owned" }));
    expect(post).toHaveBeenCalledWith({ type: "setActiveWorkspace", id: "w1" });
  });

  it('per-account "New workspace" creates a workspace bound to that account', () => {
    const post = vi.spyOn(ipc, "postToHost").mockImplementation(() => {});
    useStore.getState().setAccounts([{ id: "a1", email: "me@x.com" }]);
    render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /switch account/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /new workspace in me@x\.com/i })
    );
    // inline name row appears; type a name and press Enter to create
    const input = screen.getByRole("textbox", { name: /new workspace name/i });
    fireEvent.change(input, { target: { value: "My Cloud" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(post).toHaveBeenCalledWith({
      type: "createWorkspace",
      name: "My Cloud",
      accountId: "a1",
    });
  });

  it("inline create cancels with Escape and creates nothing", () => {
    const post = vi.spyOn(ipc, "postToHost").mockImplementation(() => {});
    useStore.getState().setAccounts([]);
    render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /switch account/i }));
    fireEvent.click(screen.getByRole("button", { name: /new workspace/i }));
    const input = screen.getByRole("textbox", { name: /new workspace name/i });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "createWorkspace" })
    );
    expect(
      screen.queryByRole("textbox", { name: /new workspace name/i })
    ).toBeNull();
  });

  it("a local workspace can be synced to the single connected account", () => {
    const post = vi.spyOn(ipc, "postToHost").mockImplementation(() => {});
    useStore.getState().setAccounts([{ id: "a1", email: "me@x.com" }]);
    useStore.getState().setWorkspaces([{ id: "wl", name: "LocalWs" }], "wl");
    render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /switch account/i }));
    const localRow = screen
      .getByRole("button", { name: "LocalWs" })
      .closest(".rm-acct-ws") as HTMLElement;
    fireEvent.click(
      within(localRow).getByRole("button", { name: /sync .*to me@x\.com/i })
    );
    expect(post).toHaveBeenCalledWith({
      type: "enableSync",
      workspaceId: "wl",
      accountId: "a1",
    });
    // rename + delete stay
    expect(
      within(localRow).getByRole("button", { name: /rename/i })
    ).toBeTruthy();
  });

  it("with several accounts a local workspace offers a picker, and enables for the chosen one", () => {
    const post = vi.spyOn(ipc, "postToHost").mockImplementation(() => {});
    useStore.getState().setAccounts([
      { id: "a1", email: "one@x.com" },
      { id: "a2", email: "two@x.com" },
    ]);
    useStore.getState().setWorkspaces([{ id: "wl", name: "LocalWs" }], "wl");
    render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /switch account/i }));
    const localRow = screen
      .getByRole("button", { name: "LocalWs" })
      .closest(".rm-acct-ws") as HTMLElement;
    fireEvent.click(
      within(localRow).getByRole("button", { name: /sync .*to an account/i })
    );
    fireEvent.click(within(localRow).getByText("two@x.com"));
    expect(post).toHaveBeenCalledWith({
      type: "enableSync",
      workspaceId: "wl",
      accountId: "a2",
    });
  });

  it("signed out, a local workspace offers no sync control at all", () => {
    useStore.getState().setAccounts([]);
    useStore.getState().setWorkspaces([{ id: "wl", name: "LocalWs" }], "wl");
    render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /switch account/i }));
    const localRow = screen
      .getByRole("button", { name: "LocalWs" })
      .closest(".rm-acct-ws") as HTMLElement;
    expect(
      within(localRow).queryByRole("button", { name: /sync/i })
    ).toBeNull();
  });

  it("a workspace under an account that never finished enabling offers a retry", () => {
    const post = vi.spyOn(ipc, "postToHost").mockImplementation(() => {});
    useStore.getState().setAccounts([{ id: "a1", email: "me@x.com" }]);
    useStore.getState().setWorkspaces(
      [
        {
          id: "w1",
          name: "Stuck",
          accountId: "a1",
          synced: false,
          role: "owner",
        },
      ],
      "w1"
    );
    render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /switch account/i }));
    const row = screen
      .getByRole("button", { name: "Stuck" })
      .closest(".rm-acct-ws") as HTMLElement;
    fireEvent.click(
      within(row).getByRole("button", { name: /sync .*to me@x\.com/i })
    );
    expect(post).toHaveBeenCalledWith({
      type: "enableSync",
      workspaceId: "w1",
      accountId: "a1",
    });
  });

  it("a workspace-scoped sync spins only that workspace's row", () => {
    const post = vi.spyOn(ipc, "postToHost").mockImplementation(() => {});
    useStore.getState().setAccounts([{ id: "a1", email: "me@x.com" }]);
    useStore.getState().setWorkspaces(
      [
        {
          id: "w1",
          name: "First",
          role: "owner",
          synced: true,
          accountId: "a1",
        },
        {
          id: "w2",
          name: "Second",
          role: "owner",
          synced: true,
          accountId: "a1",
        },
      ],
      "w1"
    );
    render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /switch account/i }));
    const spinnerIcon = () =>
      document.querySelectorAll(".codicon.rm-spin").length;
    const row1 = screen
      .getByRole("button", { name: "First" })
      .closest(".rm-acct-ws") as HTMLElement;
    // clicking the workspace posts the scoped syncNow
    fireEvent.click(within(row1).getByRole("button", { name: "Sync now" }));
    expect(post).toHaveBeenCalledWith({ type: "syncNow", workspaceId: "w1" });
    act(() =>
      useStore.getState().setSyncLoading({ kind: "workspace", id: "w1" })
    );
    expect(spinnerIcon()).toBe(1);
    expect(
      within(row1).getByRole("button", { name: "Sync now" })
    ).toBeDisabled();
    // the sibling workspace and the account head are untouched
    const row2 = screen
      .getByRole("button", { name: "Second" })
      .closest(".rm-acct-ws") as HTMLElement;
    expect(
      within(row2).getByRole("button", { name: "Sync now" })
    ).toBeEnabled();
  });

  it("an account-scoped sync spins the account head and all its workspaces", () => {
    useStore.getState().setAccounts([
      { id: "a1", email: "one@x.com" },
      { id: "a2", email: "two@x.com" },
    ]);
    useStore.getState().setWorkspaces(
      [
        {
          id: "w1",
          name: "OneWs",
          role: "owner",
          synced: true,
          accountId: "a1",
        },
        {
          id: "w2",
          name: "TwoWs",
          role: "owner",
          synced: true,
          accountId: "a2",
        },
      ],
      "w1"
    );
    render(<AccountsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /switch account/i }));
    act(() =>
      useStore.getState().setSyncLoading({ kind: "account", id: "a1" })
    );
    const spinnerIcon = () =>
      document.querySelectorAll(".codicon.rm-spin").length;
    // account head + its one workspace spin, the other account doesn't
    expect(spinnerIcon()).toBe(2);
    const twoRow = screen
      .getByRole("button", { name: "TwoWs" })
      .closest(".rm-acct-ws") as HTMLElement;
    expect(
      within(twoRow).getByRole("button", { name: "Sync now" })
    ).toBeEnabled();
  });

  it("a global sync spins the trigger avatar and every sync button", () => {
    useStore.getState().setAccounts([{ id: "a1", email: "me@x.com" }]);
    useStore.getState().setWorkspaces(
      [
        {
          id: "w1",
          name: "Ws",
          role: "owner",
          synced: true,
          accountId: "a1",
        },
      ],
      "w1"
    );
    render(<AccountsPanel />);
    act(() => useStore.getState().setSyncLoading({ kind: "all" }));
    fireEvent.click(screen.getByRole("button", { name: /switch account/i }));
    const spinnerIcon = () =>
      document.querySelectorAll(".codicon.rm-spin").length;
    // trigger avatar + account head + workspace row
    expect(spinnerIcon()).toBe(3);
  });
});
