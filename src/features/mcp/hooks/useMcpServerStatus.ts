import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { subscribeAppServerEvents } from "@services/events";
import {
  listMcpServerStatus,
  mcpServerOAuthLogin,
} from "@services/tauri";
import { getAppServerParams, getAppServerRawMethod } from "../../../utils/appServerEvents";
import type { McpServerStatusVm, McpStatusState } from "../types";
import { useMcpConfigSummary } from "./useMcpConfigSummary";
import { normalizeMcpServerStatus } from "../utils/normalizeMcpServerStatus";
import { resolveMcpStartupTimeoutMs } from "../utils/parseMcpStartupTimeouts";

const EMPTY_STATE: McpStatusState = {
  servers: [],
  totalServers: 0,
  totalTools: 0,
  configPath: null,
  authenticatingServerName: null,
  isLoading: false,
  isSettling: false,
  error: null,
  lastUpdatedAt: null,
  note: null,
};

type RefreshOptions = {
  background?: boolean;
  restartWarmup?: boolean;
};

function normalizeStartupMessage(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isTerminalStartupMessage(value: string): boolean {
  return /\b(failed to start|timed out|timeout|exited|crashed)\b/i.test(value);
}

function buildTimeoutStartupMessage(
  serverName: string,
  startupTimeoutMs: number,
): string {
  const seconds = Math.max(1, Math.round(startupTimeoutMs / 1000));
  return `MCP client for \`${serverName}\` timed out after ${seconds} seconds. Add or adjust \`startup_timeout_sec\` in your config.toml.`;
}

function findMentionedServerName(
  message: string,
  serverNames: readonly string[],
): string | null {
  const lower = message.toLowerCase();
  const sortedNames = [...serverNames].sort((left, right) => right.length - left.length);
  for (const serverName of sortedNames) {
    if (lower.includes(serverName.toLowerCase())) {
      return serverName;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getResponseData(value: unknown): unknown {
  const response = asRecord(value);
  if (!response) {
    return [];
  }

  if (Array.isArray(response.result)) {
    return response.result;
  }

  const nested = asRecord(response.result);
  if (nested) {
    return nested.data ?? [];
  }
  return response.data ?? [];
}

function isWarmupCandidate(server: McpServerStatusVm): boolean {
  return (
    server.toolCount === 0 &&
    server.authStatusCode !== "notLoggedIn" &&
    server.toolError === null
  );
}

function applyConfiguredServerNames(
  servers: readonly McpServerStatusVm[],
  configuredServerNames: Record<string, true> | null,
): McpServerStatusVm[] {
  return servers.map((server) => ({
    ...server,
    hasMatchingConfigBlock:
      configuredServerNames === null
        ? null
        : Boolean(configuredServerNames[server.name]),
  }));
}

function buildServerViewModels(
  servers: McpServerStatusVm[],
  startupTimeoutsByServer: Record<string, number>,
  warmupDeadlineByServer: Record<string, number>,
  startupMessagesByServer: Record<string, string>,
  now: number,
  restartWarmup: boolean,
): {
  servers: McpServerStatusVm[];
  hasStartingServers: boolean;
  warmupDeadlineByServer: Record<string, number>;
} {
  const nextWarmupDeadlineByServer: Record<string, number> = {};
  let hasStartingServers = false;

  const nextServers = servers.map((server) => {
    if (server.toolError) {
      return {
        ...server,
        startupPhase: "error",
        startupTimeoutMs: null,
        startupProgress: null,
        startupRemainingSeconds: null,
        startupMessage: null,
      } satisfies McpServerStatusVm;
    }

    if (server.authStatusCode === "notLoggedIn") {
      return {
        ...server,
        startupPhase: "needsAuth",
        startupTimeoutMs: null,
        startupProgress: null,
        startupRemainingSeconds: null,
        startupMessage: null,
      } satisfies McpServerStatusVm;
    }

    if (server.toolCount > 0) {
      return {
        ...server,
        startupPhase: "ready",
        startupTimeoutMs: null,
        startupProgress: null,
        startupRemainingSeconds: null,
        startupMessage: null,
      } satisfies McpServerStatusVm;
    }

    if (!isWarmupCandidate(server)) {
      return {
        ...server,
        startupPhase: "zero",
        startupTimeoutMs: null,
        startupProgress: null,
        startupRemainingSeconds: null,
        startupMessage: startupMessagesByServer[server.name] ?? null,
      } satisfies McpServerStatusVm;
    }

    const startupTimeoutMs = resolveMcpStartupTimeoutMs(
      server.name,
      startupTimeoutsByServer,
    );
    const startupMessage = startupMessagesByServer[server.name] ?? null;
    if (startupMessage) {
      nextWarmupDeadlineByServer[server.name] = now;
      return {
        ...server,
        startupPhase: "zero",
        startupTimeoutMs,
        startupProgress: 1,
        startupRemainingSeconds: 0,
        startupMessage,
      } satisfies McpServerStatusVm;
    }
    const previousDeadline = warmupDeadlineByServer[server.name];
    const deadlineAt =
      restartWarmup || previousDeadline == null
        ? now + startupTimeoutMs
        : previousDeadline;

    nextWarmupDeadlineByServer[server.name] = deadlineAt;

    if (deadlineAt > now) {
      const remainingMs = deadlineAt - now;
      hasStartingServers = true;
      return {
        ...server,
        startupPhase: "starting",
        startupTimeoutMs,
        startupProgress: Math.min(
          1,
          Math.max(0, (startupTimeoutMs - remainingMs) / startupTimeoutMs),
        ),
        startupRemainingSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
        startupMessage: null,
      } satisfies McpServerStatusVm;
    }

    return {
      ...server,
      startupPhase: "zero",
      startupTimeoutMs,
      startupProgress: 1,
      startupRemainingSeconds: 0,
      startupMessage:
        server.resourceCount === 0 && server.templateCount === 0
          ? buildTimeoutStartupMessage(server.name, startupTimeoutMs)
          : null,
    } satisfies McpServerStatusVm;
  });

  return {
    servers: nextServers,
    hasStartingServers,
    warmupDeadlineByServer: nextWarmupDeadlineByServer,
  };
}

function didStartupDisplayChange(
  previousServers: readonly McpServerStatusVm[],
  nextServers: readonly McpServerStatusVm[],
): boolean {
  if (previousServers.length !== nextServers.length) {
    return true;
  }

  return nextServers.some((server, index) => {
    const previous = previousServers[index];
    if (!previous) {
      return true;
    }

    return (
      previous.name !== server.name ||
      previous.startupPhase !== server.startupPhase ||
      previous.startupProgress !== server.startupProgress ||
      previous.startupRemainingSeconds !== server.startupRemainingSeconds ||
      previous.startupMessage !== server.startupMessage
    );
  });
}

export function useMcpServerStatus(
  workspaceId: string | null,
  enabled = true,
) {
  const [state, setState] = useState<McpStatusState>(EMPTY_STATE);
  const configSummary = useMcpConfigSummary(workspaceId, enabled);
  const warmupDeadlineByServerRef = useRef<Record<string, number>>({});
  const startupTimeoutsByServerRef = useRef<Record<string, number>>({});
  const configuredServerNamesRef = useRef<Record<string, true> | null>(null);
  const startupMessagesByServerRef = useRef<Record<string, string>>({});
  const workspaceIdRef = useRef<string | null>(workspaceId);
  const enabledRef = useRef(enabled);
  const scopeVersionRef = useRef(0);
  const inFlightScopeVersionRef = useRef<number | null>(null);

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
    enabledRef.current = enabled;
  }, [enabled, workspaceId]);

  useEffect(() => {
    scopeVersionRef.current += 1;
    workspaceIdRef.current = workspaceId;
    enabledRef.current = enabled;

    if (!enabled || !workspaceId) {
      startupTimeoutsByServerRef.current = {};
      warmupDeadlineByServerRef.current = {};
      configuredServerNamesRef.current = null;
      startupMessagesByServerRef.current = {};
      setState(EMPTY_STATE);
      return;
    }

    setState({
      ...EMPTY_STATE,
      isLoading: true,
    });
  }, [enabled, workspaceId]);

  useEffect(() => {
    startupTimeoutsByServerRef.current = configSummary.startupTimeoutsByServer;
    configuredServerNamesRef.current = configSummary.configuredServerNames;

    setState((current) => {
      const configPathChanged = current.configPath !== configSummary.configPath;
      if (current.servers.length === 0) {
        return configPathChanged
          ? {
              ...current,
              configPath: configSummary.configPath,
            }
          : current;
      }

      const now = Date.now();
      const configuredServers = applyConfiguredServerNames(
        current.servers,
        configuredServerNamesRef.current,
      );
      const { servers, hasStartingServers, warmupDeadlineByServer } =
        buildServerViewModels(
          configuredServers,
          startupTimeoutsByServerRef.current,
          warmupDeadlineByServerRef.current,
          startupMessagesByServerRef.current,
          now,
          true,
        );

      const displayChanged = didStartupDisplayChange(current.servers, servers);
      if (!configPathChanged && !displayChanged) {
        return current;
      }

      warmupDeadlineByServerRef.current = warmupDeadlineByServer;

      return {
        ...current,
        configPath: configSummary.configPath,
        servers,
        isSettling: hasStartingServers,
      };
    });
  }, [configSummary]);

  const refreshInternal = useCallback(
    async ({ background = false, restartWarmup = false }: RefreshOptions = {}) => {
      const requestWorkspaceId = workspaceIdRef.current;
      const requestScopeVersion = scopeVersionRef.current;

      if (!requestWorkspaceId || !enabledRef.current) {
        if (!requestWorkspaceId || !enabledRef.current) {
          warmupDeadlineByServerRef.current = {};
          configuredServerNamesRef.current = null;
          setState(EMPTY_STATE);
        }
        return;
      }

      if (inFlightScopeVersionRef.current === requestScopeVersion) {
        return;
      }

      inFlightScopeVersionRef.current = requestScopeVersion;
      setState((current) => ({
        ...current,
        isLoading: background ? current.isLoading : true,
        isSettling: background,
        error: background ? current.error : null,
      }));

      try {
        const response = await listMcpServerStatus(requestWorkspaceId, null, null);
        if (
          scopeVersionRef.current !== requestScopeVersion ||
          workspaceIdRef.current !== requestWorkspaceId ||
          !enabledRef.current
        ) {
          return;
        }

        const normalizedServers = applyConfiguredServerNames(
          normalizeMcpServerStatus(getResponseData(response)),
          configuredServerNamesRef.current,
        );
        const now = Date.now();
        const {
          servers,
          hasStartingServers,
          warmupDeadlineByServer,
        } = buildServerViewModels(
          normalizedServers,
          startupTimeoutsByServerRef.current,
          warmupDeadlineByServerRef.current,
          startupMessagesByServerRef.current,
          now,
          restartWarmup,
        );
        warmupDeadlineByServerRef.current = warmupDeadlineByServer;

        const totalTools = servers.reduce(
          (count, server) => count + server.toolCount,
          0,
        );

        setState((current) => ({
          servers,
          totalServers: servers.length,
          totalTools,
          configPath: current.configPath,
          authenticatingServerName: current.authenticatingServerName,
          isLoading: false,
          isSettling: hasStartingServers,
          error: null,
          lastUpdatedAt: now,
          note: current.note,
        }));
      } catch (error) {
        setState((current) =>
          background && current.lastUpdatedAt !== null
            ? {
                ...current,
                isSettling: false,
                note:
                  error instanceof Error
                    ? error.message
                    : "Failed to refresh MCP status.",
              }
            : {
                ...current,
                isLoading: false,
                isSettling: false,
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to load MCP status.",
              },
        );
      } finally {
        if (inFlightScopeVersionRef.current === requestScopeVersion) {
          inFlightScopeVersionRef.current = null;
        }
      }
    },
    [],
  );

  const refresh = useCallback(
    async () => {
      warmupDeadlineByServerRef.current = {};
      startupMessagesByServerRef.current = {};
      await refreshInternal({ restartWarmup: true });
    },
    [refreshInternal],
  );

  useEffect(() => {
    if (!workspaceId || !enabled) {
      return;
    }

    warmupDeadlineByServerRef.current = {};
    startupMessagesByServerRef.current = {};
    void refreshInternal({ restartWarmup: true });
  }, [enabled, refreshInternal, workspaceId]);

  const hasStartingServers = state.servers.some(
    (server) => server.startupPhase === "starting",
  );

  useEffect(() => {
    if (!enabled || !workspaceId) {
      return;
    }

    if (!hasStartingServers) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void refreshInternal({ background: true });
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [enabled, hasStartingServers, refreshInternal, workspaceId]);

  useEffect(() => {
    if (!enabled || !workspaceId || !state.isSettling) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const now = Date.now();

      setState((current) => {
        if (!current.servers.some((server) => server.startupPhase === "starting")) {
          return current;
        }

        const { servers, hasStartingServers, warmupDeadlineByServer } =
          buildServerViewModels(
            current.servers,
            startupTimeoutsByServerRef.current,
            warmupDeadlineByServerRef.current,
            startupMessagesByServerRef.current,
            now,
            false,
          );

        const changed =
          current.isSettling !== hasStartingServers ||
          didStartupDisplayChange(current.servers, servers);

        if (!changed) {
          return current;
        }

        warmupDeadlineByServerRef.current = warmupDeadlineByServer;

        return {
          ...current,
          servers,
          isSettling: hasStartingServers,
        };
      });
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, state.isSettling, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !enabled) {
      return;
    }

    return subscribeAppServerEvents((payload) => {
      if (payload.workspace_id !== workspaceId) {
        return;
      }

      const method = getAppServerRawMethod(payload);
      if (method === "mcpServer/oauthLogin/completed") {
        const params = getAppServerParams(payload);
        const serverName = String(params.name ?? "").trim();
        const success = Boolean(params.success);
        const errorMessage = String(params.error ?? "").trim();

        setState((current) => {
          if (
            current.authenticatingServerName &&
            serverName &&
            current.authenticatingServerName !== serverName
          ) {
            return current;
          }

          return {
            ...current,
            authenticatingServerName: null,
            note: success
              ? null
              : errorMessage || `Unable to authenticate ${serverName || "MCP server"}.`,
          };
        });

        if (success) {
          delete warmupDeadlineByServerRef.current[serverName];
          delete startupMessagesByServerRef.current[serverName];
          void refreshInternal({ restartWarmup: true });
        }
        return;
      }

      if (method === "codex/stderr") {
        const params = getAppServerParams(payload);
        const rawMessage = String(params.message ?? "").trim();
        if (!rawMessage || !/mcp/i.test(rawMessage)) {
          return;
        }

        setState((current) => {
          const serverNames = current.servers.map((server) => server.name);
          const serverName = findMentionedServerName(rawMessage, serverNames);
          if (!serverName || !isTerminalStartupMessage(rawMessage)) {
            return current;
          }

          startupMessagesByServerRef.current[serverName] =
            normalizeStartupMessage(rawMessage);

          const now = Date.now();
          const { servers, hasStartingServers, warmupDeadlineByServer } =
            buildServerViewModels(
              current.servers,
              startupTimeoutsByServerRef.current,
              warmupDeadlineByServerRef.current,
              startupMessagesByServerRef.current,
              now,
              false,
            );
          warmupDeadlineByServerRef.current = warmupDeadlineByServer;

          return {
            ...current,
            servers,
            isSettling: hasStartingServers,
          };
        });
      }
    });
  }, [enabled, refreshInternal, workspaceId]);

  const startOAuthLogin = useCallback(
    async (serverName: string) => {
      if (!workspaceId || !enabled) {
        return;
      }

      setState((current) => ({
        ...current,
        authenticatingServerName: serverName,
        note: null,
      }));

      try {
        const { authUrl } = await mcpServerOAuthLogin(workspaceId, serverName);
        await openUrl(authUrl);
      } catch (error) {
        setState((current) => ({
          ...current,
          authenticatingServerName: null,
          note:
            error instanceof Error
              ? error.message
              : `Failed to start authentication for ${serverName}.`,
        }));
      }
    },
    [enabled, workspaceId],
  );

  return useMemo(
    () => ({
      ...state,
      refresh,
      startOAuthLogin,
    }),
    [refresh, startOAuthLogin, state],
  );
}
