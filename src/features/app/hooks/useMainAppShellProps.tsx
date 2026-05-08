import { SidebarCollapseButton } from "@/features/layout/components/SidebarToggleControls";
import { useEffect, useState, type ComponentProps } from "react";
import { MainAppShell } from "@app/components/MainAppShell";

type UseMainAppShellPropsArgs = {
  shell: Pick<
    ComponentProps<typeof MainAppShell>,
    | "appClassName"
    | "isResizing"
    | "appStyle"
    | "appRef"
    | "sidebarToggleProps"
    | "shouldLoadGitHubPanelData"
    | "appModalsProps"
    | "showMobileSetupWizard"
    | "mobileSetupWizardProps"
  >;
  gitHubPanelDataProps: ComponentProps<typeof MainAppShell>["gitHubPanelDataProps"];
  appLayout: Omit<ComponentProps<typeof MainAppShell>["appLayoutProps"], "desktopTopbarLeftNode" | "topbarActionsNode">;
  topbar: {
    isCompact: boolean;
    desktopTopbarLeftNode: ComponentProps<typeof MainAppShell>["appLayoutProps"]["desktopTopbarLeftNode"];
    hasActiveWorkspace: boolean;
    backendMode: "local" | "remote";
    remoteThreadConnectionState: "live" | "polling" | "disconnected";
    activeThreadIsProcessing: boolean;
    activeThreadProcessingStartedAt: number | null;
  };
};

function formatWorkingDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function CompactWorkingIndicator({
  processingStartedAt,
}: {
  processingStartedAt: number | null;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!processingStartedAt) {
      setElapsedMs(0);
      return undefined;
    }

    setElapsedMs(Date.now() - processingStartedAt);
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - processingStartedAt);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [processingStartedAt]);

  return (
    <span
      className="compact-thread-working-indicator"
      role="timer"
      aria-label={`Active prompt running for ${formatWorkingDuration(elapsedMs)}`}
      title="Active prompt is still running"
    >
      <span className="working-spinner" aria-hidden />
      <span className="compact-thread-working-time">{formatWorkingDuration(elapsedMs)}</span>
      <span className="compact-thread-working-label">Working...</span>
    </span>
  );
}

export function useMainAppShellProps({
  shell,
  gitHubPanelDataProps,
  appLayout,
  topbar,
}: UseMainAppShellPropsArgs) {
  const showThreadConnectionIndicator =
    topbar.hasActiveWorkspace && topbar.backendMode === "remote";
  const topbarActionsNode = showThreadConnectionIndicator ? (
    <>
      {topbar.isCompact && topbar.activeThreadIsProcessing ? (
        <CompactWorkingIndicator
          processingStartedAt={topbar.activeThreadProcessingStartedAt}
        />
      ) : null}
      <span
        className={`compact-workspace-live-indicator ${
          topbar.remoteThreadConnectionState === "live"
            ? "is-live"
            : topbar.remoteThreadConnectionState === "polling"
              ? "is-polling"
              : "is-disconnected"
        }`}
        title={
          topbar.remoteThreadConnectionState === "live"
            ? "Receiving live thread events"
            : topbar.remoteThreadConnectionState === "polling"
              ? "Connected, syncing thread state by polling"
              : "Disconnected from backend"
        }
      >
        {topbar.remoteThreadConnectionState === "live"
          ? "Live"
          : topbar.remoteThreadConnectionState === "polling"
            ? "Polling"
            : "Disconnected"}
      </span>
    </>
  ) : null;

  const desktopTopbarLeftNodeWithToggle = !topbar.isCompact ? (
    <div className="topbar-leading">
      <SidebarCollapseButton {...shell.sidebarToggleProps} />
      {topbar.desktopTopbarLeftNode}
    </div>
  ) : (
    topbar.desktopTopbarLeftNode
  );

  return {
    ...shell,
    gitHubPanelDataProps,
    appLayoutProps: {
      ...appLayout,
      desktopTopbarLeftNode: desktopTopbarLeftNodeWithToggle,
      topbarActionsNode,
    },
  };
}
