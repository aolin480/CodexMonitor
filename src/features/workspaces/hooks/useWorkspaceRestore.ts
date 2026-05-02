import { useEffect, useRef } from "react";
import type { WorkspaceInfo } from "../../../types";
import { isWorkspaceVisible } from "../utils/workspaceVisibility";

const INITIAL_THREAD_LIST_FAST_MAX_PAGES = 1;
const INITIAL_THREAD_LIST_BACKGROUND_MAX_PAGES = 6;

type WorkspaceRestoreOptions = {
  workspaces: WorkspaceInfo[];
  hasLoaded: boolean;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  listThreadsForWorkspaces: (
    workspaces: WorkspaceInfo[],
    options?: { preserveState?: boolean; maxPages?: number },
  ) => Promise<void>;
};

export function useWorkspaceRestore({
  workspaces,
  hasLoaded,
  connectWorkspace,
  listThreadsForWorkspaces,
}: WorkspaceRestoreOptions) {
  const restoredWorkspaces = useRef(new Set<string>());

  useEffect(() => {
    if (!hasLoaded) {
      return;
    }
    const pending = workspaces.filter(
      (workspace) => !restoredWorkspaces.current.has(workspace.id),
    );
    if (pending.length === 0) {
      return;
    }
    pending.forEach((workspace) => {
      restoredWorkspaces.current.add(workspace.id);
    });
    void (async () => {
      const connectedResults = await Promise.all(
        pending.map(async (workspace) => {
          const wasConnected = workspace.connected;
          try {
            if (!wasConnected) {
              await connectWorkspace(workspace);
            }
            return { ...workspace, connected: true };
          } catch {
            // Silent: connection errors show in debug panel.
            return null;
          }
        }),
      );
      const connectedTargets = connectedResults.filter(
        (workspace): workspace is WorkspaceInfo => workspace !== null,
      );
      const visibleConnectedTargets = connectedTargets.filter(isWorkspaceVisible);
      if (visibleConnectedTargets.length > 0) {
        await listThreadsForWorkspaces(visibleConnectedTargets, {
          maxPages: INITIAL_THREAD_LIST_FAST_MAX_PAGES,
        });
        void listThreadsForWorkspaces(visibleConnectedTargets, {
          preserveState: true,
          maxPages: INITIAL_THREAD_LIST_BACKGROUND_MAX_PAGES,
        });
      }
    })();
  }, [connectWorkspace, hasLoaded, listThreadsForWorkspaces, workspaces]);
}
