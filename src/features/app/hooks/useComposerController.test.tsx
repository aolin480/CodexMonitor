/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComposerController } from "./useComposerController";

vi.mock("../../composer/hooks/useComposerImages", () => ({
  useComposerImages: vi.fn(() => ({
    activeImages: [],
    attachImages: vi.fn(),
    pickImages: vi.fn(),
    removeImage: vi.fn(),
    clearActiveImages: vi.fn(),
    setImagesForThread: vi.fn(),
    removeImagesForThread: vi.fn(),
  })),
}));

vi.mock("../../threads/hooks/useQueuedSend", () => ({
  useQueuedSend: vi.fn(() => ({
    activeQueue: [],
    handleSend: vi.fn(),
    queueMessage: vi.fn(),
    removeQueuedMessage: vi.fn(),
  })),
}));

const STORAGE_KEY = "codex-monitor-mobile-follow-up-behavior-by-thread";

function makeProps(overrides: Partial<Parameters<typeof useComposerController>[0]> = {}) {
  return {
    activeThreadId: "thread-1",
    activeTurnId: "turn-1",
    activeWorkspaceId: "workspace-a",
    activeWorkspace: {
      id: "workspace-a",
      name: "Workspace A",
      path: "/tmp/workspace-a",
      connected: true,
      settings: {
        sidebarCollapsed: false,
      },
    },
    selectedModelSelectionMode: "manual" as const,
    isProcessing: true,
    isReviewing: false,
    queueFlushPaused: false,
    steerEnabled: true,
    followUpMessageBehavior: "queue" as const,
    appsEnabled: true,
    connectWorkspace: vi.fn(),
    startThreadForWorkspace: vi.fn(),
    sendUserMessage: vi.fn(async () => ({ status: "sent" as const })),
    sendUserMessageToThread: vi.fn(),
    startFork: vi.fn(),
    startReview: vi.fn(),
    startResume: vi.fn(),
    startCompact: vi.fn(),
    startApps: vi.fn(),
    startMcp: vi.fn(),
    startFast: vi.fn(),
    startStatus: vi.fn(),
    ...overrides,
  };
}

describe("useComposerController mobile follow-up storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads mobile follow-up behavior only for the active workspace and thread", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "workspace-a::thread-1": {
          behavior: "steer",
          updatedAt: Date.now(),
        },
        "workspace-b::thread-1": {
          behavior: "queue",
          updatedAt: Date.now(),
        },
      }),
    );

    const { result } = renderHook(() => useComposerController(makeProps()));

    expect(result.current.activeMobileFollowUpBehavior).toBe("steer");
  });

  it("keeps other workspace entries when updating the active thread behavior", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "workspace-b::thread-9": {
          behavior: "steer",
          updatedAt: Date.now() - 1_000,
        },
      }),
    );

    const { result } = renderHook(() => useComposerController(makeProps()));

    act(() => {
      result.current.setMobileFollowUpBehavior("queue");
    });

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      "workspace-a::thread-1": {
        behavior: "queue",
      },
      "workspace-b::thread-9": {
        behavior: "steer",
      },
    });
  });

  it("rehydrates the scoped follow-up behavior when the active workspace changes", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "workspace-a::thread-1": {
          behavior: "queue",
          updatedAt: Date.now(),
        },
        "workspace-b::thread-1": {
          behavior: "steer",
          updatedAt: Date.now(),
        },
      }),
    );

    const { result, rerender } = renderHook(
      (props: ReturnType<typeof makeProps>) => useComposerController(props),
      {
        initialProps: makeProps(),
      },
    );

    expect(result.current.activeMobileFollowUpBehavior).toBe("queue");

    rerender(
      makeProps({
        activeWorkspaceId: "workspace-b",
        activeWorkspace: {
          id: "workspace-b",
          name: "Workspace B",
          path: "/tmp/workspace-b",
          connected: true,
          settings: {
            sidebarCollapsed: false,
          },
        },
      }),
    );

    expect(result.current.activeMobileFollowUpBehavior).toBe("steer");
  });

  it("promotes the active thread's legacy preference into workspace-scoped storage", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "thread-1": "steer",
        "thread-2": "queue",
      }),
    );

    const { result } = renderHook(() => useComposerController(makeProps()));

    expect(result.current.activeMobileFollowUpBehavior).toBe("steer");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      "workspace-a::thread-1": {
        behavior: "steer",
      },
      "thread-2": "queue",
    });
  });

  it("updates the active thread behavior in memory even if the workspace id is temporarily missing", () => {
    const { result } = renderHook(() =>
      useComposerController(
        makeProps({
          activeWorkspaceId: null,
          activeWorkspace: null,
        }),
      ),
    );

    act(() => {
      result.current.setMobileFollowUpBehavior("steer");
    });

    expect(result.current.activeMobileFollowUpBehavior).toBe("steer");
  });

  it("persists a pending behavior once the workspace id becomes available again", () => {
    const { result, rerender } = renderHook(
      (props: ReturnType<typeof makeProps>) => useComposerController(props),
      {
        initialProps: makeProps({
          activeWorkspaceId: null,
          activeWorkspace: null,
        }),
      },
    );

    act(() => {
      result.current.setMobileFollowUpBehavior("steer");
    });

    rerender(makeProps());

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      "workspace-a::thread-1": {
        behavior: "steer",
      },
    });
  });

  it("does not let a legacy value overwrite an existing scoped preference", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "thread-1": "queue",
        "workspace-a::thread-1": {
          behavior: "steer",
          updatedAt: Date.now(),
        },
      }),
    );

    const { result } = renderHook(() => useComposerController(makeProps()));

    expect(result.current.activeMobileFollowUpBehavior).toBe("steer");
  });
});
