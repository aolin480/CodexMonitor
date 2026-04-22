import { describe, expect, it } from "vitest";
import type { ThreadCodexParams } from "./threadStorage";
import { resolveThreadCodexState } from "./threadCodexParamsSeed";

describe("resolveThreadCodexState", () => {
  it("preserves explicit Auto selection for a thread", () => {
    const resolved = resolveThreadCodexState({
      workspaceId: "ws-1",
      threadId: "thread-1",
      defaultAccessMode: "current",
      autoModelRoutingEnabled: false,
      lastComposerModelId: "gpt-5.4",
      lastComposerReasoningEffort: "medium",
      stored: {
        modelId: null,
        modelSelectionMode: "auto",
        effort: null,
        serviceTier: undefined,
        accessMode: null,
        collaborationModeId: null,
        codexArgsOverride: null,
        updatedAt: Date.now(),
      },
      noThreadStored: null,
      pendingSeed: null,
    });

    expect(resolved.preferredModelId).toBeNull();
  });

  it("inherits the app default when a thread has no explicit model selection", () => {
    const resolved = resolveThreadCodexState({
      workspaceId: "ws-1",
      threadId: "thread-1",
      defaultAccessMode: "current",
      autoModelRoutingEnabled: false,
      lastComposerModelId: "gpt-5.4-mini",
      lastComposerReasoningEffort: "medium",
      stored: {
        modelId: null,
        modelSelectionMode: null,
        effort: null,
        serviceTier: undefined,
        accessMode: "full-access",
        collaborationModeId: null,
        codexArgsOverride: null,
        updatedAt: Date.now(),
      },
      noThreadStored: null,
      pendingSeed: null,
    });

    expect(resolved.preferredModelId).toBe("gpt-5.4-mini");
    expect(resolved.accessMode).toBe("full-access");
  });

  it("uses Auto when the no-thread default is prompt intent", () => {
    const resolved = resolveThreadCodexState({
      workspaceId: "ws-1",
      threadId: null,
      defaultAccessMode: "current",
      autoModelRoutingEnabled: true,
      lastComposerModelId: null,
      lastComposerReasoningEffort: null,
      stored: null,
      noThreadStored: null,
      pendingSeed: null,
    });

    expect(resolved.preferredModelId).toBeNull();
    expect(resolved.preferredEffort).toBeNull();
  });

  it("inherits the current global mode when legacy stored mode is missing", () => {
    const legacyStored = {
      modelId: null,
      effort: null,
      serviceTier: undefined,
      accessMode: null,
      collaborationModeId: null,
      codexArgsOverride: null,
      updatedAt: Date.now(),
    } as unknown as ThreadCodexParams;
    const resolved = resolveThreadCodexState({
      workspaceId: "ws-1",
      threadId: "thread-1",
      defaultAccessMode: "current",
      autoModelRoutingEnabled: true,
      lastComposerModelId: "gpt-5.4-mini",
      lastComposerReasoningEffort: "medium",
      stored: legacyStored,
      noThreadStored: null,
      pendingSeed: null,
    });

    expect(resolved.preferredModelSelectionMode).toBe("manual");
    expect(resolved.preferredModelId).toBe("gpt-5.4-mini");
  });

  it("inherits no-thread model selection when the thread has no explicit model override", () => {
    const resolved = resolveThreadCodexState({
      workspaceId: "ws-1",
      threadId: "thread-1",
      defaultAccessMode: "current",
      autoModelRoutingEnabled: false,
      lastComposerModelId: "gpt-5.4-mini",
      lastComposerReasoningEffort: "medium",
      stored: {
        modelId: null,
        modelSelectionMode: null,
        effort: null,
        serviceTier: undefined,
        accessMode: "full-access",
        collaborationModeId: null,
        codexArgsOverride: null,
        updatedAt: Date.now(),
      },
      noThreadStored: {
        modelId: null,
        modelSelectionMode: "auto",
        effort: null,
        serviceTier: undefined,
        accessMode: null,
        collaborationModeId: null,
        codexArgsOverride: null,
        updatedAt: Date.now(),
      },
      pendingSeed: null,
    });

    expect(resolved.preferredModelSelectionMode).toBe("auto");
    expect(resolved.preferredModelId).toBeNull();
    expect(resolved.preferredEffort).toBeNull();
    expect(resolved.accessMode).toBe("full-access");
  });
});
