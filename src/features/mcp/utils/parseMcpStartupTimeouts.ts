export const DEFAULT_MCP_STARTUP_TIMEOUT_MS = 10_000;

export function resolveMcpStartupTimeoutMs(
  serverName: string,
  startupTimeoutsByServer: Record<string, number>,
): number {
  return startupTimeoutsByServer[serverName] ?? DEFAULT_MCP_STARTUP_TIMEOUT_MS;
}
