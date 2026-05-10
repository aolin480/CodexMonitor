import { describe, expect, it } from "vitest";
import type { ConversationItem, ThreadSummary } from "@/types";
import { initialState, threadReducer } from "./useThreadsReducer";
import type { ThreadState } from "./useThreadsReducer";

describe("threadReducer", () => {
  it("ensures thread with default name and active selection", () => {
    const next = threadReducer(initialState, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
    });
    const threads = next.threadsByWorkspace["ws-1"] ?? [];
    expect(threads).toHaveLength(1);
    expect(threads[0].name).toBe("New Agent");
    expect(next.activeThreadIdByWorkspace["ws-1"]).toBe("thread-1");
    expect(next.threadStatusById["thread-1"]?.isProcessing).toBe(false);
  });

  it("renames auto-generated thread on first user message", () => {
    const threads: ThreadSummary[] = [
      { id: "thread-1", name: "New Agent", updatedAt: 1 },
    ];
    const next = threadReducer(
      {
        ...initialState,
        threadsByWorkspace: { "ws-1": threads },
      },
      {
        type: "upsertItem",
        workspaceId: "ws-1",
        threadId: "thread-1",
        item: {
          id: "user-1",
          kind: "message",
          role: "user",
          text: "Hello there",
        },
        hasCustomName: false,
      },
    );
    expect(next.threadsByWorkspace["ws-1"]?.[0]?.name).toBe("Hello there");
    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(1);
    if (items[0]?.kind === "message") {
      expect(items[0].id).toBe("user-1");
      expect(items[0].text).toBe("Hello there");
    }
  });

  it("renames auto-generated thread from assistant output when no user message", () => {
    const threads: ThreadSummary[] = [
      { id: "thread-1", name: "New Agent", updatedAt: 1 },
    ];
    const next = threadReducer(
      {
        ...initialState,
        threadsByWorkspace: { "ws-1": threads },
        itemsByThread: { "thread-1": [] },
      },
      {
        type: "appendAgentDelta",
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        delta: "Assistant note",
        hasCustomName: false,
      },
    );
    expect(next.threadsByWorkspace["ws-1"]?.[0]?.name).toBe("Assistant note");
  });

  it("updates thread timestamp when newer activity arrives", () => {
    const threads: ThreadSummary[] = [
      { id: "thread-1", name: "Agent 1", updatedAt: 1000 },
    ];
    const next = threadReducer(
      {
        ...initialState,
        threadsByWorkspace: { "ws-1": threads },
      },
      {
        type: "setThreadTimestamp",
        workspaceId: "ws-1",
        threadId: "thread-1",
        timestamp: 1500,
      },
    );
    expect(next.threadsByWorkspace["ws-1"]?.[0]?.updatedAt).toBe(1500);
  });

  it("moves active thread to top on timestamp updates when sorted by updated_at", () => {
    const threads: ThreadSummary[] = [
      { id: "thread-1", name: "Agent 1", updatedAt: 1000 },
      { id: "thread-2", name: "Agent 2", updatedAt: 900 },
    ];
    const next = threadReducer(
      {
        ...initialState,
        threadsByWorkspace: { "ws-1": threads },
        threadSortKeyByWorkspace: { "ws-1": "updated_at" },
      },
      {
        type: "setThreadTimestamp",
        workspaceId: "ws-1",
        threadId: "thread-2",
        timestamp: 1500,
      },
    );
    expect(next.threadsByWorkspace["ws-1"]?.map((thread) => thread.id)).toEqual([
      "thread-2",
      "thread-1",
    ]);
  });

  it("keeps ordering stable on timestamp updates when sorted by created_at", () => {
    const threads: ThreadSummary[] = [
      { id: "thread-1", name: "Agent 1", updatedAt: 1000 },
      { id: "thread-2", name: "Agent 2", updatedAt: 900 },
    ];
    const next = threadReducer(
      {
        ...initialState,
        threadsByWorkspace: { "ws-1": threads },
        threadSortKeyByWorkspace: { "ws-1": "created_at" },
      },
      {
        type: "setThreadTimestamp",
        workspaceId: "ws-1",
        threadId: "thread-2",
        timestamp: 1500,
      },
    );
    expect(next.threadsByWorkspace["ws-1"]?.map((thread) => thread.id)).toEqual([
      "thread-1",
      "thread-2",
    ]);
  });

  it("does not churn state for unchanged thread names", () => {
    const base = {
      ...initialState,
      threadsByWorkspace: {
        "ws-1": [{ id: "thread-1", name: "Agent 1", updatedAt: 1000 }],
      },
    };

    expect(
      threadReducer(base, {
        type: "setThreadName",
        workspaceId: "ws-1",
        threadId: "thread-1",
        name: "Agent 1",
      }),
    ).toBe(base);
  });

  it("tracks processing durations", () => {
    const started = threadReducer(
      {
        ...initialState,
        threadStatusById: {
          "thread-1": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
            processingStartedAt: null,
            lastDurationMs: null,
          },
        },
      },
      {
        type: "markProcessing",
        threadId: "thread-1",
        isProcessing: true,
        timestamp: 1000,
      },
    );
    const stopped = threadReducer(started, {
      type: "markProcessing",
      threadId: "thread-1",
      isProcessing: false,
      timestamp: 1600,
    });
    expect(stopped.threadStatusById["thread-1"]?.lastDurationMs).toBe(600);
  });

  it("does not churn state for repeated processing=true updates", () => {
    const processingState = threadReducer(
      {
        ...initialState,
        threadStatusById: {
          "thread-1": {
            isProcessing: true,
            hasUnread: false,
            isReviewing: false,
            processingStartedAt: 1000,
            lastDurationMs: null,
          },
        },
      },
      {
        type: "markProcessing",
        threadId: "thread-1",
        isProcessing: true,
        timestamp: 1200,
      },
    );

    expect(processingState).toBe(
      threadReducer(processingState, {
        type: "markProcessing",
        threadId: "thread-1",
        isProcessing: true,
        timestamp: 1400,
      }),
    );
  });

  it("does not churn state for unchanged unread/review flags", () => {
    const base = {
      ...initialState,
      threadStatusById: {
        "thread-1": {
          isProcessing: false,
          hasUnread: true,
          isReviewing: true,
          processingStartedAt: null,
          lastDurationMs: 300,
        },
      },
    };

    const unread = threadReducer(base, {
      type: "markUnread",
      threadId: "thread-1",
      hasUnread: true,
    });
    expect(unread).toBe(base);

    const reviewing = threadReducer(base, {
      type: "markReviewing",
      threadId: "thread-1",
      isReviewing: true,
    });
    expect(reviewing).toBe(base);
  });

  it("tracks request user input queue", () => {
    const request = {
      workspace_id: "ws-1",
      request_id: 99,
      params: {
        thread_id: "thread-1",
        turn_id: "turn-1",
        item_id: "call-1",
        questions: [{ id: "q1", header: "Confirm", question: "Proceed?" }],
      },
    };
    const added = threadReducer(initialState, {
      type: "addUserInputRequest",
      request,
    });
    expect(added.userInputRequests).toHaveLength(1);
    expect(added.userInputRequests[0]).toEqual(request);

    const removed = threadReducer(added, {
      type: "removeUserInputRequest",
      requestId: 99,
      workspaceId: "ws-1",
    });
    expect(removed.userInputRequests).toHaveLength(0);
  });

  it("drops local review-start items when server review starts", () => {
    const localReview: ConversationItem = {
      id: "review-start-1",
      kind: "review",
      state: "started",
      text: "",
    };
    const incomingReview: ConversationItem = {
      id: "remote-review-1",
      kind: "review",
      state: "started",
      text: "",
    };
    const next = threadReducer(
      {
        ...initialState,
        itemsByThread: { "thread-1": [localReview] },
      },
      {
        type: "upsertItem",
        workspaceId: "ws-1",
        threadId: "thread-1",
        item: incomingReview,
      },
    );
    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("remote-review-1");
  });

  it("appends review items when ids repeat", () => {
    const firstReview: ConversationItem = {
      id: "review-mode",
      kind: "review",
      state: "started",
      text: "Reviewing changes",
    };
    const next = threadReducer(
      {
        ...initialState,
        itemsByThread: { "thread-1": [firstReview] },
      },
      {
        type: "upsertItem",
        workspaceId: "ws-1",
        threadId: "thread-1",
        item: {
          id: "review-mode",
          kind: "review",
          state: "completed",
          text: "Reviewing changes",
        },
      },
    );
    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe("review-mode");
    expect(items[1]?.id).toBe("review-mode-1");
  });

  it("ignores duplicate review items with identical id, state, and text", () => {
    const firstReview: ConversationItem = {
      id: "review-mode",
      kind: "review",
      state: "started",
      text: "Reviewing changes",
    };
    const next = threadReducer(
      {
        ...initialState,
        itemsByThread: { "thread-1": [firstReview] },
      },
      {
        type: "upsertItem",
        workspaceId: "ws-1",
        threadId: "thread-1",
        item: {
          id: "review-mode",
          kind: "review",
          state: "started",
          text: "Reviewing changes",
        },
      },
    );
    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("review-mode");
  });

  it("dedupes review items with identical content", () => {
    const firstReview: ConversationItem = {
      id: "review-mode",
      kind: "review",
      state: "completed",
      text: "Reviewing changes",
    };
    const next = threadReducer(
      {
        ...initialState,
        itemsByThread: { "thread-1": [firstReview] },
      },
      {
        type: "upsertItem",
        workspaceId: "ws-1",
        threadId: "thread-1",
        item: {
          id: "review-mode-duplicate",
          kind: "review",
          state: "completed",
          text: "Reviewing changes",
        },
      },
    );
    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("review-mode");
  });

  it("creates and appends plan deltas when no plan tool item exists", () => {
    const next = threadReducer(initialState, {
      type: "appendPlanDelta",
      threadId: "thread-1",
      itemId: "plan-1",
      delta: "- Step 1",
    });
    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "plan-1",
      kind: "tool",
      toolType: "plan",
      title: "Plan",
      output: "- Step 1",
    });
  });

  it("appends reasoning summary and content when missing", () => {
    const withSummary = threadReducer(initialState, {
      type: "appendReasoningSummary",
      threadId: "thread-1",
      itemId: "reasoning-1",
      delta: "Short plan",
    });
    const summaryItem = withSummary.itemsByThread["thread-1"]?.[0];
    expect(summaryItem?.kind).toBe("reasoning");
    if (summaryItem?.kind === "reasoning") {
      expect(summaryItem.summary).toBe("Short plan");
      expect(summaryItem.content).toBe("");
    }

    const withContent = threadReducer(withSummary, {
      type: "appendReasoningContent",
      threadId: "thread-1",
      itemId: "reasoning-1",
      delta: "More detail",
    });
    const contentItem = withContent.itemsByThread["thread-1"]?.[0];
    expect(contentItem?.kind).toBe("reasoning");
    if (contentItem?.kind === "reasoning") {
      expect(contentItem.summary).toBe("Short plan");
      expect(contentItem.content).toBe("More detail");
    }
  });

  it("inserts a reasoning summary boundary between sections", () => {
    const withSummary = threadReducer(initialState, {
      type: "appendReasoningSummary",
      threadId: "thread-1",
      itemId: "reasoning-1",
      delta: "Exploring files",
    });
    const withBoundary = threadReducer(withSummary, {
      type: "appendReasoningSummaryBoundary",
      threadId: "thread-1",
      itemId: "reasoning-1",
    });
    const withSecondSummary = threadReducer(withBoundary, {
      type: "appendReasoningSummary",
      threadId: "thread-1",
      itemId: "reasoning-1",
      delta: "Searching for routes",
    });

    const item = withSecondSummary.itemsByThread["thread-1"]?.[0];
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.summary).toBe("Exploring files\n\nSearching for routes");
    }
  });

  it("ignores tool output deltas when the item is not a tool", () => {
    const message: ConversationItem = {
      id: "tool-1",
      kind: "message",
      role: "assistant",
      text: "Hi",
    };
    const base: ThreadState = {
      ...initialState,
      itemsByThread: { "thread-1": [message] },
    };
    const next = threadReducer(base, {
      type: "appendToolOutput",
      threadId: "thread-1",
      itemId: "tool-1",
      delta: "delta",
    });
    expect(next).toBe(base);
  });

  it("adds and removes user input requests by workspace and id", () => {
    const requestA = {
      workspace_id: "ws-1",
      request_id: 1,
      params: {
        thread_id: "thread-1",
        turn_id: "turn-1",
        item_id: "item-1",
        questions: [],
      },
    };
    const requestB = {
      workspace_id: "ws-2",
      request_id: 1,
      params: {
        thread_id: "thread-2",
        turn_id: "turn-2",
        item_id: "item-2",
        questions: [],
      },
    };

    const added = threadReducer(initialState, {
      type: "addUserInputRequest",
      request: requestA,
    });
    expect(added.userInputRequests).toEqual([requestA]);

    const deduped = threadReducer(added, {
      type: "addUserInputRequest",
      request: requestA,
    });
    expect(deduped.userInputRequests).toHaveLength(1);

    const withSecond = threadReducer(added, {
      type: "addUserInputRequest",
      request: requestB,
    });
    expect(withSecond.userInputRequests).toHaveLength(2);

    const removed = threadReducer(withSecond, {
      type: "removeUserInputRequest",
      requestId: 1,
      workspaceId: "ws-1",
    });
    expect(removed.userInputRequests).toEqual([requestB]);
  });

  it("stores turn diff updates by thread id", () => {
    const next = threadReducer(initialState, {
      type: "setThreadTurnDiff",
      threadId: "thread-1",
      diff: "diff --git a/file.ts b/file.ts",
    });

    expect(next.turnDiffByThread["thread-1"]).toBe(
      "diff --git a/file.ts b/file.ts",
    );
  });

  it("clears turn diff state when a thread is removed", () => {
    const base: ThreadState = {
      ...initialState,
      threadsByWorkspace: {
        "ws-1": [{ id: "thread-1", name: "Agent 1", updatedAt: 1 }],
      },
      activeThreadIdByWorkspace: { "ws-1": "thread-1" },
      turnDiffByThread: { "thread-1": "diff --git a/file.ts b/file.ts" },
    };

    const next = threadReducer(base, {
      type: "removeThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
    });

    expect(next.turnDiffByThread["thread-1"]).toBeUndefined();
  });

  it("hides background threads and keeps them hidden on future syncs", () => {
    const withThread = threadReducer(initialState, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-bg",
    });
    expect(withThread.threadsByWorkspace["ws-1"]?.some((t) => t.id === "thread-bg")).toBe(true);

    const hidden = threadReducer(withThread, {
      type: "hideThread",
      workspaceId: "ws-1",
      threadId: "thread-bg",
    });
    expect(hidden.threadsByWorkspace["ws-1"]?.some((t) => t.id === "thread-bg")).toBe(false);

    const synced = threadReducer(hidden, {
      type: "setThreads",
      workspaceId: "ws-1",
      sortKey: "updated_at",
      threads: [
        { id: "thread-bg", name: "Agent 1", updatedAt: Date.now() },
        { id: "thread-visible", name: "Agent 2", updatedAt: Date.now() },
      ],
    });
    const ids = synced.threadsByWorkspace["ws-1"]?.map((t) => t.id) ?? [];
    expect(ids).toContain("thread-visible");
    expect(ids).not.toContain("thread-bg");
  });

  it("preserves active, processing, and ancestor anchors on partial setThreads payloads", () => {
    const base: ThreadState = {
      ...initialState,
      threadsByWorkspace: {
        "ws-1": [
          { id: "thread-parent", name: "Parent (stale)", updatedAt: 10 },
          { id: "thread-child", name: "Child (stale)", updatedAt: 11 },
          { id: "thread-active", name: "Active", updatedAt: 12 },
          { id: "thread-processing", name: "Processing", updatedAt: 13 },
        ],
      },
      activeThreadIdByWorkspace: { "ws-1": "thread-active" },
      threadParentById: {
        "thread-child": "thread-parent",
      },
      threadStatusById: {
        "thread-processing": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: null,
          lastDurationMs: null,
        },
      },
      lastAgentMessageByThread: {
        "thread-parent": {
          text: "Parent fresh preview",
          timestamp: 300,
        },
      },
    };

    const next = threadReducer(base, {
      type: "setThreads",
      workspaceId: "ws-1",
      sortKey: "updated_at",
      preserveAnchors: true,
      threads: [
        { id: "thread-child", name: "Child (fresh)", updatedAt: 200 },
        { id: "thread-new", name: "New", updatedAt: 199 },
      ],
    });

    expect(next.threadsByWorkspace["ws-1"]?.map((thread) => thread.id)).toEqual([
      "thread-child",
      "thread-new",
      "thread-active",
      "thread-processing",
      "thread-parent",
    ]);
    expect(
      next.threadsByWorkspace["ws-1"]?.find((thread) => thread.id === "thread-child")
        ?.name,
    ).toBe("Child (fresh)");
    expect(
      next.threadsByWorkspace["ws-1"]?.find((thread) => thread.id === "thread-parent")
        ?.updatedAt,
    ).toBe(300);
  });

  it("keeps existing sidebar order during preserve-state thread refreshes", () => {
    const base: ThreadState = {
      ...initialState,
      threadsByWorkspace: {
        "ws-1": [
          { id: "thread-a", name: "A", updatedAt: 100 },
          { id: "thread-b", name: "B", updatedAt: 90 },
          { id: "thread-c", name: "C", updatedAt: 80 },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "setThreads",
      workspaceId: "ws-1",
      sortKey: "updated_at",
      preserveAnchors: true,
      threads: [
        { id: "thread-c", name: "C fresh", updatedAt: 300 },
        { id: "thread-a", name: "A fresh", updatedAt: 200 },
        { id: "thread-new", name: "New", updatedAt: 150 },
      ],
    });

    expect(next.threadsByWorkspace["ws-1"]?.map((thread) => thread.id)).toEqual([
      "thread-a",
      "thread-c",
      "thread-new",
    ]);
    expect(next.threadsByWorkspace["ws-1"]?.[0]?.name).toBe("A fresh");
    expect(next.threadsByWorkspace["ws-1"]?.[1]?.name).toBe("C fresh");
  });

  it("does not resurrect hidden anchors on partial setThreads payloads", () => {
    const base: ThreadState = {
      ...initialState,
      threadsByWorkspace: {
        "ws-1": [
          { id: "thread-parent", name: "Parent", updatedAt: 10 },
          { id: "thread-child", name: "Child", updatedAt: 11 },
          { id: "thread-active", name: "Active", updatedAt: 12 },
          { id: "thread-processing", name: "Processing", updatedAt: 13 },
        ],
      },
      activeThreadIdByWorkspace: { "ws-1": "thread-active" },
      hiddenThreadIdsByWorkspace: {
        "ws-1": {
          "thread-parent": true,
          "thread-active": true,
          "thread-processing": true,
        },
      },
      threadParentById: {
        "thread-child": "thread-parent",
      },
      threadStatusById: {
        "thread-processing": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: null,
          lastDurationMs: null,
        },
      },
    };

    const next = threadReducer(base, {
      type: "setThreads",
      workspaceId: "ws-1",
      sortKey: "updated_at",
      preserveAnchors: true,
      threads: [{ id: "thread-child", name: "Child", updatedAt: 210 }],
    });

    expect(next.threadsByWorkspace["ws-1"]?.map((thread) => thread.id)).toEqual([
      "thread-child",
    ]);
  });

  it("drops stale active anchors on complete setThreads payloads", () => {
    const base: ThreadState = {
      ...initialState,
      threadsByWorkspace: {
        "ws-1": [
          { id: "thread-old", name: "Old", updatedAt: 10 },
          { id: "thread-stale", name: "Stale", updatedAt: 9 },
        ],
      },
      activeThreadIdByWorkspace: { "ws-1": "thread-old" },
    };

    const next = threadReducer(base, {
      type: "setThreads",
      workspaceId: "ws-1",
      sortKey: "updated_at",
      threads: [{ id: "thread-fresh", name: "Fresh", updatedAt: 210 }],
    });

    expect(next.threadsByWorkspace["ws-1"]?.map((thread) => thread.id)).toEqual([
      "thread-fresh",
    ]);
    expect(next.activeThreadIdByWorkspace["ws-1"]).toBe("thread-fresh");
  });

  it("trims existing items when maxItemsPerThread is reduced", () => {
    const items: ConversationItem[] = Array.from({ length: 5 }, (_, index) => ({
      id: `msg-${index}`,
      kind: "message",
      role: "assistant",
      text: `message ${index}`,
    }));

    const withItems = threadReducer(initialState, {
      type: "setThreadItems",
      threadId: "thread-1",
      items,
    });
    expect(withItems.itemsByThread["thread-1"]).toHaveLength(5);

    const trimmed = threadReducer(withItems, {
      type: "setMaxItemsPerThread",
      maxItemsPerThread: 3,
    });
    expect(trimmed.itemsByThread["thread-1"]).toHaveLength(3);
    expect(trimmed.itemsByThread["thread-1"]?.[0]?.id).toBe("msg-2");
  });

  it("keeps command execution items in reducer state instead of summarizing them", () => {
    const commandItem: ConversationItem = {
      id: "cmd-1",
      kind: "tool",
      toolType: "commandExecution",
      title: "Command: cat src/foo.ts",
      detail: "",
      status: "completed",
      output: "",
    };

    const next = threadReducer(initialState, {
      type: "setThreadItems",
      threadId: "thread-1",
      items: [commandItem],
    });

    expect(next.itemsByThread["thread-1"]?.[0]).toMatchObject({
      id: "cmd-1",
      kind: "tool",
      toolType: "commandExecution",
    });
  });

  it("keeps live spawned-agent rows when stale snapshot hydration omits them", () => {
    const withSpawnStarted = threadReducer(initialState, {
      type: "canonicalItemStarted",
      workspaceId: "ws-1",
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "spawn-1",
        type: "collabAgentToolCall",
        tool: "spawn",
        status: "inProgress",
        senderThreadId: "thread-1",
        receiverThreadIds: ["child-1"],
        prompt: "Review the chart layout",
        agentsStates: {
          "child-1": { status: "running", nickname: "Singer", role: "designer" },
        },
      },
    });

    const withSpawnCompleted = threadReducer(withSpawnStarted, {
      type: "canonicalItemCompleted",
      workspaceId: "ws-1",
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "spawn-1",
        type: "collabAgentToolCall",
        tool: "spawn",
        status: "completed",
        senderThreadId: "thread-1",
        receiverThreadIds: ["child-1"],
        prompt: "Review the chart layout",
        agentsStates: {
          "child-1": { status: "completed", nickname: "Singer", role: "designer" },
        },
      },
    });

    const afterStaleSnapshot = threadReducer(withSpawnCompleted, {
      type: "hydrateCanonicalThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      thread: {
        id: "thread-1",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "assistant-1",
                type: "agentMessage",
                text: "Working on it.",
              },
            ],
          },
        ],
      },
    });

    const items = afterStaleSnapshot.itemsByThread["thread-1"] ?? [];
    expect(items.map((item) => item.id)).toContain("spawn-1");
    expect(items.find((item) => item.id === "spawn-1")).toMatchObject({
      kind: "tool",
      toolType: "collabToolCall",
      status: "completed",
    });
  });

  it("keeps streamed command output when completion and snapshot payloads are incomplete", () => {
    const withCommand = threadReducer(initialState, {
      type: "canonicalItemStarted",
      workspaceId: "ws-1",
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "cmd-1",
        type: "commandExecution",
        command: "npm test",
        cwd: "/tmp/project",
        status: "inProgress",
        aggregatedOutput: null,
      },
    });

    const withOutput = threadReducer(withCommand, {
      type: "appendToolOutput",
      threadId: "thread-1",
      itemId: "cmd-1",
      delta: "running tests\n",
    });

    const completedWithoutOutput = threadReducer(withOutput, {
      type: "canonicalItemCompleted",
      workspaceId: "ws-1",
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "cmd-1",
        type: "commandExecution",
        command: "npm test",
        cwd: "/tmp/project",
        status: "completed",
        aggregatedOutput: null,
      },
    });

    const afterSnapshot = threadReducer(completedWithoutOutput, {
      type: "hydrateCanonicalThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      thread: {
        id: "thread-1",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "assistant-1",
                type: "agentMessage",
                text: "Tests are done.",
              },
            ],
          },
        ],
      },
    });

    expect(afterSnapshot.itemsByThread["thread-1"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cmd-1",
          kind: "tool",
          toolType: "commandExecution",
          status: "completed",
          output: "running tests\n",
        }),
      ]),
    );
  });

  it("merges equivalent live and snapshot message items when ids differ", () => {
    const withLiveUser = threadReducer(initialState, {
      type: "canonicalItemStarted",
      workspaceId: "ws-1",
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "live-user",
        type: "userMessage",
        content: [{ type: "text", text: "Testing this again" }],
      },
    });

    const withLiveAssistant = threadReducer(withLiveUser, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "live-assistant",
      delta: "Ready for the test.",
      hasCustomName: false,
    });

    const afterSnapshot = threadReducer(withLiveAssistant, {
      type: "hydrateCanonicalThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      thread: {
        id: "thread-1",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "snapshot-user",
                type: "userMessage",
                content: [{ type: "text", text: "Testing this again" }],
              },
              {
                id: "snapshot-assistant",
                type: "agentMessage",
                text: "Ready for the test.",
              },
            ],
          },
        ],
      },
    });

    expect(afterSnapshot.itemsByThread["thread-1"]).toEqual([
      {
        id: "live-user",
        kind: "message",
        role: "user",
        text: "Testing this again",
      },
      {
        id: "live-assistant",
        kind: "message",
        role: "assistant",
        text: "Ready for the test.",
      },
    ]);
    expect(
      afterSnapshot.canonicalItemsByThread["thread-1"]?.itemOrder,
    ).toEqual(["live-user", "live-assistant"]);
  });

  it("does not append local fallback messages already represented by canonical rows", () => {
    const hydrated = threadReducer(initialState, {
      type: "hydrateCanonicalThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      thread: {
        id: "thread-1",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "server-user",
                type: "userMessage",
                content: [{ type: "text", text: "Install the iOS app" }],
              },
              {
                id: "server-assistant",
                type: "agentMessage",
                text: "The install is blocked by CoreDevice.",
              },
            ],
          },
        ],
      },
    });

    const merged = threadReducer(hydrated, {
      type: "setThreadItems",
      threadId: "thread-1",
      items: [
        ...(hydrated.itemsByThread["thread-1"] ?? []),
        {
          id: "local-user",
          kind: "message",
          role: "user",
          text: "Install the iOS app",
        },
        {
          id: "local-assistant",
          kind: "message",
          role: "assistant",
          text: "The install is blocked by CoreDevice.",
        },
      ],
    });

    expect(merged.itemsByThread["thread-1"]).toEqual(
      hydrated.itemsByThread["thread-1"],
    );
  });

  it("does not rewrite visible items when a polling resume returns the same canonical snapshot", () => {
    const snapshot = {
      id: "thread-1",
      turns: [
        {
          id: "turn-1",
          items: [
            {
              id: "user-1",
              type: "userMessage",
              text: "Can you rebuild everything?",
            },
            {
              id: "assistant-1",
              type: "agentMessage",
              text: "The full rebuild completed.",
            },
            {
              id: "cmd-1",
              type: "commandExecution",
              command: "npm run tauri:build",
              status: "completed",
              aggregatedOutput: "build complete\n",
            },
          ],
        },
      ],
    };

    const hydrated = threadReducer(initialState, {
      type: "hydrateCanonicalThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      thread: snapshot,
    });
    const firstItems = hydrated.itemsByThread["thread-1"];

    const repeatedHydration = threadReducer(hydrated, {
      type: "hydrateCanonicalThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      thread: snapshot,
    });
    expect(repeatedHydration).toBe(hydrated);
    expect(repeatedHydration.itemsByThread["thread-1"]).toBe(firstItems);

    const repeatedSetItems = threadReducer(repeatedHydration, {
      type: "setThreadItems",
      threadId: "thread-1",
      items: repeatedHydration.itemsByThread["thread-1"] ?? [],
    });
    expect(repeatedSetItems).toBe(repeatedHydration);
    expect(repeatedSetItems.itemsByThread["thread-1"]).toBe(firstItems);
  });

});
