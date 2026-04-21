import { describe, expect, it } from "vitest";
import {
  buildStatusLines,
  extractAutoModelRoutingDecision,
  parseAutoModelRoutingDecision,
  resolveSendMessageOptions,
} from "./threadMessagingHelpers";

describe("threadMessagingHelpers auto model routing parsing", () => {
  it("accepts snake_case routing decision payloads and normalizes them", () => {
    const decision = parseAutoModelRoutingDecision({
      mode: "responsive",
      selected_model: "gpt-5.4",
      selected_reasoning_effort: "medium",
      fallback_used: true,
      reason: "Router unavailable; using fallback.",
      task_type: "fallback",
      complexity: "unknown",
      ambiguity: "unknown",
      needs_tools: false,
      needs_large_context: false,
      policy_note: "Mode policy selected the runtime default candidate.",
    });

    expect(decision).toEqual({
      mode: "responsive",
      provider: "openai",
      selectedModel: "gpt-5.4",
      selectedReasoningEffort: "medium",
      fallbackUsed: true,
      reason: "Router unavailable; using fallback.",
      confidence: null,
      taskType: "fallback",
      complexity: "unknown",
      ambiguity: "unknown",
      needsTools: false,
      needsLargeContext: false,
      policyNote: "Mode policy selected the runtime default candidate.",
    });
  });

  it("extracts decisions from nested turn/start responses with missing optional fields", () => {
    const decision = extractAutoModelRoutingDecision({
      result: {
        routingDecision: {
          selectedModel: "gpt-5.4-mini",
          reason: "Matched a small task.",
        },
      },
    });

    expect(decision).toEqual({
      mode: "unknown",
      provider: "openai",
      selectedModel: "gpt-5.4-mini",
      selectedReasoningEffort: null,
      fallbackUsed: false,
      reason: "Matched a small task.",
      confidence: null,
      taskType: "unknown",
      complexity: "unknown",
      ambiguity: "unknown",
      needsTools: false,
      needsLargeContext: false,
      policyNote: null,
    });
  });

  it("normalizes queue intent back to default when the thread is idle", () => {
    const resolved = resolveSendMessageOptions({
      options: { sendIntent: "queue" },
      defaults: {
        steerEnabled: true,
        isProcessing: false,
        activeTurnId: null,
      },
    });

    expect(resolved.sendIntent).toBe("default");
    expect(resolved.queueIntentRequested).toBe(true);
    expect(resolved.requestMode).toBe("start");
  });

  it("builds status lines from top-level collaboration mode payloads", () => {
    const lines = buildStatusLines({
      model: "gpt-5.4",
      serviceTier: null,
      effort: "medium",
      accessMode: "current",
      collaborationMode: {
        mode: "plan",
        settings: {
          developer_instructions: "test",
        },
      },
      rateLimits: null,
    });

    expect(lines).toContain("- Collaboration: plan");
  });

  it("builds status lines from string collaboration mode payloads", () => {
    const lines = buildStatusLines({
      model: null,
      serviceTier: null,
      effort: null,
      accessMode: "current",
      collaborationMode: "plan",
      rateLimits: null,
    });

    expect(lines).toContain("- Collaboration: plan");
  });
});
