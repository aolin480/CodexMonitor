// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeAppServerEvents } from "@services/events";
import {
  getCodexConfigPath,
  listMcpServerStatus,
  mcpServerOAuthLogin,
  readGlobalMcpConfigSummary,
} from "@services/tauri";
import { useMcpServerStatus } from "./useMcpServerStatus";

vi.mock("@services/tauri", () => ({
  getCodexConfigPath: vi.fn(),
  listMcpServerStatus: vi.fn(),
  mcpServerOAuthLogin: vi.fn(),
  readGlobalMcpConfigSummary: vi.fn(),
}));

vi.mock("@services/events", () => ({
  subscribeAppServerEvents: vi.fn(() => () => {}),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const getCodexConfigPathMock = vi.mocked(getCodexConfigPath);
const listMcpServerStatusMock = vi.mocked(listMcpServerStatus);
const mcpServerOAuthLoginMock = vi.mocked(mcpServerOAuthLogin);
const readGlobalMcpConfigSummaryMock = vi.mocked(readGlobalMcpConfigSummary);
const subscribeAppServerEventsMock = vi.mocked(subscribeAppServerEvents);

describe("useMcpServerStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCodexConfigPathMock.mockResolvedValue("/Users/me/.codex/config.toml");
    readGlobalMcpConfigSummaryMock.mockResolvedValue({
      configuredServerNames: [],
      startupTimeoutsMs: {},
    });
    mcpServerOAuthLoginMock.mockResolvedValue({
      authUrl: "https://example.com/oauth",
    });
    subscribeAppServerEventsMock.mockImplementation(() => () => {});
  });

  it("supports result arrays from the backend envelope", async () => {
    listMcpServerStatusMock.mockResolvedValue({
      result: [
        {
          name: "github",
          tools: {
            mcp__github__search_repos: {},
          },
        },
      ],
    } as Awaited<ReturnType<typeof listMcpServerStatus>>);

    const { result } = renderHook(() => useMcpServerStatus("workspace-1"));

    await waitFor(() => {
      expect(result.current.totalServers).toBe(1);
      expect(result.current.totalTools).toBe(1);
      expect(result.current.configPath).toBe("/Users/me/.codex/config.toml");
      expect(result.current.servers[0]?.name).toBe("github");
    });
  });

  it("supports nested result.data payloads", async () => {
    listMcpServerStatusMock.mockResolvedValue({
      result: {
        data: [
          {
            name: "filesystem",
            tools: [
              { name: "mcp__filesystem__read_file" },
              { name: "mcp__filesystem__write_file" },
            ],
          },
        ],
      },
    } as Awaited<ReturnType<typeof listMcpServerStatus>>);

    const { result } = renderHook(() => useMcpServerStatus("workspace-1"));

    await waitFor(() => {
      expect(result.current.totalServers).toBe(1);
      expect(result.current.totalTools).toBe(2);
      expect(result.current.configPath).toBe("/Users/me/.codex/config.toml");
      expect(result.current.servers[0]?.toolNames).toEqual([
        "read_file",
        "write_file",
      ]);
    });
  });
});
