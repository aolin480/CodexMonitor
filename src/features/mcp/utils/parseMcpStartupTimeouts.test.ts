import { describe, expect, it } from "vitest";
import {
  DEFAULT_MCP_STARTUP_TIMEOUT_MS,
  resolveMcpStartupTimeoutMs,
} from "./parseMcpStartupTimeouts";

describe("parseMcpStartupTimeouts", () => {
  it("falls back to the default timeout when a server has no explicit value", () => {
    expect(resolveMcpStartupTimeoutMs("figma_mcp", {})).toBe(
      DEFAULT_MCP_STARTUP_TIMEOUT_MS,
    );
    expect(resolveMcpStartupTimeoutMs("xdebug", { xdebug: 60_000 })).toBe(
      60_000,
    );
  });
});
