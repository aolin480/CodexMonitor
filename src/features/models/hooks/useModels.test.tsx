// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { getConfigModel, getModelList } from "../../../services/tauri";
import { useModels } from "./useModels";

vi.mock("../../../services/tauri", () => ({
  getModelList: vi.fn(),
  getConfigModel: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "CodexMonitor",
  path: "/tmp/codex",
  connected: true,
  settings: { sidebarCollapsed: false },
};

describe("useModels", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("adds the config model when it is missing from model/list", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "remote-1",
            model: "gpt-5.1",
            displayName: "GPT-5.1",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: null,
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.models.length).toBeGreaterThan(0));

    expect(getConfigModel).toHaveBeenCalledWith("workspace-1");
    expect(result.current.models[0]).toMatchObject({
      id: "custom-model",
      model: "custom-model",
    });
    expect(result.current.selectedModel?.model).toBe("custom-model");
    expect(result.current.reasoningSupported).toBe(false);
  });

  it("prefers the provider entry when the config model matches by slug", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "provider-id",
            model: "custom-model",
            displayName: "Provider Custom",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Medium" },
              { reasoningEffort: "high", description: "High" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: false,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.selectedModelId).toBe("provider-id"));

    expect(result.current.models).toHaveLength(1);
    expect(result.current.selectedModel?.id).toBe("provider-id");
    expect(result.current.reasoningSupported).toBe(true);
  });

  it("keeps the selected reasoning effort when switching models", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "remote-1",
            model: "gpt-5.1",
            displayName: "GPT-5.1",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "medium", description: "Medium" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.models.length).toBeGreaterThan(1));

    act(() => {
      result.current.setSelectedEffort("high");
      result.current.setSelectedModelId("custom-model");
    });

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("custom-model");
      expect(result.current.selectedEffort).toBe("high");
    });
  });

  it("keeps an explicit manual model selection across refreshes while auto mode is enabled", async () => {
    const response = {
      result: {
        data: [
          {
            id: "remote-1",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "medium", description: "Medium" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
          {
            id: "remote-2",
            model: "gpt-5.4-mini",
            displayName: "GPT-5.4 Mini",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "medium", description: "Medium" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: false,
          },
        ],
      },
    };
    vi.mocked(getModelList).mockResolvedValue(response);
    vi.mocked(getConfigModel).mockResolvedValue(null);

    const { result } = renderHook(() =>
      useModels({
        activeWorkspace: workspace,
        preferredModelSelectionMode: "auto",
      }),
    );

    await waitFor(() => {
      expect(result.current.models).toHaveLength(2);
      expect(result.current.selectedModelId).toBeNull();
    });

    act(() => {
      result.current.setSelectedModelId("remote-2");
    });

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("remote-2");
    });

    await act(async () => {
      await result.current.refreshModels();
    });

    expect(result.current.selectedModelId).toBe("remote-2");
  });

  it("keeps an explicit Auto selection on the first pick", async () => {
    vi.mocked(getModelList).mockResolvedValue({
      result: {
        data: [
          {
            id: "remote-1",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "medium", description: "Medium" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
          {
            id: "remote-2",
            model: "gpt-5.4-mini",
            displayName: "GPT-5.4 Mini",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "medium", description: "Medium" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: false,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValue(null);

    const { result } = renderHook(() =>
      useModels({
        activeWorkspace: workspace,
      }),
    );

    await waitFor(() => {
      expect(result.current.models).toHaveLength(2);
      expect(result.current.selectedModelId).toBe("remote-1");
    });

    act(() => {
      result.current.setSelectedModelId(null);
    });

    expect(result.current.selectedModelId).toBeNull();
  });

  it("resets local Auto state when the selection context changes to a manual preference", async () => {
    vi.mocked(getModelList).mockResolvedValue({
      result: {
        data: [
          {
            id: "remote-1",
            model: "gpt-5.4",
            displayName: "GPT-5.4",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "medium", description: "Medium" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
          {
            id: "remote-2",
            model: "gpt-5.4-mini",
            displayName: "GPT-5.4 Mini",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "medium", description: "Medium" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: false,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValue(null);

    const { result, rerender } = renderHook(
      (props: {
        selectionKey: string;
        preferredModelSelectionMode: "auto" | "manual";
        preferredModelId: string | null;
      }) =>
        useModels({
          activeWorkspace: workspace,
          selectionKey: props.selectionKey,
          preferredModelSelectionMode: props.preferredModelSelectionMode,
          preferredModelId: props.preferredModelId,
        }),
      {
        initialProps: {
          selectionKey: "scope-a",
          preferredModelSelectionMode: "manual" as const,
          preferredModelId: "remote-1",
        },
      },
    );

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("remote-1");
    });

    act(() => {
      result.current.setSelectedModelId(null);
    });

    expect(result.current.selectedModelSelectionMode).toBe("auto");
    expect(result.current.selectedModelId).toBeNull();

    rerender({
      selectionKey: "scope-b",
      preferredModelSelectionMode: "manual",
      preferredModelId: "remote-2",
    });

    await waitFor(() => {
      expect(result.current.selectedModelSelectionMode).toBe("manual");
      expect(result.current.selectedModelId).toBe("remote-2");
    });
  });
});
