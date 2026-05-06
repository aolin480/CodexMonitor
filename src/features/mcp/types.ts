export type McpServerStatusVm = {
  name: string;
  authStatus: string | null;
  toolNames: string[];
  toolCount: number;
  resourceCount: number;
  templateCount: number;
};

export type McpStatusState = {
  servers: McpServerStatusVm[];
  totalServers: number;
  totalTools: number;
  isLoading: boolean;
  error: string | null;
  loadedAt: number | null;
};
