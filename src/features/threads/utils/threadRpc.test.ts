import { describe, expect, it } from "vitest";
import {
  getParentThreadIdFromThread,
  getResumedActiveTurnId,
  getResumedTurnState,
  isSubagentThreadSource,
  shouldHideSubagentThreadFromSidebar,
} from "./threadRpc";

describe("threadRpc", () => {
  it("prefers explicit activeTurnId when present", () => {
    const state = getResumedTurnState({
      id: "thread-1",
      activeTurnId: "turn-explicit",
      turns: [{ id: "turn-old", status: "completed" }],
    });

    expect(state).toEqual({
      activeTurnId: "turn-explicit",
      activeTurnStartedAtMs: null,
      hasActiveTurnSignal: true,
      confidentNoActiveTurn: false,
    });
    expect(
      getResumedActiveTurnId({ id: "thread-1", activeTurnId: "turn-explicit" }),
    ).toBe("turn-explicit");
  });

  it("treats explicit empty active-turn fields as confidently idle", () => {
    const state = getResumedTurnState({
      id: "thread-1",
      active_turn_id: null,
      turns: [{ id: "turn-1", status: "inProgress" }],
    });

    expect(state).toEqual({
      activeTurnId: null,
      activeTurnStartedAtMs: null,
      hasActiveTurnSignal: false,
      confidentNoActiveTurn: true,
    });
  });

  it("detects active turns from waiting statuses and normalizes seconds timestamps", () => {
    const state = getResumedTurnState({
      id: "thread-1",
      turns: [{ id: "turn-live", status: "waiting_for_input", started_at: 1_700_000_000 }],
    });

    expect(state).toEqual({
      activeTurnId: "turn-live",
      activeTurnStartedAtMs: 1_700_000_000_000,
      hasActiveTurnSignal: true,
      confidentNoActiveTurn: false,
    });
  });

  it("detects active turns from in-progress item statuses when turn status is missing", () => {
    const state = getResumedTurnState({
      id: "thread-1",
      turns: [
        {
          id: "turn-live",
          started_at: 1_700_000_000,
          items: [
            {
              id: "item-command",
              type: "commandExecution",
              status: "in_progress",
            },
          ],
        },
      ],
    });

    expect(state).toEqual({
      activeTurnId: "turn-live",
      activeTurnStartedAtMs: 1_700_000_000_000,
      hasActiveTurnSignal: true,
      confidentNoActiveTurn: false,
    });
  });

  it("detects active turns from user-only resumed turns when live status is unavailable", () => {
    const state = getResumedTurnState({
      id: "thread-1",
      turns: [
        {
          id: "turn-live",
          started_at: 1_700_000_000,
          items: [
            {
              id: "item-user",
              type: "userMessage",
              content: [{ type: "text", text: "Please continue." }],
            },
          ],
        },
      ],
    });

    expect(state).toEqual({
      activeTurnId: "turn-live",
      activeTurnStartedAtMs: 1_700_000_000_000,
      hasActiveTurnSignal: true,
      confidentNoActiveTurn: false,
    });
  });

  it("uses top-level active thread status as a resume processing signal", () => {
    const state = getResumedTurnState({
      id: "thread-1",
      status: { type: "active", activeFlags: [] },
      turns: [{ id: "turn-1", status: "completed", items: [] }],
    });

    expect(state).toEqual({
      activeTurnId: null,
      activeTurnStartedAtMs: null,
      hasActiveTurnSignal: true,
      confidentNoActiveTurn: false,
    });
  });

  it("prefers active turn ids over top-level active thread status", () => {
    const state = getResumedTurnState({
      id: "thread-1",
      status: { type: "active", activeFlags: [] },
      turns: [{ id: "turn-live", status: "inProgress", started_at: 1_700_000_000 }],
    });

    expect(state).toEqual({
      activeTurnId: "turn-live",
      activeTurnStartedAtMs: 1_700_000_000_000,
      hasActiveTurnSignal: true,
      confidentNoActiveTurn: false,
    });
  });

  it("treats top-level idle thread status as confidently idle", () => {
    const state = getResumedTurnState({
      id: "thread-1",
      status: { type: "idle" },
      turns: [{ id: "turn-stale", status: "inProgress", items: [] }],
    });

    expect(state).toEqual({
      activeTurnId: null,
      activeTurnStartedAtMs: null,
      hasActiveTurnSignal: false,
      confidentNoActiveTurn: true,
    });
  });

  it("marks completed-only turn snapshots as confidently idle", () => {
    const state = getResumedTurnState({
      id: "thread-1",
      turns: [
        { id: "turn-1", status: "completed" },
        { id: "turn-2", status: "cancelled" },
      ],
    });

    expect(state).toEqual({
      activeTurnId: null,
      activeTurnStartedAtMs: null,
      hasActiveTurnSignal: false,
      confidentNoActiveTurn: true,
    });
  });

  it("keeps confidence low when turn statuses are unknown", () => {
    const state = getResumedTurnState({
      id: "thread-1",
      turns: [{ id: "turn-1", status: "mystery" }],
    });

    expect(state).toEqual({
      activeTurnId: null,
      activeTurnStartedAtMs: null,
      hasActiveTurnSignal: false,
      confidentNoActiveTurn: false,
    });
  });

  it("extracts parent thread ids from top-level thread fields", () => {
    expect(
      getParentThreadIdFromThread({
        id: "thread-child",
        parent_thread_id: "thread-parent",
      }),
    ).toBe("thread-parent");
  });

  it("prioritizes source metadata over fallback parent fields", () => {
    expect(
      getParentThreadIdFromThread({
        id: "thread-child",
        parent_thread_id: "thread-parent-flat",
        source: {
          subAgent: {
            thread_spawn: {
              parent_thread_id: "thread-parent-source",
            },
          },
        },
      }),
    ).toBe("thread-parent-source");
  });

  it("extracts parent thread ids from lowercase subagent source metadata", () => {
    expect(
      getParentThreadIdFromThread({
        id: "thread-child",
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: "thread-parent-lowercase",
            },
          },
        },
      }),
    ).toBe("thread-parent-lowercase");
  });

  it("detects subagent source metadata in object and string forms", () => {
    expect(isSubagentThreadSource({ subAgent: { review: true } })).toBe(true);
    expect(isSubagentThreadSource({ sub_agent: "memory_consolidation" })).toBe(true);
    expect(isSubagentThreadSource("subagent_review")).toBe(true);
    expect(isSubagentThreadSource("vscode")).toBe(false);
    expect(isSubagentThreadSource({})).toBe(false);
  });

  it("hides only memory consolidation subagents from sidebar", () => {
    expect(
      shouldHideSubagentThreadFromSidebar({ subagent: "memory_consolidation" }),
    ).toBe(true);
    expect(
      shouldHideSubagentThreadFromSidebar({ subAgent: { memory_consolidation: true } }),
    ).toBe(true);
    expect(shouldHideSubagentThreadFromSidebar("subagent_memory_consolidation")).toBe(
      true,
    );
    expect(shouldHideSubagentThreadFromSidebar({ subAgent: { review: true } })).toBe(
      false,
    );
    expect(shouldHideSubagentThreadFromSidebar("subagent_review")).toBe(false);
  });
});
