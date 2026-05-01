// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useWorkspaceRestore } from "./useWorkspaceRestore";

describe("useWorkspaceRestore", () => {
  it("restores connected hidden workspaces without loading their threads", async () => {
    const connectWorkspace = vi.fn(async () => {});
    const listThreadsForWorkspaces = vi.fn(async () => {});

    renderHook(() =>
      useWorkspaceRestore({
        workspaces: [
          {
            id: "ws-visible",
            name: "Visible Workspace",
            path: "/tmp/visible",
            connected: false,
            settings: { sidebarCollapsed: false },
          },
          {
            id: "ws-hidden",
            name: "Hidden Workspace",
            path: "/tmp/hidden",
            connected: false,
            settings: { sidebarCollapsed: false, hidden: true },
          },
        ],
        hasLoaded: true,
        connectWorkspace,
        listThreadsForWorkspaces,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(connectWorkspace).toHaveBeenCalledTimes(2);
    expect(listThreadsForWorkspaces).toHaveBeenCalledTimes(1);
    expect(listThreadsForWorkspaces).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "ws-visible" })],
      { maxPages: 6 },
    );
  });
});
