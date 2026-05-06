import type { McpServerStatusVm } from "../types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getResponseData(value: unknown): unknown {
  const response = asRecord(value);
  if (!response) {
    return value;
  }

  if (Array.isArray(response.result)) {
    return response.result;
  }

  const nestedResult = asRecord(response.result);
  if (nestedResult) {
    return nestedResult.data ?? [];
  }

  return response.data ?? value;
}

function normalizeAuthStatus(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) {
    return direct;
  }

  const record = asRecord(value);
  return asTrimmedString(record?.status);
}

function normalizeToolNames(serverName: string, tools: unknown): string[] {
  const prefix = `mcp__${serverName}__`;
  const stripPrefix = (toolName: string) =>
    toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;

  if (Array.isArray(tools)) {
    return tools
      .map((tool) => asTrimmedString(asRecord(tool)?.name))
      .filter((toolName): toolName is string => Boolean(toolName))
      .map(stripPrefix)
      .sort((left, right) => left.localeCompare(right));
  }

  const toolsRecord = asRecord(tools);
  if (!toolsRecord) {
    return [];
  }

  return Object.keys(toolsRecord)
    .map(stripPrefix)
    .sort((left, right) => left.localeCompare(right));
}

export function normalizeMcpServerStatus(payload: unknown): McpServerStatusVm[] {
  const data = getResponseData(payload);
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }

      const name = asTrimmedString(record.name) ?? "unknown";
      const toolNames = normalizeToolNames(name, record.tools);
      const resourceCount = Array.isArray(record.resources)
        ? record.resources.length
        : 0;
      const templateCount = Array.isArray(record.resourceTemplates)
        ? record.resourceTemplates.length
        : Array.isArray(record.resource_templates)
          ? record.resource_templates.length
          : 0;

      return {
        name,
        authStatus: normalizeAuthStatus(record.authStatus ?? record.auth_status),
        toolNames,
        toolCount: toolNames.length,
        resourceCount,
        templateCount,
      } satisfies McpServerStatusVm;
    })
    .filter((server): server is McpServerStatusVm => server !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
