import { useEffect, useState } from "react";
import {
  getCodexConfigPath,
  readGlobalMcpConfigSummary,
} from "@services/tauri";

type McpConfigSummaryState = {
  configPath: string | null;
  configuredServerNames: Record<string, true> | null;
  startupTimeoutsByServer: Record<string, number>;
};

const EMPTY_CONFIG_SUMMARY: McpConfigSummaryState = {
  configPath: null,
  configuredServerNames: null,
  startupTimeoutsByServer: {},
};

function toConfiguredServerNameMap(
  serverNames: readonly string[],
): Record<string, true> {
  return Object.fromEntries(serverNames.map((serverName) => [serverName, true]));
}

export function useMcpConfigSummary(
  workspaceId: string | null,
  enabled: boolean,
): McpConfigSummaryState {
  const [state, setState] = useState<McpConfigSummaryState>(EMPTY_CONFIG_SUMMARY);

  useEffect(() => {
    if (!enabled || !workspaceId) {
      setState(EMPTY_CONFIG_SUMMARY);
      return;
    }

    let isCancelled = false;

    void getCodexConfigPath()
      .then((configPath) => {
        if (isCancelled) {
          return;
        }

        const trimmedPath = configPath.trim();
        setState((current) => ({
          ...current,
          configPath: trimmedPath.length > 0 ? trimmedPath : null,
        }));
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setState((current) => ({ ...current, configPath: null }));
      });

    void readGlobalMcpConfigSummary()
      .then((summary) => {
        if (isCancelled) {
          return;
        }

        setState((current) => ({
          ...current,
          configuredServerNames: toConfiguredServerNameMap(summary.configuredServerNames),
          startupTimeoutsByServer: summary.startupTimeoutsMs,
        }));
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setState((current) => ({
          ...current,
          configuredServerNames: null,
          startupTimeoutsByServer: {},
        }));
      });

    return () => {
      isCancelled = true;
    };
  }, [enabled, workspaceId]);

  return state;
}
