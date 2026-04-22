import type { AccessMode, ModelSelectionMode, ServiceTier } from "@/types";
import {
  buildEffectiveCodexArgsBadgeLabel,
  sanitizeRuntimeCodexArgs,
} from "./codexArgsProfiles";
import type { ThreadCodexParams } from "./threadStorage";
import { makeThreadCodexParamsKey } from "./threadStorage";

export const NO_THREAD_SCOPE_SUFFIX = "__no_thread__";

export type PendingNewThreadSeed = {
  workspaceId: string;
  serviceTier: ServiceTier | null | undefined;
  collaborationModeId: string | null;
  accessMode: AccessMode;
  codexArgsOverride: string | null;
};

type ResolveThreadCodexStateInput = {
  workspaceId: string;
  threadId: string | null;
  defaultAccessMode: AccessMode;
  autoModelRoutingEnabled: boolean;
  lastComposerModelId: string | null;
  lastComposerReasoningEffort: string | null;
  stored: ThreadCodexParams | null;
  noThreadStored: ThreadCodexParams | null;
  pendingSeed: PendingNewThreadSeed | null;
};

type ResolvedThreadCodexState = {
  scopeKey: string;
  accessMode: AccessMode;
  preferredModelSelectionMode: ModelSelectionMode;
  preferredModelId: string | null;
  preferredEffort: string | null;
  preferredServiceTier: ServiceTier | null | undefined;
  preferredCollabModeId: string | null;
  preferredCodexArgsOverride: string | null;
};

type ThreadCodexSeedPatch = {
  modelId: string | null;
  modelSelectionMode: ModelSelectionMode | null;
  effort: string | null;
  serviceTier: ServiceTier | null | undefined;
  accessMode: AccessMode;
  collaborationModeId: string | null;
  codexArgsOverride: string | null | undefined;
};

export function resolveWorkspaceRuntimeCodexArgsOverride(options: {
  workspaceId: string;
  threadId: string | null;
  getThreadCodexParams: (workspaceId: string, threadId: string) => ThreadCodexParams | null;
}): string | null {
  const { workspaceId, threadId, getThreadCodexParams } = options;
  const getNoThreadArgs = () =>
    getThreadCodexParams(workspaceId, NO_THREAD_SCOPE_SUFFIX)?.codexArgsOverride ?? null;

  if (!threadId) {
    return sanitizeRuntimeCodexArgs(getNoThreadArgs());
  }

  const threadScoped = getThreadCodexParams(workspaceId, threadId);
  if (threadScoped) {
    if (threadScoped.codexArgsOverride !== undefined) {
      return sanitizeRuntimeCodexArgs(threadScoped.codexArgsOverride);
    }
    return sanitizeRuntimeCodexArgs(getNoThreadArgs());
  }

  return sanitizeRuntimeCodexArgs(getNoThreadArgs());
}

export function resolveWorkspaceRuntimeCodexArgsBadgeLabel(options: {
  workspaceId: string;
  threadId: string;
  getThreadCodexParams: (workspaceId: string, threadId: string) => ThreadCodexParams | null;
}): string | null {
  const effectiveArgs = resolveWorkspaceRuntimeCodexArgsOverride({
    workspaceId: options.workspaceId,
    threadId: options.threadId,
    getThreadCodexParams: options.getThreadCodexParams,
  });
  return buildEffectiveCodexArgsBadgeLabel(effectiveArgs);
}

export function createPendingThreadSeed(options: {
  activeThreadId: string | null;
  activeWorkspaceId: string | null;
  selectedServiceTier: ServiceTier | null | undefined;
  selectedCollaborationModeId: string | null;
  accessMode: AccessMode;
  codexArgsOverride?: string | null;
}): PendingNewThreadSeed | null {
  const {
    activeThreadId,
    activeWorkspaceId,
    selectedServiceTier,
    selectedCollaborationModeId,
    accessMode,
    codexArgsOverride = null,
  } = options;
  if (activeThreadId || !activeWorkspaceId) {
    return null;
  }
  return {
    workspaceId: activeWorkspaceId,
    serviceTier: selectedServiceTier,
    collaborationModeId: selectedCollaborationModeId,
    accessMode,
    codexArgsOverride,
  };
}

export function resolveThreadCodexState(
  input: ResolveThreadCodexStateInput,
): ResolvedThreadCodexState {
  const {
    workspaceId,
    threadId,
    defaultAccessMode,
    autoModelRoutingEnabled,
    lastComposerModelId,
    lastComposerReasoningEffort,
    stored,
    noThreadStored,
    pendingSeed,
  } = input;

  const hasExplicitModelSelection = (value: ThreadCodexParams | null) =>
    Boolean(
      value &&
        (value.modelSelectionMode === "auto" ||
          value.modelSelectionMode === "manual" ||
          value.modelId),
    );

  const resolvePreferredModelSelectionMode = (
    value: ThreadCodexParams | null,
  ): ModelSelectionMode => {
    if (!value) {
      return autoModelRoutingEnabled ? "auto" : "manual";
    }
    if (value.modelSelectionMode === "auto" || value.modelSelectionMode === "manual") {
      return value.modelSelectionMode;
    }
    if (value.modelId) {
      return "manual";
    }
    return "manual";
  };

  const resolvePreferredModelId = (
    value: ThreadCodexParams | null,
    selectionMode: ModelSelectionMode,
  ) => {
    if (selectionMode === "auto") {
      return null;
    }
    return value?.modelId ?? lastComposerModelId ?? null;
  };

  const resolvePreferredEffort = (
    value: ThreadCodexParams | null,
    selectionMode: ModelSelectionMode,
  ) => {
    if (selectionMode === "auto") {
      return null;
    }
    return value?.effort ?? lastComposerReasoningEffort ?? null;
  };

  if (!threadId) {
    const modelSource = stored;
    const preferredModelSelectionMode =
      resolvePreferredModelSelectionMode(modelSource);
    return {
      scopeKey: `${workspaceId}:${NO_THREAD_SCOPE_SUFFIX}`,
      accessMode: stored?.accessMode ?? defaultAccessMode,
      preferredModelSelectionMode,
      preferredModelId: resolvePreferredModelId(
        modelSource,
        preferredModelSelectionMode,
      ),
      preferredEffort: resolvePreferredEffort(
        modelSource,
        preferredModelSelectionMode,
      ),
      preferredServiceTier: stored?.serviceTier,
      preferredCollabModeId: stored?.collaborationModeId ?? null,
      preferredCodexArgsOverride: stored?.codexArgsOverride ?? null,
    };
  }

  const pendingForWorkspace =
    pendingSeed && pendingSeed.workspaceId === workspaceId ? pendingSeed : null;
  const modelSource = hasExplicitModelSelection(stored)
    ? stored
    : noThreadStored ?? stored;
  const preferredModelSelectionMode =
    resolvePreferredModelSelectionMode(modelSource);

  return {
    scopeKey: makeThreadCodexParamsKey(workspaceId, threadId),
    accessMode: stored?.accessMode ?? pendingForWorkspace?.accessMode ?? defaultAccessMode,
    preferredModelSelectionMode,
    preferredModelId: resolvePreferredModelId(
      modelSource,
      preferredModelSelectionMode,
    ),
    preferredEffort: resolvePreferredEffort(
      stored?.effort !== null && stored?.effort !== undefined ? stored : modelSource,
      preferredModelSelectionMode,
    ),
    preferredServiceTier:
      stored?.serviceTier !== undefined
        ? stored.serviceTier
        : noThreadStored?.serviceTier,
    preferredCollabModeId:
      stored?.collaborationModeId ??
      (pendingForWorkspace
        ? pendingForWorkspace.collaborationModeId
        : null),
    preferredCodexArgsOverride:
      stored && stored.codexArgsOverride !== undefined
        ? stored.codexArgsOverride
        : pendingForWorkspace
          ? pendingForWorkspace.codexArgsOverride
          : noThreadStored?.codexArgsOverride ?? null,
  };
}

export function buildThreadCodexSeedPatch(options: {
  workspaceId: string;
  selectedModelId: string | null;
  modelSelectionMode: ModelSelectionMode;
  resolvedEffort: string | null;
  accessMode: AccessMode;
  selectedCollaborationModeId: string | null;
  codexArgsOverride?: string | null | undefined;
  pendingSeed: PendingNewThreadSeed | null;
}): ThreadCodexSeedPatch {
  const {
    workspaceId,
    selectedModelId,
    modelSelectionMode,
    resolvedEffort,
    accessMode,
    selectedCollaborationModeId,
    codexArgsOverride,
    pendingSeed,
  } = options;

  const pendingForWorkspace =
    pendingSeed && pendingSeed.workspaceId === workspaceId ? pendingSeed : null;

  return {
    modelId: selectedModelId,
    modelSelectionMode,
    effort: modelSelectionMode === "auto" ? null : resolvedEffort,
    serviceTier: pendingForWorkspace ? pendingForWorkspace.serviceTier : undefined,
    accessMode: pendingForWorkspace?.accessMode ?? accessMode,
    collaborationModeId: pendingForWorkspace
      ? pendingForWorkspace.collaborationModeId
      : selectedCollaborationModeId,
    codexArgsOverride: pendingForWorkspace
      ? pendingForWorkspace.codexArgsOverride
      : codexArgsOverride,
  };
}
