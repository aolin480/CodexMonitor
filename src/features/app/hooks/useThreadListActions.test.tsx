// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkspaceInfo } from "../../../types";
import { useThreadListActions } from "./useThreadListActions";

function workspace(id: string, connected: boolean, hidden = false): WorkspaceInfo {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    connected,
    settings: { sidebarCollapsed: false, hidden },
  };
}

describe("useThreadListActions", () => {
  it("refreshes workspaces before reloading connected workspace threads", async () => {
    const stale = [workspace("stale", true)];
    const fresh = [
      workspace("one", true),
      workspace("two", false),
      workspace("three", true, true),
      workspace("four", true),
    ];
    const refreshWorkspaces = vi.fn(async () => fresh);
    const listThreadsForWorkspaces = vi.fn(async () => {});
    const resetWorkspaceThreads = vi.fn();

    const { result } = renderHook(() =>
      useThreadListActions({
        threadListSortKey: "updated_at",
        setThreadListSortKey: vi.fn(),
        workspaces: stale,
        refreshWorkspaces,
        listThreadsForWorkspaces,
        resetWorkspaceThreads,
      }),
    );

    await act(async () => {
      await result.current.handleRefreshAllWorkspaceThreads();
    });

    expect(refreshWorkspaces).toHaveBeenCalledTimes(1);
    expect(resetWorkspaceThreads).toHaveBeenCalledTimes(2);
    expect(resetWorkspaceThreads).toHaveBeenNthCalledWith(1, "one");
    expect(resetWorkspaceThreads).toHaveBeenNthCalledWith(2, "four");
    expect(listThreadsForWorkspaces).toHaveBeenCalledTimes(1);
    expect(listThreadsForWorkspaces).toHaveBeenCalledWith([fresh[0], fresh[3]]);
  });

  it("falls back to current workspaces when refresh fails", async () => {
    const current = [workspace("one", true), workspace("two", false, true)];
    const refreshWorkspaces = vi.fn(async () => undefined);
    const listThreadsForWorkspaces = vi.fn(async () => {});
    const resetWorkspaceThreads = vi.fn();

    const { result } = renderHook(() =>
      useThreadListActions({
        threadListSortKey: "updated_at",
        setThreadListSortKey: vi.fn(),
        workspaces: current,
        refreshWorkspaces,
        listThreadsForWorkspaces,
        resetWorkspaceThreads,
      }),
    );

    await act(async () => {
      await result.current.handleRefreshAllWorkspaceThreads();
    });

    expect(refreshWorkspaces).toHaveBeenCalledTimes(1);
    expect(resetWorkspaceThreads).toHaveBeenCalledTimes(1);
    expect(resetWorkspaceThreads).toHaveBeenCalledWith("one");
    expect(listThreadsForWorkspaces).toHaveBeenCalledTimes(1);
    expect(listThreadsForWorkspaces).toHaveBeenCalledWith([current[0]]);
  });
});
