// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { subscribeAppServerEvents } from "@services/events";
import {
  getCodexConfigPath,
  listMcpServerStatus,
  mcpServerOAuthLogin,
  readGlobalMcpConfigSummary,
} from "@services/tauri";
import type { AppServerEvent } from "../../../types";
import { useMcpServerStatus } from "./useMcpServerStatus";

vi.mock("@services/tauri", () => ({
  getCodexConfigPath: vi.fn(),
  listMcpServerStatus: vi.fn(),
  mcpServerOAuthLogin: vi.fn(),
  readGlobalMcpConfigSummary: vi.fn(),
}));

vi.mock("@services/events", () => ({
  subscribeAppServerEvents: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const getCodexConfigPathMock = vi.mocked(getCodexConfigPath);
const listMcpServerStatusMock = vi.mocked(listMcpServerStatus);
const mcpServerOAuthLoginMock = vi.mocked(mcpServerOAuthLogin);
const readGlobalMcpConfigSummaryMock = vi.mocked(readGlobalMcpConfigSummary);
const subscribeAppServerEventsMock = vi.mocked(subscribeAppServerEvents);
const openUrlMock = vi.mocked(openUrl);

describe("useMcpServerStatus", () => {
  let listener: ((event: AppServerEvent) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    listener = null;
    getCodexConfigPathMock.mockResolvedValue("/Users/me/.codex/config.toml");
    readGlobalMcpConfigSummaryMock.mockResolvedValue({
      configuredServerNames: [],
      startupTimeoutsMs: {},
    });
    mcpServerOAuthLoginMock.mockResolvedValue({
      authUrl: "https://example.com/oauth",
    });
    subscribeAppServerEventsMock.mockImplementation((cb) => {
      listener = cb;
      return () => {};
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads and normalizes MCP status for the active workspace", async () => {
    readGlobalMcpConfigSummaryMock.mockResolvedValue({
      configuredServerNames: ["filesystem"],
      startupTimeoutsMs: {},
    });

    listMcpServerStatusMock.mockResolvedValue({
      result: {
        data: [
          {
            name: "filesystem",
            authStatus: "connected",
            tools: {
              mcp__filesystem__read: {},
              mcp__filesystem__write: {},
            },
            resources: [],
            resourceTemplates: [{ id: 1 }],
          },
        ],
      },
    } as Awaited<ReturnType<typeof listMcpServerStatus>>);

    const { result } = renderHook(() => useMcpServerStatus("workspace-1"));

    await waitFor(() => {
      expect(listMcpServerStatusMock).toHaveBeenCalledWith(
        "workspace-1",
        null,
        null,
      );
      expect(result.current.totalServers).toBe(1);
      expect(result.current.totalTools).toBe(2);
      expect(result.current.configPath).toBe("/Users/me/.codex/config.toml");
      expect(result.current.servers[0]).toEqual(
        expect.objectContaining({
          name: "filesystem",
          hasMatchingConfigBlock: true,
          startupPhase: "ready",
          authStatus: "connected",
          toolNames: ["read", "write"],
          templateCount: 1,
        }),
      );
    });
  });

  it("resets to empty state when workspace is unavailable", async () => {
    const { result } = renderHook(() => useMcpServerStatus(null));

    await waitFor(() => {
      expect(listMcpServerStatusMock).not.toHaveBeenCalled();
      expect(result.current.totalServers).toBe(0);
      expect(result.current.totalTools).toBe(0);
      expect(result.current.configPath).toBeNull();
    });
  });

  it("ignores stale workspace responses and loads MCP status for the latest workspace", async () => {
    let resolveWorkspaceOne:
      | ((value: Awaited<ReturnType<typeof listMcpServerStatus>>) => void)
      | null = null;

    listMcpServerStatusMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveWorkspaceOne = resolve;
          }),
      )
      .mockResolvedValueOnce({
        result: {
          data: [
            {
              name: "workspace_two_server",
              tools: {
                mcp__workspace_two_server__ping: {},
              },
            },
          ],
        },
      } as Awaited<ReturnType<typeof listMcpServerStatus>>);

    const { result, rerender } = renderHook(
      ({ currentWorkspaceId }) => useMcpServerStatus(currentWorkspaceId),
      {
        initialProps: {
          currentWorkspaceId: "workspace-1" as string | null,
        },
      },
    );

    rerender({ currentWorkspaceId: "workspace-2" });

    await waitFor(() => {
      expect(listMcpServerStatusMock).toHaveBeenNthCalledWith(
        1,
        "workspace-1",
        null,
        null,
      );
      expect(listMcpServerStatusMock).toHaveBeenNthCalledWith(
        2,
        "workspace-2",
        null,
        null,
      );
      expect(result.current.totalServers).toBe(1);
      expect(result.current.servers[0]?.name).toBe("workspace_two_server");
    });

    await act(async () => {
      resolveWorkspaceOne?.({
        result: {
          data: [
            {
              name: "workspace_one_server",
              tools: {
                mcp__workspace_one_server__ping: {},
              },
            },
          ],
        },
      } as Awaited<ReturnType<typeof listMcpServerStatus>>);
      await Promise.resolve();
    });

    expect(result.current.totalServers).toBe(1);
    expect(result.current.servers[0]?.name).toBe("workspace_two_server");
  });

  it("clears stale MCP rows when the hook is disabled", async () => {
    listMcpServerStatusMock.mockResolvedValue({
      result: {
        data: [
          {
            name: "filesystem",
            tools: {
              mcp__filesystem__read: {},
            },
          },
        ],
      },
    } as Awaited<ReturnType<typeof listMcpServerStatus>>);

    const { result, rerender } = renderHook(
      ({ currentWorkspaceId, currentEnabled }) =>
        useMcpServerStatus(currentWorkspaceId, currentEnabled),
      {
        initialProps: {
          currentWorkspaceId: "workspace-1" as string | null,
          currentEnabled: true,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.totalServers).toBe(1);
    });

    rerender({
      currentWorkspaceId: "workspace-1",
      currentEnabled: false,
    });

    await waitFor(() => {
      expect(result.current.totalServers).toBe(0);
      expect(result.current.totalTools).toBe(0);
      expect(result.current.servers).toEqual([]);
      expect(result.current.configPath).toBeNull();
    });
  });

  it("starts MCP OAuth login and refreshes after completion", async () => {
    listMcpServerStatusMock
      .mockResolvedValueOnce({
        result: {
          data: [
            {
              name: "figma_mcp",
              authStatus: "notLoggedIn",
              tools: {},
            },
          ],
        },
      } as Awaited<ReturnType<typeof listMcpServerStatus>>)
      .mockResolvedValueOnce({
        result: {
          data: [
            {
              name: "figma_mcp",
              authStatus: "oAuth",
              tools: {
                mcp__figma_mcp__get_file: {},
              },
            },
          ],
        },
      } as Awaited<ReturnType<typeof listMcpServerStatus>>);

    const { result } = renderHook(() => useMcpServerStatus("workspace-1"));

    await waitFor(() => {
      expect(result.current.servers[0]?.authStatusCode).toBe("notLoggedIn");
      expect(result.current.servers[0]?.startupPhase).toBe("needsAuth");
    });

    await act(async () => {
      await result.current.startOAuthLogin("figma_mcp");
    });

    expect(mcpServerOAuthLoginMock).toHaveBeenCalledWith("workspace-1", "figma_mcp");
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com/oauth");
    expect(result.current.authenticatingServerName).toBe("figma_mcp");

    act(() => {
      listener?.({
        workspace_id: "workspace-1",
        message: {
          method: "mcpServer/oauthLogin/completed",
          params: {
            name: "figma_mcp",
            success: true,
          },
        },
      });
    });

    await waitFor(() => {
      expect(listMcpServerStatusMock).toHaveBeenCalledTimes(2);
      expect(result.current.authenticatingServerName).toBeNull();
      expect(result.current.servers[0]?.authStatusCode).toBe("oAuth");
      expect(result.current.servers[0]?.startupPhase).toBe("ready");
      expect(result.current.totalTools).toBe(1);
    });
  });

  it("keeps zero-tool servers in a startup phase and polls until tools arrive", async () => {
    readGlobalMcpConfigSummaryMock.mockResolvedValue({
      configuredServerNames: ["xdebug"],
      startupTimeoutsMs: { xdebug: 1_000 },
    });
    listMcpServerStatusMock
      .mockResolvedValueOnce({
        result: {
          data: [
            {
              name: "xdebug",
              tools: {},
            },
          ],
        },
      } as Awaited<ReturnType<typeof listMcpServerStatus>>)
      .mockResolvedValueOnce({
        result: {
          data: [
            {
              name: "xdebug",
              tools: {
                mcp__xdebug__attach: {},
              },
            },
          ],
        },
      } as Awaited<ReturnType<typeof listMcpServerStatus>>);

    const { result } = renderHook(() => useMcpServerStatus("workspace-1"));

    await waitFor(() => {
      expect(result.current.servers[0]?.startupPhase).toBe("starting");
      expect(result.current.servers[0]?.startupRemainingSeconds).toBe(1);
      expect(result.current.isSettling).toBe(true);
    });

    await waitFor(() => {
      expect(listMcpServerStatusMock).toHaveBeenCalledTimes(2);
      expect(result.current.servers[0]?.startupPhase).toBe("ready");
      expect(result.current.totalTools).toBe(1);
      expect(result.current.isSettling).toBe(false);
    }, { timeout: 2500 });
  });

  it("updates startup countdown while the next status poll is still pending", async () => {
    vi.useFakeTimers();

    readGlobalMcpConfigSummaryMock.mockResolvedValue({
      configuredServerNames: ["xdebug"],
      startupTimeoutsMs: { xdebug: 60_000 },
    });

    let resolveSecondStatus:
      | ((value: Awaited<ReturnType<typeof listMcpServerStatus>>) => void)
      | null = null;

    listMcpServerStatusMock
      .mockResolvedValueOnce({
        result: {
          data: [
            {
              name: "xdebug",
              tools: {},
            },
          ],
        },
      } as Awaited<ReturnType<typeof listMcpServerStatus>>)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondStatus = resolve;
          }),
      );

    const { result } = renderHook(() => useMcpServerStatus("workspace-1"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.servers[0]?.startupPhase).toBe("starting");
    expect(result.current.servers[0]?.startupRemainingSeconds).toBe(60);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(listMcpServerStatusMock).toHaveBeenCalledTimes(2);
    expect(result.current.servers[0]?.startupRemainingSeconds).toBe(59);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(result.current.servers[0]?.startupRemainingSeconds).toBe(55);

    await act(async () => {
      resolveSecondStatus?.({
        result: {
          data: [
            {
              name: "xdebug",
              tools: {
                mcp__xdebug__attach: {},
              },
            },
          ],
        },
      } as Awaited<ReturnType<typeof listMcpServerStatus>>);
      await Promise.resolve();
    });

    expect(result.current.servers[0]?.startupPhase).toBe("ready");
    expect(result.current.totalTools).toBe(1);
  }, 10000);

  it("does not block the first MCP status load when config.toml reading stalls", async () => {
    readGlobalMcpConfigSummaryMock.mockImplementation(
      () =>
        new Promise(() => {
          // Intentionally unresolved to simulate a stalled config read.
        }),
    );
    listMcpServerStatusMock.mockResolvedValue({
      result: {
        data: [
          {
            name: "filesystem",
            authStatus: "connected",
            tools: {
              mcp__filesystem__read: {},
            },
          },
        ],
      },
    } as Awaited<ReturnType<typeof listMcpServerStatus>>);

    const { result } = renderHook(() => useMcpServerStatus("workspace-1"));

    await waitFor(() => {
      expect(listMcpServerStatusMock).toHaveBeenCalledWith(
        "workspace-1",
        null,
        null,
      );
      expect(result.current.totalServers).toBe(1);
      expect(result.current.totalTools).toBe(1);
      expect(result.current.servers[0]?.name).toBe("filesystem");
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("attaches stderr-backed startup messages to terminal zero-tool rows", async () => {
    listMcpServerStatusMock.mockResolvedValue({
      result: {
        data: [
          {
            name: "xdebug",
            tools: {},
          },
        ],
      },
    } as Awaited<ReturnType<typeof listMcpServerStatus>>);

    const { result } = renderHook(() => useMcpServerStatus("workspace-1"));

    await waitFor(() => {
      expect(result.current.servers[0]?.startupPhase).toBe("starting");
    });

    act(() => {
      listener?.({
        workspace_id: "workspace-1",
        message: {
          method: "codex/stderr",
          params: {
            message:
              "MCP client for `xdebug` failed to start: broken pipe while starting MCP server",
          },
        },
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 1100));

    await waitFor(() => {
      expect(result.current.servers[0]?.startupPhase).toBe("zero");
      expect(result.current.servers[0]?.startupMessage).toContain(
        "MCP client for `xdebug` failed to start: broken pipe while starting MCP server",
      );
    }, { timeout: 2500 });
  });

  it("ignores non-terminal stderr so warmup polling can continue", async () => {
    vi.useFakeTimers();

    readGlobalMcpConfigSummaryMock.mockResolvedValue({
      configuredServerNames: ["xdebug"],
      startupTimeoutsMs: { xdebug: 60_000 },
    });
    listMcpServerStatusMock
      .mockResolvedValueOnce({
        result: {
          data: [
            {
              name: "xdebug",
              tools: {},
            },
          ],
        },
      } as Awaited<ReturnType<typeof listMcpServerStatus>>)
      .mockResolvedValueOnce({
        result: {
          data: [
            {
              name: "xdebug",
              tools: {
                mcp__xdebug__attach: {},
              },
            },
          ],
        },
      } as Awaited<ReturnType<typeof listMcpServerStatus>>);

    const { result } = renderHook(() => useMcpServerStatus("workspace-1"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.servers[0]?.startupPhase).toBe("starting");

    act(() => {
      listener?.({
        workspace_id: "workspace-1",
        message: {
          method: "codex/stderr",
          params: {
            message: "MCP server xdebug is still starting and has not reported tools yet",
          },
        },
      });
    });

    expect(result.current.servers[0]?.startupPhase).toBe("starting");
    expect(result.current.servers[0]?.startupMessage).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(listMcpServerStatusMock).toHaveBeenCalledTimes(2);
    expect(result.current.servers[0]?.startupPhase).toBe("ready");
    expect(result.current.totalTools).toBe(1);
  });
});
