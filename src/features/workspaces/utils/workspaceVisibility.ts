import type { WorkspaceInfo } from "../../../types";

export function isWorkspaceVisible(workspace: WorkspaceInfo) {
  return workspace.settings.hidden !== true;
}

export function filterVisibleConnectedWorkspaces(workspaces: WorkspaceInfo[]) {
  return workspaces.filter(
    (workspace) => workspace.connected && isWorkspaceVisible(workspace),
  );
}
