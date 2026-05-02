import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AppMention,
  ComposerSendIntent,
  FollowUpMessageBehavior,
  ModelSelectionMode,
  QueuedMessage,
  SendMessageResult,
  WorkspaceInfo,
} from "../../../types";
import { useComposerImages } from "../../composer/hooks/useComposerImages";
import { useQueuedSend } from "../../threads/hooks/useQueuedSend";

const MOBILE_FOLLOW_UP_BEHAVIOR_STORAGE_KEY =
  "codex-monitor-mobile-follow-up-behavior-by-thread";
const MOBILE_FOLLOW_UP_BEHAVIOR_ENTRY_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const MOBILE_FOLLOW_UP_BEHAVIOR_MAX_ENTRIES = 200;

type StoredMobileFollowUpBehaviorEntry = {
  behavior: FollowUpMessageBehavior;
  updatedAt: number;
};

function buildMobileFollowUpBehaviorStorageKey(workspaceId: string, threadId: string) {
  return `${workspaceId}::${threadId}`;
}

function readRawStoredMobileFollowUpBehavior(): Record<string, unknown> {
  if (typeof window === "undefined") {
    return {};
  }
  const raw = window.localStorage.getItem(MOBILE_FOLLOW_UP_BEHAVIOR_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeRawStoredMobileFollowUpBehavior(next: Record<string, unknown>) {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      MOBILE_FOLLOW_UP_BEHAVIOR_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // Ignore storage write failures and keep the in-memory preference.
    return;
  }
}

function readStoredMobileFollowUpBehaviorEntries(): Record<
  string,
  StoredMobileFollowUpBehaviorEntry
> {
  const parsed = readRawStoredMobileFollowUpBehavior();
  const cutoff = Date.now() - MOBILE_FOLLOW_UP_BEHAVIOR_ENTRY_TTL_MS;
  const entries = Object.entries(parsed).filter(
    (entry): entry is [string, StoredMobileFollowUpBehaviorEntry] => {
      const value = entry[1] as {
        behavior?: unknown;
        updatedAt?: unknown;
      } | null;
      return (
        value != null &&
        typeof value === "object" &&
        (value.behavior === "queue" || value.behavior === "steer") &&
        typeof value.updatedAt === "number" &&
        Number.isFinite(value.updatedAt) &&
        value.updatedAt >= cutoff
      );
    },
  );
  entries.sort((left, right) => right[1].updatedAt - left[1].updatedAt);
  return Object.fromEntries(entries.slice(0, MOBILE_FOLLOW_UP_BEHAVIOR_MAX_ENTRIES));
}

function readLegacyMobileFollowUpBehaviorByThread(): Record<
  string,
  FollowUpMessageBehavior
> {
  const raw = readRawStoredMobileFollowUpBehavior();
  return Object.fromEntries(
    Object.entries(raw).flatMap(([threadId, value]) => {
      if (threadId.includes("::")) {
        return [];
      }
      if (value !== "queue" && value !== "steer") {
        return [];
      }
      return [[threadId, value] as const];
    }),
  );
}

function readLegacyMobileFollowUpBehavior(threadId: string): FollowUpMessageBehavior | null {
  const raw = readRawStoredMobileFollowUpBehavior();
  const value = raw[threadId];
  return value === "queue" || value === "steer" ? value : null;
}

function readStoredMobileFollowUpBehaviorByThread(
  workspaceId: string | null,
): Record<string, FollowUpMessageBehavior> {
  if (!workspaceId) {
    return {};
  }
  const prefix = `${workspaceId}::`;
  const scopedEntries = Object.entries(readStoredMobileFollowUpBehaviorEntries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => [key.slice(prefix.length), value.behavior] as const);
  const scopedByThread = Object.fromEntries(scopedEntries);
  const legacyFallback = Object.entries(readLegacyMobileFollowUpBehaviorByThread()).filter(
    ([threadId]) => !(threadId in scopedByThread),
  );
  return {
    ...Object.fromEntries(legacyFallback),
    ...scopedByThread,
  };
}

function writeStoredMobileFollowUpBehaviorForThread(
  workspaceId: string,
  threadId: string,
  behavior: FollowUpMessageBehavior,
) {
  const raw = readRawStoredMobileFollowUpBehavior();
  const normalizedEntries = readStoredMobileFollowUpBehaviorEntries();
  const preservedLegacyEntries = Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) =>
        !key.includes("::") &&
        key !== threadId &&
        (value === "queue" || value === "steer"),
    ),
  );
  writeRawStoredMobileFollowUpBehavior({
    ...preservedLegacyEntries,
    ...normalizedEntries,
    [buildMobileFollowUpBehaviorStorageKey(workspaceId, threadId)]: {
      behavior,
      updatedAt: Date.now(),
    },
  });
}

function promoteLegacyMobileFollowUpBehaviorForThread(
  workspaceId: string,
  threadId: string,
): FollowUpMessageBehavior | null {
  const scopedKey = buildMobileFollowUpBehaviorStorageKey(workspaceId, threadId);
  if (scopedKey in readStoredMobileFollowUpBehaviorEntries()) {
    return null;
  }
  const legacyBehavior = readLegacyMobileFollowUpBehavior(threadId);
  if (!legacyBehavior) {
    return null;
  }
  writeStoredMobileFollowUpBehaviorForThread(workspaceId, threadId, legacyBehavior);
  return legacyBehavior;
}

export function useComposerController({
  activeThreadId,
  activeTurnId,
  activeWorkspaceId,
  activeWorkspace,
  selectedModelSelectionMode,
  isProcessing,
  isReviewing,
  queueFlushPaused = false,
  steerEnabled,
  followUpMessageBehavior,
  appsEnabled,
  connectWorkspace,
  startThreadForWorkspace,
  sendUserMessage,
  sendUserMessageToThread,
  startFork,
  startReview,
  startResume,
  startCompact,
  startApps,
  startMcp,
  startFast,
  startStatus,
}: {
  activeThreadId: string | null;
  activeTurnId: string | null;
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceInfo | null;
  selectedModelSelectionMode: ModelSelectionMode;
  isProcessing: boolean;
  isReviewing: boolean;
  queueFlushPaused?: boolean;
  steerEnabled: boolean;
  followUpMessageBehavior: FollowUpMessageBehavior;
  appsEnabled: boolean;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: { activate?: boolean },
  ) => Promise<string | null>;
  sendUserMessage: (
    text: string,
    images?: string[],
    appMentions?: AppMention[],
    options?: {
      sendIntent?: ComposerSendIntent;
      autoModelRoutingBypass?: boolean;
      modelSelectionMode?: "auto" | "manual";
    },
  ) => Promise<{ status: "sent" | "blocked" | "steer_failed" }>;
  sendUserMessageToThread: (
    workspace: WorkspaceInfo,
    threadId: string,
    text: string,
    images?: string[],
  ) => Promise<void | SendMessageResult>;
  startFork: (text: string) => Promise<void>;
  startReview: (text: string) => Promise<void>;
  startResume: (text: string) => Promise<void>;
  startCompact: (text: string) => Promise<void>;
  startApps: (text: string) => Promise<void>;
  startMcp: (text: string) => Promise<void>;
  startFast: (text: string) => Promise<void>;
  startStatus: (text: string) => Promise<void>;
}) {
  const [composerDraftsByThread, setComposerDraftsByThread] = useState<
    Record<string, string>
  >({});
  const [mobileFollowUpBehaviorByThread, setMobileFollowUpBehaviorByThread] = useState<
    Record<string, FollowUpMessageBehavior>
  >(() => readStoredMobileFollowUpBehaviorByThread(activeWorkspaceId));
  const [pendingMobileFollowUpBehaviorByThread, setPendingMobileFollowUpBehaviorByThread] =
    useState<Record<string, FollowUpMessageBehavior>>({});
  const [prefillDraft, setPrefillDraft] = useState<QueuedMessage | null>(null);
  const [composerInsert, setComposerInsert] = useState<QueuedMessage | null>(
    null,
  );

  const {
    activeImages,
    attachImages,
    pickImages,
    removeImage,
    clearActiveImages,
    setImagesForThread,
    removeImagesForThread,
  } = useComposerImages({ activeThreadId, activeWorkspaceId });

  const {
    activeQueue,
    handleSend,
    queueMessage,
    removeQueuedMessage,
  } = useQueuedSend({
    activeThreadId,
    activeTurnId,
    isProcessing,
    isReviewing,
    queueFlushPaused,
    steerEnabled,
    followUpMessageBehavior,
    appsEnabled,
    activeWorkspace,
    connectWorkspace,
    startThreadForWorkspace,
    sendUserMessage,
    sendUserMessageToThread,
    startFork,
    startReview,
    startResume,
    startCompact,
    startApps,
    startMcp,
    startFast,
    startStatus,
    clearActiveImages,
    autoModelRoutingBypass: selectedModelSelectionMode === "manual",
    modelSelectionMode: selectedModelSelectionMode,
  });

  const activeDraft = useMemo(
    () =>
      activeThreadId ? composerDraftsByThread[activeThreadId] ?? "" : "",
    [activeThreadId, composerDraftsByThread],
  );
  const activeMobileFollowUpBehavior = useMemo(
    () =>
      activeThreadId
        ? mobileFollowUpBehaviorByThread[activeThreadId] ?? followUpMessageBehavior
        : followUpMessageBehavior,
    [activeThreadId, followUpMessageBehavior, mobileFollowUpBehaviorByThread],
  );

  useEffect(() => {
    setMobileFollowUpBehaviorByThread(
      readStoredMobileFollowUpBehaviorByThread(activeWorkspaceId),
    );
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId || !activeThreadId) {
      return;
    }
    const promotedBehavior = promoteLegacyMobileFollowUpBehaviorForThread(
      activeWorkspaceId,
      activeThreadId,
    );
    if (!promotedBehavior) {
      return;
    }
    setMobileFollowUpBehaviorByThread((prev) => ({
      ...prev,
      [activeThreadId]: promotedBehavior,
    }));
  }, [activeThreadId, activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId || !activeThreadId) {
      return;
    }
    const pendingBehavior = pendingMobileFollowUpBehaviorByThread[activeThreadId];
    if (!pendingBehavior) {
      return;
    }
    writeStoredMobileFollowUpBehaviorForThread(
      activeWorkspaceId,
      activeThreadId,
      pendingBehavior,
    );
    setPendingMobileFollowUpBehaviorByThread((prev) => {
      const { [activeThreadId]: _, ...rest } = prev;
      return rest;
    });
  }, [activeThreadId, activeWorkspaceId, pendingMobileFollowUpBehaviorByThread]);

  const handleDraftChange = useCallback(
    (next: string) => {
      if (!activeThreadId) {
        return;
      }
      setComposerDraftsByThread((prev) => ({
        ...prev,
        [activeThreadId]: next,
      }));
    },
    [activeThreadId],
  );

  const handleSendPrompt = useCallback(
    (text: string, appMentions?: AppMention[]) => {
      if (!text.trim()) {
        return;
      }
      void handleSend(text, [], appMentions);
    },
    [handleSend],
  );

  const handleEditQueued = useCallback(
    (item: QueuedMessage) => {
      if (!activeThreadId) {
        return;
      }
      removeQueuedMessage(activeThreadId, item.id);
      setImagesForThread(activeThreadId, item.images ?? []);
      setPrefillDraft(item);
    },
    [activeThreadId, removeQueuedMessage, setImagesForThread],
  );

  const handleDeleteQueued = useCallback(
    (id: string) => {
      if (!activeThreadId) {
        return;
      }
      removeQueuedMessage(activeThreadId, id);
    },
    [activeThreadId, removeQueuedMessage],
  );

  const clearDraftForThread = useCallback((threadId: string) => {
    setComposerDraftsByThread((prev) => {
      if (!(threadId in prev)) {
        return prev;
      }
      const { [threadId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const setMobileFollowUpBehavior = useCallback(
    (behavior: FollowUpMessageBehavior) => {
      if (!activeThreadId) {
        return;
      }
      setMobileFollowUpBehaviorByThread((prev) => {
        if (prev[activeThreadId] === behavior) {
          return prev;
        }
        return {
          ...prev,
          [activeThreadId]: behavior,
        };
      });
      if (!activeWorkspaceId) {
        setPendingMobileFollowUpBehaviorByThread((prev) => ({
          ...prev,
          [activeThreadId]: behavior,
        }));
        return;
      }
      writeStoredMobileFollowUpBehaviorForThread(activeWorkspaceId, activeThreadId, behavior);
      setPendingMobileFollowUpBehaviorByThread((prev) => {
        if (!(activeThreadId in prev)) {
          return prev;
        }
        const { [activeThreadId]: _, ...rest } = prev;
        return rest;
      });
    },
    [activeThreadId, activeWorkspaceId],
  );

  return {
    activeImages,
    attachImages,
    pickImages,
    removeImage,
    clearActiveImages,
    setImagesForThread,
    removeImagesForThread,
    activeQueue,
    handleSend,
    queueMessage,
    removeQueuedMessage,
    prefillDraft,
    setPrefillDraft,
    composerInsert,
    setComposerInsert,
    activeDraft,
    activeMobileFollowUpBehavior,
    handleDraftChange,
    handleSendPrompt,
    handleEditQueued,
    handleDeleteQueued,
    clearDraftForThread,
    setMobileFollowUpBehavior,
  };
}
