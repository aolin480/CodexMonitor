import { describe, expect, it } from "vitest";
import {
  DEFAULT_MCP_STARTUP_TIMEOUT_MS,
  parseConfiguredMcpServerNames,
  parseMcpStartupTimeouts,
  resolveMcpStartupTimeoutMs,
} from "./parseMcpStartupTimeouts";

describe("parseMcpStartupTimeouts", () => {
  it("reads active MCP server startup timeouts and ignores commented sections", () => {
    const content = `
[mcp_servers.xdebug]
command = "node"
startup_timeout_sec = 60.0

# [mcp_servers.mongodb]
# startup_timeout_sec = 30.0

[mcp_servers.duckduckgo-mcp-server]
url = "https://example.com"

[mcp_servers.code_graph_context]
startup_timeout_sec = 2.5
`;

    expect(parseMcpStartupTimeouts(content)).toEqual({
      xdebug: 60_000,
      code_graph_context: 2_500,
    });
  });

  it("reads active MCP server block headers and ignores commented sections", () => {
    const content = `
[mcp_servers.xdebug]
command = "node"

# [mcp_servers.mongodb]
# command = "mongo"

[mcp_servers.duckduckgo_mcp_server]
url = "https://example.com"

[mcp_servers.code_graph_context.env]
FOO = "bar"
`;

    expect(parseConfiguredMcpServerNames(content)).toEqual([
      "duckduckgo_mcp_server",
      "xdebug",
    ]);
  });

  it("falls back to the default timeout when a server has no explicit value", () => {
    expect(resolveMcpStartupTimeoutMs("figma_mcp", {})).toBe(
      DEFAULT_MCP_STARTUP_TIMEOUT_MS,
    );
    expect(resolveMcpStartupTimeoutMs("xdebug", { xdebug: 60_000 })).toBe(
      60_000,
    );
  });
});
