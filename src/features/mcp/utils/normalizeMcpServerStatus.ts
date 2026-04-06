import type { McpServerStatusVm } from "../types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeMcpAuthStatusLabel(value: string | null): string | null {
  if (!value) {
    return null;
  }
  switch (value) {
    case "unsupported":
      return null;
    case "notLoggedIn":
      return "Not Logged In";
    case "bearerToken":
      return "Bearer Token";
    case "oAuth":
      return "OAuth";
    default:
      return value;
  }
}

function resolveAuthStatusCode(value: unknown): string | null {
  const direct = asString(value);
  if (direct) {
    return direct;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return asString(record.status);
}

function resolveAuthStatus(value: unknown): string | null {
  const direct = normalizeMcpAuthStatusLabel(resolveAuthStatusCode(value));
  if (direct) {
    return direct;
  }
  return null;
}

function normalizeToolNames(name: string, tools: unknown): string[] {
  const prefix = `mcp__${name}__`;
  const stripPrefix = (toolName: string) =>
    toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;

  if (Array.isArray(tools)) {
    return tools
      .map((tool) => asRecord(tool))
      .map((tool) => asString(tool?.name))
      .filter((toolName): toolName is string => Boolean(toolName))
      .map(stripPrefix)
      .sort((left, right) => left.localeCompare(right));
  }

  const toolRecord = asRecord(tools) ?? {};
  return Object.keys(toolRecord).map(stripPrefix).sort((left, right) => left.localeCompare(right));
}

function resolveToolError(
  name: string,
  toolCount: number,
  authStatus: string | null,
  resourceCount: number,
  templateCount: number,
): { code: "hyphenated_name_no_tools"; correctedName: string } | null {
  const looksActive =
    authStatus !== null || resourceCount > 0 || templateCount > 0;
  if (!name.includes("-") || toolCount > 0 || !looksActive) {
    return null;
  }

  return {
    code: "hyphenated_name_no_tools",
    correctedName: name.replace(/-/g, "_"),
  };
}

export function normalizeMcpServerStatus(
  payload: unknown,
): McpServerStatusVm[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const servers: McpServerStatusVm[] = [];

  for (const item of payload) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }

      const name = asString(record.name) ?? "unknown";
      const toolNames = normalizeToolNames(name, record.tools);
      const resources = Array.isArray(record.resources)
        ? record.resources.length
        : 0;
      const templates = Array.isArray(record.resourceTemplates)
        ? record.resourceTemplates.length
          : Array.isArray(record.resource_templates)
            ? record.resource_templates.length
            : 0;
      const authStatusCode = resolveAuthStatusCode(
        record.authStatus ?? record.auth_status ?? null,
      );
      const authStatus = resolveAuthStatus(
        record.authStatus ?? record.auth_status ?? null,
      );
      const toolCount = toolNames.length;

      servers.push({
        name,
        authStatusCode,
        authStatus,
        toolNames,
        toolCount,
        resourceCount: resources,
        templateCount: templates,
        toolError: resolveToolError(
          name,
          toolCount,
          authStatus,
          resources,
          templates,
        ),
        startupPhase:
          toolCount > 0
            ? "ready"
            : authStatusCode === "notLoggedIn"
              ? "needsAuth"
              : "zero",
        startupTimeoutMs: null,
        startupProgress: null,
        startupRemainingSeconds: null,
        startupMessage: null,
      } satisfies McpServerStatusVm);
  }

  return servers.sort((left, right) => left.name.localeCompare(right.name));
}
