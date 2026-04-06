import { describe, expect, it } from "vitest";
import {
  normalizeMcpAuthStatusLabel,
  normalizeMcpServerStatus,
} from "./normalizeMcpServerStatus";

describe("normalizeMcpServerStatus", () => {
  it("normalizes tool names, auth status, and resource/template counts", () => {
    expect(
      normalizeMcpServerStatus([
        {
          name: "github",
          auth_status: { status: "connected" },
          tools: {
            mcp__github__issues: {},
            mcp__github__pull_requests: {},
          },
          resources: [{ id: 1 }],
          resource_templates: [{ id: 2 }, { id: 3 }],
        },
      ]),
    ).toEqual([
      {
        name: "github",
        authStatusCode: "connected",
        authStatus: "connected",
        toolNames: ["issues", "pull_requests"],
        toolCount: 2,
        resourceCount: 1,
        templateCount: 2,
        toolError: null,
        startupPhase: "ready",
        startupTimeoutMs: null,
        startupProgress: null,
        startupRemainingSeconds: null,
        startupMessage: null,
      },
    ]);
  });

  it("returns an empty list for invalid payloads", () => {
    expect(normalizeMcpServerStatus(null)).toEqual([]);
    expect(normalizeMcpServerStatus({})).toEqual([]);
  });

  it("normalizes known auth status labels for display", () => {
    expect(normalizeMcpAuthStatusLabel("oAuth")).toBe("OAuth");
    expect(normalizeMcpAuthStatusLabel("bearerToken")).toBe("Bearer Token");
    expect(normalizeMcpAuthStatusLabel("notLoggedIn")).toBe("Not Logged In");
    expect(normalizeMcpAuthStatusLabel("unsupported")).toBeNull();
  });

  it("flags likely hyphenated server name mismatches when tools are empty", () => {
    expect(
      normalizeMcpServerStatus([
        {
          name: "duckduckgo-mcp-server",
          authStatus: "oAuth",
          tools: {},
        },
      ]),
    ).toEqual([
      {
        name: "duckduckgo-mcp-server",
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
        startupPhase: "zero",
        startupTimeoutMs: null,
        startupProgress: null,
        startupRemainingSeconds: null,
        startupMessage: null,
      },
    ]);
  });

  it("does not flag inactive hyphenated servers with zero tools", () => {
    expect(
      normalizeMcpServerStatus([
        {
          name: "example-server",
          tools: {},
        },
      ]),
    ).toEqual([
      {
        name: "example-server",
        authStatusCode: null,
        authStatus: null,
        toolNames: [],
        toolCount: 0,
        resourceCount: 0,
        templateCount: 0,
        toolError: null,
        startupPhase: "zero",
        startupTimeoutMs: null,
        startupProgress: null,
        startupRemainingSeconds: null,
        startupMessage: null,
      },
    ]);
  });
});
