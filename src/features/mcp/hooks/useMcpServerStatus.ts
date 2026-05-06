import { useEffect, useState } from "react";
import { listMcpServerStatus } from "@services/tauri";
import type { McpStatusState } from "../types";
import { normalizeMcpServerStatus } from "../utils/normalizeMcpServerStatus";

const EMPTY_MCP_STATUS: McpStatusState = {
  servers: [],
  totalServers: 0,
  totalTools: 0,
  isLoading: false,
  error: null,
  loadedAt: null,
};

const mcpStatusByWorkspace = new Map<string, McpStatusState>();
const MCP_STATUS_CACHE_TTL_MS = 30_000;

export function useMcpServerStatus(workspaceId: string | null): McpStatusState {
  const [state, setState] = useState<McpStatusState>(EMPTY_MCP_STATUS);

  useEffect(() => {
    if (!workspaceId) {
      setState(EMPTY_MCP_STATUS);
      return;
    }

    const currentWorkspaceId = workspaceId;
    const cachedStatus = mcpStatusByWorkspace.get(currentWorkspaceId);
    if (
      cachedStatus &&
      cachedStatus.loadedAt !== null &&
      Date.now() - cachedStatus.loadedAt < MCP_STATUS_CACHE_TTL_MS
    ) {
      setState(cachedStatus);
      return;
    }

    let cancelled = false;
    setState({
      ...EMPTY_MCP_STATUS,
      isLoading: true,
    });

    async function loadMcpStatus() {
      try {
        const response = await listMcpServerStatus(currentWorkspaceId, null, null);
        if (cancelled) {
          return;
        }

        const servers = normalizeMcpServerStatus(response);
        const nextState: McpStatusState = {
          servers,
          totalServers: servers.length,
          totalTools: servers.reduce(
            (total, server) => total + server.toolCount,
            0,
          ),
          isLoading: false,
          error: null,
          loadedAt: Date.now(),
        };
        mcpStatusByWorkspace.set(currentWorkspaceId, nextState);
        setState(nextState);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({
          ...EMPTY_MCP_STATUS,
          error:
            error instanceof Error ? error.message : "Failed to load MCP servers.",
        });
      }
    }

    void loadMcpStatus();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return state;
}
