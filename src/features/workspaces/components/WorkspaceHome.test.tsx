/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { WorkspaceHome } from "./WorkspaceHome";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
}));

vi.mock("../../../services/dragDrop", () => ({
  subscribeWindowDragDrop: vi.fn(() => () => {}),
}));

vi.mock("../../composer/hooks/useComposerImages", () => ({
  useComposerImages: () => ({
    activeImages: [],
    attachImages: vi.fn(),
    pickImages: vi.fn(),
    removeImage: vi.fn(),
    clearActiveImages: vi.fn(),
  }),
}));

vi.mock("../../composer/hooks/useComposerAutocompleteState", () => ({
  useComposerAutocompleteState: () => ({
    isAutocompleteOpen: false,
    autocompleteMatches: [],
    autocompleteAnchorIndex: null,
    highlightIndex: 0,
    setHighlightIndex: vi.fn(),
    applyAutocomplete: vi.fn(),
    handleInputKeyDown: vi.fn(),
    handleTextChange: vi.fn(),
    handleSelectionChange: vi.fn(),
    fileTriggerActive: false,
  }),
}));

vi.mock("../../composer/hooks/usePromptHistory", () => ({
  usePromptHistory: () => ({
    handleHistoryKeyDown: vi.fn(),
    handleHistoryTextChange: vi.fn(),
    recordHistory: vi.fn(),
    resetHistoryNavigation: vi.fn(),
  }),
}));

vi.mock("../../shared/components/FileEditorCard", () => ({
  FileEditorCard: () => <div data-testid="workspace-home-agent-md" />,
}));

vi.mock("./WorkspaceHomeRunControls", () => ({
  WorkspaceHomeRunControls: () => <div data-testid="workspace-home-run-controls" />,
}));

vi.mock("./WorkspaceHomeHistory", () => ({
  WorkspaceHomeHistory: () => <div data-testid="workspace-home-history" />,
}));

vi.mock("./WorkspaceHomeGitInitBanner", () => ({
  WorkspaceHomeGitInitBanner: () => <div data-testid="workspace-home-git-banner" />,
}));

vi.mock("../hooks/useWorkspaceHomeSuggestionsStyle", () => ({
  useWorkspaceHomeSuggestionsStyle: () => undefined,
}));

afterEach(() => {
  cleanup();
});

function buildWorkspace(
  threadColor: WorkspaceInfo["settings"]["threadColor"] = null,
): WorkspaceInfo {
  return {
    id: "workspace-1",
    name: "CodexMonitor",
    path: "/Volumes/localdev/ai/CodexMonitor",
    connected: true,
    kind: "main",
    parentId: null,
    worktree: null,
    settings: {
      sidebarCollapsed: false,
      threadColor,
    },
  };
}

function renderWorkspaceHome(
  options: {
    threadColor?: WorkspaceInfo["settings"]["threadColor"];
    onUpdateThreadColor?: (color: WorkspaceInfo["settings"]["threadColor"]) => Promise<void>;
    prompt?: string;
    onStartRun?: (images?: string[]) => Promise<boolean>;
  } = {},
) {
  const onUpdateThreadColor =
    options.onUpdateThreadColor ?? vi.fn().mockResolvedValue(undefined);
  const onStartRun = options.onStartRun ?? vi.fn().mockResolvedValue(false);

  render(
    <WorkspaceHome
      workspace={buildWorkspace(options.threadColor)}
      showGitInitBanner={false}
      initGitRepoLoading={false}
      onInitGitRepo={vi.fn()}
      runs={[]}
      recentThreadInstances={[]}
      recentThreadsUpdatedAt={null}
      prompt={options.prompt ?? ""}
      onPromptChange={vi.fn()}
      onStartRun={onStartRun}
      runMode="local"
      onRunModeChange={vi.fn()}
      models={[]}
      selectedModelSelectionMode="auto"
      selectedModelId={null}
      onSelectModel={vi.fn()}
      autoModelRoutingCredentialConfigured={true}
      onOpenAutoModelRoutingSettings={vi.fn()}
      modelSelections={{}}
      onToggleModel={vi.fn()}
      onModelCountChange={vi.fn()}
      collaborationModes={[]}
      selectedCollaborationModeId={null}
      onSelectCollaborationMode={vi.fn()}
      reasoningOptions={[]}
      selectedEffort={null}
      onSelectEffort={vi.fn()}
      reasoningSupported
      error={null}
      isSubmitting={false}
      activeWorkspaceId="workspace-1"
      activeThreadId={null}
      threadStatusById={{}}
      onSelectInstance={vi.fn()}
      skills={[]}
      appsEnabled={false}
      apps={[]}
      prompts={[]}
      files={[]}
      dictationEnabled={false}
      dictationState="idle"
      dictationLevel={0}
      onToggleDictation={vi.fn()}
      onCancelDictation={vi.fn()}
      onOpenDictationSettings={vi.fn()}
      dictationError={null}
      onDismissDictationError={vi.fn()}
      dictationHint={null}
      onDismissDictationHint={vi.fn()}
      dictationTranscript={null}
      onDictationTranscriptHandled={vi.fn()}
      agentMdContent=""
      agentMdExists
      agentMdTruncated={false}
      agentMdLoading={false}
      agentMdSaving={false}
      agentMdError={null}
      agentMdDirty={false}
      onAgentMdChange={vi.fn()}
      onAgentMdRefresh={vi.fn()}
      onAgentMdSave={vi.fn()}
      onUpdateThreadColor={onUpdateThreadColor}
    />,
  );

  return { onStartRun, onUpdateThreadColor };
}

describe("WorkspaceHome conversation color", () => {
  it("tints the workspace hero when a conversation color is assigned", () => {
    renderWorkspaceHome({ threadColor: "synthwave" });

    const hero = document.querySelector(".workspace-home-hero");
    expect(hero?.getAttribute("data-workspace-thread-color")).toBe("synthwave");
    expect(hero?.getAttribute("style")).toContain("--workspace-thread-tint-rgb: 244 114 182");
    expect(hero?.getAttribute("style")).toContain(
      "--workspace-thread-secondary-rgb: 125 211 252",
    );
  });

  it("updates the workspace color from an inline swatch", async () => {
    const { onUpdateThreadColor } = renderWorkspaceHome();

    fireEvent.click(screen.getByRole("button", { name: /violet/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /violet/i }).getAttribute("aria-pressed")).toBe(
        "true",
      );
    });

    await waitFor(() => {
      expect(onUpdateThreadColor).toHaveBeenCalledWith("violet");
    });
  });

  it("clears the current workspace color", async () => {
    const { onUpdateThreadColor } = renderWorkspaceHome({ threadColor: "amber" });

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));

    await waitFor(() => {
      expect(onUpdateThreadColor).toHaveBeenCalledWith(null);
    });
  });

  it("surfaces color save errors inline", async () => {
    const { onUpdateThreadColor } = renderWorkspaceHome({
      onUpdateThreadColor: vi.fn().mockRejectedValue(new Error("Failed to save color")),
    });

    fireEvent.click(screen.getByRole("button", { name: /green/i }));

    expect(await screen.findByText("Failed to save color")).toBeTruthy();
    expect(onUpdateThreadColor).toHaveBeenCalledWith("green");
  });

  it("submits the workspace prompt on desktop Enter", async () => {
    const onStartRun = vi.fn().mockResolvedValue(true);
    renderWorkspaceHome({
      prompt: "ship this",
      onStartRun,
    });

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    await waitFor(() => {
      expect(onStartRun).toHaveBeenCalledWith([]);
    });
  });
});
