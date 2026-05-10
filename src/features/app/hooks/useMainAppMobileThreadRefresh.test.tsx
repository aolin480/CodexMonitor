// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMainAppMobileThreadRefresh } from "./useMainAppMobileThreadRefresh";

const workspace = {
  id: "ws-1",
  name: "Workspace",
  path: "/tmp/ws-1",
  connected: true,
  settings: { sidebarCollapsed: false },
};

describe("useMainAppMobileThreadRefresh", () => {
  it("force-refreshes the active thread before reconnecting live", async () => {
    const refreshThread = vi.fn().mockResolvedValue(undefined);
    const reconnectLive = vi.fn().mockResolvedValue(true);
    const startThreadForWorkspace = vi.fn().mockResolvedValue("new-thread");

    const { result } = renderHook(() =>
      useMainAppMobileThreadRefresh({
        activeWorkspace: workspace,
        activeThreadId: "thread-1",
        startThreadForWorkspace,
        refreshThread,
        reconnectLive,
      }),
    );

    await act(async () => {
      result.current.handleMobileThreadRefresh();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(refreshThread).toHaveBeenCalledTimes(1);
    expect(refreshThread).toHaveBeenCalledWith("ws-1", "thread-1");
    expect(reconnectLive).toHaveBeenCalledTimes(1);
    expect(reconnectLive).toHaveBeenCalledWith("ws-1", "thread-1", {
      runResume: false,
    });
    expect(refreshThread.mock.invocationCallOrder[0]).toBeLessThan(
      reconnectLive.mock.invocationCallOrder[0],
    );
  });

  it("starts a thread, refreshes it, then reconnects live when none is active", async () => {
    const refreshThread = vi.fn().mockResolvedValue(undefined);
    const reconnectLive = vi.fn().mockResolvedValue(true);
    const startThreadForWorkspace = vi.fn().mockResolvedValue("new-thread");

    const { result } = renderHook(() =>
      useMainAppMobileThreadRefresh({
        activeWorkspace: workspace,
        activeThreadId: null,
        startThreadForWorkspace,
        refreshThread,
        reconnectLive,
      }),
    );

    await act(async () => {
      result.current.handleMobileThreadRefresh();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      activate: true,
    });
    expect(refreshThread).toHaveBeenCalledWith("ws-1", "new-thread");
    expect(reconnectLive).toHaveBeenCalledWith("ws-1", "new-thread", {
      runResume: false,
    });
  });
});
