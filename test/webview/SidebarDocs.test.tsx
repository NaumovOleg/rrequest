import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useStore } from "../../src/webview/state/store";
const posted: any[] = [];
vi.mock("../../src/webview/ipc", () => ({
  postToHost: (m: any) => posted.push(m),
  onHostMessage: () => () => {},
  getUiState: (k: string, fb: any) =>
    k === "expandedCollections" ? ["c1"] : fb,
  setUiState: () => {},
}));
import { Sidebar } from "../../src/webview/views/Sidebar/Sidebar";
import { defaultHeaders } from "../../src/shared/types";

beforeEach(() => {
  useStore.getState().__reset();
  posted.length = 0;
});

function seed(description?: string) {
  useStore.getState().setTree([
    {
      id: "c1",
      name: "API",
      workspaceId: "w1",
      requests: [
        {
          id: "r1",
          name: "Get User",
          method: "GET",
          url: "",
          params: [],
          headers: defaultHeaders(),
          cookies: [],
          body: { mode: "none" },
          preRequestScript: "",
          testScript: "",
          description,
        },
      ],
    },
  ]);
}

describe("Sidebar request docs", () => {
  it("shows a book indicator only when the request has docs", () => {
    seed("# Docs");
    const { unmount } = render(<Sidebar />);
    expect(document.querySelector(".rm-script-dot")).toBeTruthy();
    unmount();
    seed();
    render(<Sidebar />);
    expect(document.querySelector(".rm-script-dot")).toBeNull();
  });

  it("the hover book button opens the docs modal and saves via saveRequest", () => {
    seed("# Docs");
    render(<Sidebar />);
    fireEvent.click(
      screen.getByRole("button", { name: "request docs for Get User" })
    );
    const ta = screen.getByLabelText(
      "description (markdown)"
    ) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "updated docs" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "saveRequest",
        collectionId: "c1",
        folderId: null,
        request: expect.objectContaining({
          id: "r1",
          description: "updated docs",
        }),
      })
    );
  });
});
