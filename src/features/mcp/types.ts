export type McpServerToolErrorVm = {
  code: "hyphenated_name_no_tools";
  correctedName: string;
};

export type McpServerStartupPhase =
  | "starting"
  | "ready"
  | "needsAuth"
  | "error"
  | "zero";

export type McpServerStatusVm = {
  name: string;
  authStatusCode: string | null;
  authStatus: string | null;
  toolNames: string[];
  toolCount: number;
  resourceCount: number;
  templateCount: number;
  toolError: McpServerToolErrorVm | null;
  startupPhase: McpServerStartupPhase;
  startupTimeoutMs: number | null;
  startupProgress: number | null;
  startupRemainingSeconds: number | null;
  startupMessage: string | null;
};

export type McpStatusState = {
  servers: McpServerStatusVm[];
  totalServers: number;
  totalTools: number;
  configPath: string | null;
  authenticatingServerName: string | null;
  isLoading: boolean;
  isSettling: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
  note?: string | null;
};

export type McpStatusController = McpStatusState & {
  refresh: () => Promise<void>;
  startOAuthLogin: (serverName: string) => Promise<void>;
};
