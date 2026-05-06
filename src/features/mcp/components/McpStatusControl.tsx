import {
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
} from "react";
import Boxes from "lucide-react/dist/esm/icons/boxes";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Server from "lucide-react/dist/esm/icons/server";
import Wrench from "lucide-react/dist/esm/icons/wrench";
import { useMenuController } from "@app/hooks/useMenuController";
import {
  MenuTrigger,
  PopoverSurface,
} from "@/features/design-system/components/popover/PopoverPrimitives";
import type { McpStatusState } from "../types";

type McpStatusControlProps = {
  disabled: boolean;
  isPhone: boolean;
  status: McpStatusState;
};

const POPOVER_MARGIN = 12;
const POPOVER_GAP = 10;
const POPOVER_MAX_WIDTH = 420;
const POPOVER_MIN_HEIGHT = 180;

type PopoverPosition = {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
};

function buildCountLabel(status: McpStatusState) {
  if (status.isLoading && status.loadedAt === null) {
    return "MCP";
  }
  return status.totalServers > 0
    ? `MCP ${status.totalServers} / ${status.totalTools}`
    : "MCP 0";
}

function buildSubtitle(status: McpStatusState) {
  if (status.error) {
    return "Unable to load MCP status";
  }
  if (status.totalServers === 0) {
    return "No MCP servers loaded";
  }
  return `${status.totalServers} server${status.totalServers === 1 ? "" : "s"} / ${status.totalTools} tool${status.totalTools === 1 ? "" : "s"}`;
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
  const [popoverPosition, setPopoverPosition] =
    useState<PopoverPosition | null>(null);

  useLayoutEffect(() => {
    if (!menu.isOpen) {
      setPopoverPosition(null);
      return;
    }

    const updatePopoverPosition = () => {
      const anchor = menu.containerRef.current;
      if (!anchor) {
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(POPOVER_MAX_WIDTH, viewportWidth - POPOVER_MARGIN * 2);
      const left = Math.min(
        Math.max(rect.right - width, POPOVER_MARGIN),
        viewportWidth - width - POPOVER_MARGIN,
      );
      const availableAbove = rect.top - POPOVER_MARGIN - POPOVER_GAP;
      const availableBelow =
        viewportHeight - rect.bottom - POPOVER_MARGIN - POPOVER_GAP;

      if (availableAbove >= POPOVER_MIN_HEIGHT || availableAbove >= availableBelow) {
        setPopoverPosition({
          left,
          bottom: viewportHeight - rect.top + POPOVER_GAP,
          width,
          maxHeight: Math.max(POPOVER_MIN_HEIGHT, availableAbove),
        });
        return;
      }

      setPopoverPosition({
        left,
        top: rect.bottom + POPOVER_GAP,
        width,
        maxHeight: Math.max(POPOVER_MIN_HEIGHT, availableBelow),
      });
    };

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);

    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [menu.containerRef, menu.isOpen]);

  useEffect(() => {
    setExpandedServerName((current) =>
      current && status.servers.some((server) => server.name === current)
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
          <Boxes size={14} strokeWidth={1.8} />
        </span>
        <span className="composer-mcp-trigger-label">
          {buildCountLabel(status)}
        </span>
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
            style={
              popoverPosition
                ? ({
                    left: popoverPosition.left,
                    top: popoverPosition.top,
                    bottom: popoverPosition.bottom,
                    width: popoverPosition.width,
                    maxHeight: popoverPosition.maxHeight,
                  } satisfies CSSProperties)
                : undefined
            }
          >
            <div className="composer-mcp-header">
              <div>
                <div className="composer-mcp-title">MCP Servers</div>
                <div className="composer-mcp-subtitle">
                  {buildSubtitle(status)}
                </div>
              </div>
            </div>
            {status.error ? (
              <div className="composer-mcp-state composer-mcp-state--error">
                {status.error}
              </div>
            ) : status.isLoading && status.loadedAt === null ? (
              <div className="composer-mcp-state">Loading MCP servers...</div>
            ) : status.servers.length === 0 ? (
              <div className="composer-mcp-state">No MCP servers loaded.</div>
            ) : (
              <div className="composer-mcp-list" role="list">
                {status.servers.map((server) => {
                  const toolsPanelId = `mcp-tools-${server.name}`;
                  const isExpanded = expandedServerName === server.name;

                  return (
                    <div
                      key={server.name}
                      className="composer-mcp-row"
                      role="listitem"
                    >
                      <button
                        type="button"
                        className="composer-mcp-row-button"
                        aria-expanded={isExpanded}
                        aria-controls={toolsPanelId}
                        onClick={() =>
                          setExpandedServerName((current) =>
                            current === server.name ? null : server.name,
                          )
                        }
                      >
                        <span className="composer-mcp-row-main">
                          <span className="composer-mcp-row-title">
                            <span className="composer-mcp-row-icon" aria-hidden>
                              <Server size={14} strokeWidth={1.8} />
                            </span>
                            <span className="composer-mcp-row-name">
                              {server.name}
                            </span>
                          </span>
                          <span className="composer-mcp-row-meta">
                            {server.authStatus ? (
                              <span>{server.authStatus}</span>
                            ) : null}
                            {server.resourceCount > 0 ||
                            server.templateCount > 0 ? (
                              <span>
                                {server.resourceCount} resources,{" "}
                                {server.templateCount} templates
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span className="composer-mcp-row-actions">
                          <span className="composer-mcp-count">
                            <Wrench size={12} strokeWidth={1.8} aria-hidden />
                            <span>
                              {server.toolCount} tool
                              {server.toolCount === 1 ? "" : "s"}
                            </span>
                          </span>
                          <span className="composer-mcp-row-chevron" aria-hidden>
                            {isExpanded ? (
                              <ChevronDown size={14} strokeWidth={1.8} />
                            ) : (
                              <ChevronRight size={14} strokeWidth={1.8} />
                            )}
                          </span>
                        </span>
                      </button>
                      {isExpanded ? (
                        <div className="composer-mcp-tools" id={toolsPanelId}>
                          {server.toolNames.length > 0 ? (
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
                          ) : (
                            <div className="composer-mcp-tools-empty">
                              No tools reported.
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </PopoverSurface>
        </>
      ) : null}
    </div>
  );
}
