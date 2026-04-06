export const DEFAULT_MCP_STARTUP_TIMEOUT_MS = 10_000;

export function parseMcpStartupTimeouts(
  content: string,
): Record<string, number> {
  const timeouts: Record<string, number> = {};
  let currentServerName: string | null = null;

  for (const line of content.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) {
      continue;
    }

    const sectionMatch = line.match(/^\s*\[mcp_servers\.([^\]\s]+)\]\s*$/);
    if (sectionMatch) {
      currentServerName = sectionMatch[1] ?? null;
      continue;
    }

    if (/^\s*\[/.test(line)) {
      currentServerName = null;
      continue;
    }

    if (!currentServerName) {
      continue;
    }

    const timeoutMatch = line.match(
      /^\s*startup_timeout_sec\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*$/,
    );
    if (!timeoutMatch) {
      continue;
    }

    const timeoutSeconds = Number(timeoutMatch[1]);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) {
      continue;
    }

    timeouts[currentServerName] = Math.round(timeoutSeconds * 1000);
  }

  return timeouts;
}

export function resolveMcpStartupTimeoutMs(
  serverName: string,
  startupTimeoutsByServer: Record<string, number>,
): number {
  return startupTimeoutsByServer[serverName] ?? DEFAULT_MCP_STARTUP_TIMEOUT_MS;
}
