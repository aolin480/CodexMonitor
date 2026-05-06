import { describe, expect, it } from "vitest";
import { normalizeMcpServerStatus } from "./normalizeMcpServerStatus";

describe("normalizeMcpServerStatus", () => {
  it("normalizes wrapped app-server responses", () => {
    const servers = normalizeMcpServerStatus({
      result: {
        data: [
          {
            name: "figma",
            authStatus: { status: "oAuth" },
            tools: {
              mcp__figma__inspect: {},
              mcp__figma__create: {},
            },
            resources: [{ uri: "file" }],
            resourceTemplates: [{ uriTemplate: "file://{id}" }],
          },
        ],
      },
    });

    expect(servers).toEqual([
      {
        name: "figma",
        authStatus: "oAuth",
        toolNames: ["create", "inspect"],
        toolCount: 2,
        resourceCount: 1,
        templateCount: 1,
      },
    ]);
  });

  it("supports array-shaped tools and snake_case fields", () => {
    const servers = normalizeMcpServerStatus([
      {
        name: "browser-use",
        auth_status: "unsupported",
        tools: [
          { name: "mcp__browser-use__click" },
          { name: "mcp__browser-use__screenshot" },
        ],
        resource_templates: [{ uriTemplate: "browser://{tab}" }],
      },
    ]);

    expect(servers[0]).toMatchObject({
      name: "browser-use",
      authStatus: "unsupported",
      toolNames: ["click", "screenshot"],
      templateCount: 1,
    });
  });
});
