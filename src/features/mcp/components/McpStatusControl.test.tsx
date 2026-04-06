// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { McpStatusControl } from "./McpStatusControl";
import type { McpStatusController } from "../types";

function buildStatus(overrides?: Partial<McpStatusController>): McpStatusController {
  return {
    servers: [
      {
        name: "github",
        hasMatchingConfigBlock: true,
        authStatusCode: "connected",
        authStatus: "connected",
        toolNames: ["search_repositories", "create_pull_request"],
        toolCount: 2,
        resourceCount: 0,
        templateCount: 0,
        toolError: null,
        startupPhase: "ready",
        startupTimeoutMs: null,
        startupProgress: null,
        startupRemainingSeconds: null,
        startupMessage: null,
      },
      {
        name: "filesystem",
        hasMatchingConfigBlock: true,
        authStatusCode: "local",
        authStatus: "local",
        toolNames: ["read_file"],
        toolCount: 1,
        resourceCount: 0,
        templateCount: 0,
        toolError: null,
        startupPhase: "ready",
        startupTimeoutMs: null,
        startupProgress: null,
        startupRemainingSeconds: null,
        startupMessage: null,
      },
    ],
    totalServers: 2,
    totalTools: 3,
    configPath: "/Users/aaronolin/.codex/config.toml",
    isLoading: false,
    isSettling: false,
    authenticatingServerName: null,
    error: null,
    lastUpdatedAt: Date.now(),
    note: null,
    refresh: vi.fn().mockResolvedValue(undefined),
    startOAuthLogin: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("McpStatusControl", () => {
  it("does not expand a server by default when the popover opens", () => {
    const { container } = render(
      <McpStatusControl
        disabled={false}
        isPhone={false}
        status={buildStatus()}
      />,
    );

    const mcpButtons = screen.getAllByRole("button", { name: "MCP servers" });
    fireEvent.click(mcpButtons[mcpButtons.length - 1]!);

    expect(screen.queryByText("Available tools")).toBeNull();
    expect(screen.queryByText("search_repositories")).toBeNull();
    expect(
      container.querySelectorAll(".composer-mcp-row-expand-slot").length,
    ).toBe(2);
  });

  it("shows a spinning MCP chip icon while loading", () => {
    const { container } = render(
      <McpStatusControl
        disabled={false}
        isPhone={false}
        status={buildStatus({ isLoading: true, lastUpdatedAt: null })}
      />,
    );

    const spinningIcon = container.querySelector(
      ".composer-icon--mcp .composer-mcp-sync-icon.spinning",
    );

    expect(spinningIcon).not.toBeNull();
  });

  it("shows an Error chip with rename guidance for hyphenated server names with zero tools", () => {
    const { container } = render(
      <McpStatusControl
        disabled={false}
        isPhone={false}
        status={buildStatus({
          servers: [
            {
              name: "duckduckgo-mcp-server",
              hasMatchingConfigBlock: false,
              authStatusCode: "oAuth",
              authStatus: "OAuth",
              toolNames: [],
              toolCount: 0,
              resourceCount: 0,
              templateCount: 0,
              toolError: {
                code: "hyphenated_name_no_tools",
                correctedName: "duckduckgo_mcp_server",
              },
              startupPhase: "error",
              startupTimeoutMs: null,
              startupProgress: null,
              startupRemainingSeconds: null,
              startupMessage: null,
            },
          ],
          totalServers: 1,
          totalTools: 0,
        })}
      />,
    );

    const mcpButtons = screen.getAllByRole("button", { name: "MCP servers" });
    fireEvent.click(mcpButtons[mcpButtons.length - 1]!);

    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.queryByText("0 tools")).toBeNull();
    expect(screen.queryByText("Available tools")).toBeNull();
    expect(
      container.querySelector(".composer-mcp-row-chevron"),
    ).toBeNull();
    expect(
      container.querySelector(".composer-mcp-row-expand-placeholder"),
    ).not.toBeNull();
    const errorChip = container.querySelector(
      ".composer-mcp-count--error",
    ) as HTMLElement | null;

    expect(errorChip).not.toBeNull();
    expect(errorChip?.getAttribute("data-tooltip")).toContain(
      "Codex does not support hyphenated MCP server names.",
    );
    expect(errorChip?.getAttribute("data-tooltip")).toContain(
      "[mcp_servers.duckduckgo_mcp_server]",
    );
    expect(errorChip?.getAttribute("data-tooltip")).toContain(
      "/Users/aaronolin/.codex/config.toml",
    );

    const row = container.querySelector(".composer-mcp-row-button.is-static");
    expect(row).not.toBeNull();
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(screen.queryByText("Configuration fix")).toBeNull();
  });

  it("shows a Sign In CTA and disables expansion for not-logged-in servers", () => {
    const startOAuthLogin = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <McpStatusControl
        disabled={false}
        isPhone={false}
        status={buildStatus({
          servers: [
            {
              name: "figma_mcp",
              hasMatchingConfigBlock: true,
              authStatusCode: "notLoggedIn",
              authStatus: "Not Logged In",
              toolNames: [],
              toolCount: 0,
              resourceCount: 28,
              templateCount: 3,
              toolError: null,
              startupPhase: "needsAuth",
              startupTimeoutMs: null,
              startupProgress: null,
              startupRemainingSeconds: null,
              startupMessage: null,
            },
          ],
          totalServers: 1,
          totalTools: 0,
          startOAuthLogin,
        })}
      />,
    );

    const mcpButtons = screen.getAllByRole("button", { name: "MCP servers" });
    fireEvent.click(mcpButtons[mcpButtons.length - 1]!);

    expect(screen.getByRole("button", { name: "Sign In" })).toBeTruthy();
    expect(screen.queryByText("0 tools")).toBeNull();
    expect(screen.queryByText("Available tools")).toBeNull();
    expect(container.querySelector(".composer-mcp-row-chevron")).toBeNull();
    expect(
      container.querySelector(".composer-mcp-row-expand-placeholder"),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(startOAuthLogin).toHaveBeenCalledWith("figma_mcp");
  });

  it("shows a startup chip instead of 0 tools while a server is still warming", () => {
    render(
      <McpStatusControl
        disabled={false}
        isPhone={false}
        status={buildStatus({
          servers: [
            {
              name: "xdebug",
              hasMatchingConfigBlock: true,
              authStatusCode: null,
              authStatus: null,
              toolNames: [],
              toolCount: 0,
              resourceCount: 0,
              templateCount: 0,
              toolError: null,
              startupPhase: "starting",
              startupTimeoutMs: 60_000,
              startupProgress: 0.4,
              startupRemainingSeconds: 36,
              startupMessage: null,
            },
          ],
          totalServers: 1,
          totalTools: 0,
          isSettling: true,
        })}
      />,
    );

    const mcpButtons = screen.getAllByRole("button", { name: "MCP servers" });
    fireEvent.click(mcpButtons[mcpButtons.length - 1]!);

    expect(screen.getByText("Starting…")).toBeTruthy();
    expect(screen.getByText("36s")).toBeTruthy();
    expect(screen.queryByText("0 tools")).toBeNull();
    expect(screen.queryByText("Available tools")).toBeNull();
  });

  it("shows a hover explanation on terminal zero-tool rows when a startup message is available", () => {
    const { container } = render(
      <McpStatusControl
        disabled={false}
        isPhone={false}
        status={buildStatus({
          servers: [
            {
              name: "xdebug",
              hasMatchingConfigBlock: true,
              authStatusCode: null,
              authStatus: null,
              toolNames: [],
              toolCount: 0,
              resourceCount: 0,
              templateCount: 0,
              toolError: null,
              startupPhase: "zero",
              startupTimeoutMs: 60_000,
              startupProgress: 1,
              startupRemainingSeconds: 0,
              startupMessage:
                "MCP client for `xdebug` timed out after 60 seconds. Add or adjust `startup_timeout_sec` in your config.toml.",
            },
          ],
          totalServers: 1,
          totalTools: 0,
        })}
      />,
    );

    const mcpButtons = screen.getAllByRole("button", { name: "MCP servers" });
    fireEvent.click(mcpButtons[mcpButtons.length - 1]!);

    expect(screen.getByText("0 tools")).toBeTruthy();
    const warningChip = container.querySelector(
      ".composer-mcp-count--warning",
    ) as HTMLElement | null;
    expect(warningChip).not.toBeNull();
    expect(warningChip?.getAttribute("data-tooltip")).toContain(
      "MCP client for `xdebug` timed out after 60 seconds.",
    );
    expect(warningChip?.getAttribute("data-tooltip")).toContain(
      "configured block header already matches this server",
    );
    expect(warningChip?.getAttribute("data-tooltip")).toContain(
      "[mcp_servers.xdebug]",
    );
    expect(warningChip?.getAttribute("data-tooltip")).toContain(
      "codex mcp login xdebug",
    );
    expect(warningChip?.getAttribute("data-tooltip")).toContain(
      "/Users/aaronolin/.codex/config.toml",
    );
  });

  it("shows a suggested block header when a zero-tool warning row uses a hyphenated name", () => {
    const { container } = render(
      <McpStatusControl
        disabled={false}
        isPhone={false}
        status={buildStatus({
          servers: [
            {
              name: "duckduckgo-mcp-server",
              hasMatchingConfigBlock: false,
              authStatusCode: "oAuth",
              authStatus: "OAuth",
              toolNames: [],
              toolCount: 0,
              resourceCount: 0,
              templateCount: 0,
              toolError: null,
              startupPhase: "zero",
              startupTimeoutMs: 10_000,
              startupProgress: 1,
              startupRemainingSeconds: 0,
              startupMessage:
                "Server finished starting but still returned 0 tools.",
            },
          ],
          totalServers: 1,
          totalTools: 0,
        })}
      />,
    );

    const mcpButtons = screen.getAllByRole("button", { name: "MCP servers" });
    fireEvent.click(mcpButtons[mcpButtons.length - 1]!);

    const warningChip = container.querySelector(
      ".composer-mcp-count--warning",
    ) as HTMLElement | null;
    expect(warningChip).not.toBeNull();
    expect(warningChip?.getAttribute("data-tooltip")).toContain(
      "Expected block header: [mcp_servers.duckduckgo-mcp-server]",
    );
    expect(warningChip?.getAttribute("data-tooltip")).toContain(
      "Suggested block header: [mcp_servers.duckduckgo_mcp_server]",
    );
  });
});
