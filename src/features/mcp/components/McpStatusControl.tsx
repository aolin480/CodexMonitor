import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import Boxes from "lucide-react/dist/esm/icons/boxes";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import CircleX from "lucide-react/dist/esm/icons/circle-x";
import LogIn from "lucide-react/dist/esm/icons/log-in";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Server from "lucide-react/dist/esm/icons/server";
import Wrench from "lucide-react/dist/esm/icons/wrench";
import { MenuTrigger, PopoverSurface } from "../../design-system/components/popover/PopoverPrimitives";
import { useMenuController } from "../../app/hooks/useMenuController";
import type { McpStatusController } from "../types";

type McpStatusControlProps = {
  disabled: boolean;
  isPhone: boolean;
  status: McpStatusController;
};

const FALLBACK_CONFIG_PATH = "~/.codex/config.toml";
const TOML_BARE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

function formatLastUpdated(lastUpdatedAt: number | null): string | null {
  if (!lastUpdatedAt) {
    return null;
  }
  const elapsedMs = Date.now() - lastUpdatedAt;
  if (elapsedMs < 60_000) {
    return "Updated just now";
  }
  const minutes = Math.round(elapsedMs / 60_000);
  return `Updated ${minutes}m ago`;
}

function buildToolErrorMessage(
  correctedName: string,
  configPath: string | null,
): string {
  const resolvedPath = configPath ?? FALLBACK_CONFIG_PATH;
  return [
    "Codex does not support hyphenated MCP server names.",
    `Rename this entry in config.toml using bracket syntax: ${buildConfigBlockHeader(correctedName)}`,
    `Config path: ${resolvedPath}`,
  ].join(" ");
}

function buildStartupMessage(
  serverName: string,
  startupTimeoutMs: number | null,
): string {
  const timeoutSeconds = Math.max(
    1,
    Math.round((startupTimeoutMs ?? 10_000) / 1000),
  );
  return `Server is starting. Waiting up to ${timeoutSeconds}s for tools from ${serverName}.`;
}

function buildConfigBlockHeader(serverName: string): string {
  const key = TOML_BARE_KEY_PATTERN.test(serverName)
    ? serverName
    : JSON.stringify(serverName);
  return `[mcp_servers.${key}]`;
}

function buildSuggestedConfigName(serverName: string): string | null {
  if (!serverName.includes("-")) {
    return null;
  }
  return serverName.replace(/-/g, "_");
}

function buildZeroToolsMessage(
  server: {
    name: string;
    hasMatchingConfigBlock: boolean | null;
  },
  startupMessage: string | null,
  configPath: string | null,
): string | null {
  if (!startupMessage) {
    return null;
  }

  const resolvedPath = configPath ?? FALLBACK_CONFIG_PATH;
  const guidance = [startupMessage];

  if (server.hasMatchingConfigBlock) {
    guidance.push(
      `The configured block header already matches this server: ${buildConfigBlockHeader(server.name)}`,
      `If this server requires authentication, run \`codex mcp login ${server.name}\` in Terminal. Otherwise, the server may be misconfigured or failing to report tools.`,
      `Config path: ${resolvedPath}`,
    );
    return guidance.join(" ");
  }

  if (server.hasMatchingConfigBlock === false) {
    const suggestedConfigName = buildSuggestedConfigName(server.name);
    guidance.push(
      "If this server should expose tools, rename the actual MCP config block header so it matches the server's MCP namespace exactly.",
      `Expected block header: ${buildConfigBlockHeader(server.name)}`,
    );
    if (suggestedConfigName && suggestedConfigName !== server.name) {
      guidance.push(
        `Suggested block header: ${buildConfigBlockHeader(suggestedConfigName)}`,
      );
    }
    guidance.push(
      "Update the block header itself in config.toml, not the command or directory path.",
      `Config path: ${resolvedPath}`,
    );
    return guidance.join(" ");
  }

  guidance.push(
    `Check the MCP config block header for this server in config.toml: ${buildConfigBlockHeader(server.name)}`,
    `If that block header already matches, try \`codex mcp login ${server.name}\` or verify the server configuration.`,
    `Config path: ${resolvedPath}`,
  );

  return guidance.join(" ");
}

export function McpStatusControl({
  disabled,
  isPhone,
  status,
}: McpStatusControlProps) {
  const menu = useMenuController();
  const [expandedServerName, setExpandedServerName] = useState<string | null>(
    null,
  );
  const hasServers = status.totalServers > 0;
  const countLabel = hasServers
    ? `MCP ${status.totalServers} \u2022 ${status.totalTools}`
    : "MCP 0";
  const subtitle = useMemo(
    () =>
      hasServers
        ? `${status.totalServers} server${status.totalServers === 1 ? "" : "s"} \u2022 ${status.totalTools} tool${status.totalTools === 1 ? "" : "s"}`
        : "No MCP servers available",
    [hasServers, status.totalServers, status.totalTools],
  );
  const updatedLabel = formatLastUpdated(status.lastUpdatedAt);

  useEffect(() => {
    if (status.servers.length === 0) {
      setExpandedServerName(null);
      return;
    }
    setExpandedServerName((current) =>
      current &&
      status.servers.some((server) => server.name === current && server.startupPhase === "ready")
        ? current
        : null,
    );
  }, [status.servers]);

  return (
    <div
      className={`composer-mcp-menu${menu.isOpen ? " is-open" : ""}`}
      ref={menu.containerRef}
    >
      <MenuTrigger
        isOpen={menu.isOpen}
        popupRole="dialog"
        className="ghost composer-select-wrap composer-mcp-trigger"
        activeClassName="is-open"
        onClick={menu.toggle}
        aria-label="MCP servers"
        disabled={disabled}
      >
        <span className="composer-icon composer-icon--mcp" aria-hidden>
          {status.isLoading && status.lastUpdatedAt === null ? (
            <RefreshCw
              size={14}
              strokeWidth={1.8}
              className="composer-mcp-sync-icon spinning"
            />
          ) : (
            <Boxes size={14} strokeWidth={1.8} />
          )}
        </span>
        <span className="composer-mcp-trigger-label">{countLabel}</span>
      </MenuTrigger>
      {menu.isOpen ? (
        <>
          {isPhone ? (
            <button
              type="button"
              className="composer-mcp-backdrop"
              aria-label="Close MCP servers"
              onClick={menu.close}
            />
          ) : null}
          <PopoverSurface
            className={`composer-mcp-popover${isPhone ? " is-phone" : ""}`}
            role="dialog"
          >
            <div className="composer-mcp-header">
              <div>
                <div className="composer-mcp-title">MCP Servers</div>
                <div className="composer-mcp-subtitle">{subtitle}</div>
              </div>
              <button
                type="button"
                className="ghost composer-mcp-refresh"
                onClick={() => {
                  void status.refresh();
                }}
                disabled={status.isLoading || status.isSettling}
                aria-label="Refresh MCP servers"
                title="Refresh MCP servers"
              >
                <RefreshCw
                  size={14}
                  strokeWidth={1.8}
                  className={status.isLoading || status.isSettling ? "is-spinning" : ""}
                />
              </button>
            </div>
            {status.error ? (
              <div className="composer-mcp-state composer-mcp-state--error">
                {status.error}
              </div>
            ) : status.isLoading && status.lastUpdatedAt === null ? (
              <div className="composer-mcp-state">Loading MCP servers…</div>
            ) : status.servers.length === 0 ? (
              <div className="composer-mcp-state">No MCP servers available.</div>
            ) : (
              <div className="composer-mcp-list" role="list">
                {status.servers.map((server) => {
                  const needsOAuthLogin = server.startupPhase === "needsAuth";
                  const isStarting = server.startupPhase === "starting";
                  const canExpand = server.startupPhase === "ready";
                  const toolsPanelId = `mcp-tools-${server.name}`;
                  const zeroToolsMessage = buildZeroToolsMessage(
                    server,
                    server.startupMessage,
                    status.configPath,
                  );
                  const startupChipStyle = {
                    "--composer-mcp-start-progress": `${Math.round(
                      (server.startupProgress ?? 0) * 100,
                    )}%`,
                  } as CSSProperties;

                  return (
                    <div key={server.name} className="composer-mcp-row" role="listitem">
                      <div
                        className={`composer-mcp-row-button${canExpand ? "" : " is-static"}`}
                        aria-expanded={
                          canExpand ? expandedServerName === server.name : undefined
                        }
                        aria-controls={canExpand ? toolsPanelId : undefined}
                        role={canExpand ? "button" : undefined}
                        tabIndex={canExpand ? 0 : undefined}
                        onClick={
                          canExpand
                            ? () =>
                                setExpandedServerName((current) =>
                                  current === server.name ? null : server.name,
                                )
                            : undefined
                        }
                        onKeyDown={
                          canExpand
                            ? (event) => {
                                if (event.key !== "Enter" && event.key !== " ") {
                                  return;
                                }
                                event.preventDefault();
                                setExpandedServerName((current) =>
                                  current === server.name ? null : server.name,
                                );
                              }
                            : undefined
                        }
                      >
                        <div className="composer-mcp-row-main">
                          <div className="composer-mcp-row-title">
                            <span className="composer-mcp-row-icon" aria-hidden>
                              <Server size={14} strokeWidth={1.8} />
                            </span>
                            <span className="composer-mcp-row-name">{server.name}</span>
                          </div>
                          <div className="composer-mcp-row-meta">
                            {server.authStatus ? (
                              <span className="composer-mcp-auth">
                                {server.authStatus}
                              </span>
                            ) : null}
                            {server.resourceCount > 0 || server.templateCount > 0 ? (
                              <span className="composer-mcp-resources">
                                {server.resourceCount} resources, {server.templateCount} templates
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="composer-mcp-row-actions">
                          {server.toolError ? (
                            <div
                              className="composer-mcp-count composer-mcp-count--error ds-tooltip-trigger"
                              title={buildToolErrorMessage(
                                server.toolError.correctedName,
                                status.configPath,
                              )}
                              data-tooltip={buildToolErrorMessage(
                                server.toolError.correctedName,
                                status.configPath,
                              )}
                              data-tooltip-align="end"
                              aria-label={buildToolErrorMessage(
                                server.toolError.correctedName,
                                status.configPath,
                              )}
                            >
                              <CircleX size={12} strokeWidth={1.9} aria-hidden />
                              <span>Error</span>
                            </div>
                          ) : isStarting ? (
                            <div
                              className="composer-mcp-count composer-mcp-count--starting ds-tooltip-trigger"
                              style={startupChipStyle}
                              title={buildStartupMessage(
                                server.name,
                                server.startupTimeoutMs,
                              )}
                              data-tooltip={buildStartupMessage(
                                server.name,
                                server.startupTimeoutMs,
                              )}
                              data-tooltip-align="end"
                              aria-live="polite"
                            >
                              <span>Starting…</span>
                              {server.startupRemainingSeconds !== null ? (
                                <span className="composer-mcp-count-secondary">
                                  {server.startupRemainingSeconds}s
                                </span>
                              ) : null}
                            </div>
                          ) : needsOAuthLogin ? (
                            <button
                              type="button"
                              className="composer-mcp-count composer-mcp-count--action"
                              onClick={() => {
                                void status.startOAuthLogin(server.name);
                              }}
                              disabled={
                                status.isLoading ||
                                status.authenticatingServerName === server.name
                              }
                            >
                              <LogIn size={12} strokeWidth={1.9} aria-hidden />
                              <span>
                                {status.authenticatingServerName === server.name
                                  ? "Signing In"
                                  : "Sign In"}
                              </span>
                            </button>
                          ) : (
                            <div
                              className={`composer-mcp-count${zeroToolsMessage ? " composer-mcp-count--warning ds-tooltip-trigger" : ""}`}
                              title={zeroToolsMessage ?? undefined}
                              data-tooltip={zeroToolsMessage ?? undefined}
                              data-tooltip-align={zeroToolsMessage ? "end" : undefined}
                              aria-label={zeroToolsMessage ?? undefined}
                            >
                              <Wrench size={12} strokeWidth={1.8} aria-hidden />
                              <span>
                                {server.toolCount} tool{server.toolCount === 1 ? "" : "s"}
                              </span>
                            </div>
                          )}
                          <span className="composer-mcp-row-expand-slot" aria-hidden="true">
                            {canExpand ? (
                              <span className="composer-mcp-row-chevron">
                                {expandedServerName === server.name ? (
                                  <ChevronDown size={14} strokeWidth={1.8} />
                                ) : (
                                  <ChevronRight size={14} strokeWidth={1.8} />
                                )}
                              </span>
                            ) : (
                              <span className="composer-mcp-row-expand-placeholder" />
                            )}
                          </span>
                        </div>
                      </div>
                      {expandedServerName === server.name && canExpand ? (
                        <div className="composer-mcp-tools" id={toolsPanelId}>
                          <div className="composer-mcp-tools-label">Available tools</div>
                          <div className="composer-mcp-tool-grid">
                            {server.toolNames.map((toolName) => (
                              <span
                                key={`${server.name}-${toolName}`}
                                className="composer-mcp-tool-chip"
                              >
                                {toolName}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            {status.note || updatedLabel ? (
              <div className="composer-mcp-footer">
                {status.note ? <span>{status.note}</span> : null}
                {updatedLabel ? <span>{updatedLabel}</span> : null}
              </div>
            ) : null}
          </PopoverSurface>
        </>
      ) : null}
    </div>
  );
}
