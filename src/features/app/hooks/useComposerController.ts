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

function readStoredMobileFollowUpBehaviorByThread(): Record<string, FollowUpMessageBehavior> {
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
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, FollowUpMessageBehavior] =>
          entry[1] === "queue" || entry[1] === "steer",
      ),
    );
  } catch {
    return {};
  }
}

function writeStoredMobileFollowUpBehaviorByThread(
  next: Record<string, FollowUpMessageBehavior>,
) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    MOBILE_FOLLOW_UP_BEHAVIOR_STORAGE_KEY,
    JSON.stringify(next),
  );
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
  >(() => readStoredMobileFollowUpBehaviorByThread());
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
    if (!activeThreadId) {
      return;
    }
    const storedBehavior = readStoredMobileFollowUpBehaviorByThread()[activeThreadId];
    if (!storedBehavior) {
      return;
    }
    setMobileFollowUpBehaviorByThread((prev) => {
      if (prev[activeThreadId] === storedBehavior) {
        return prev;
      }
      return {
        ...prev,
        [activeThreadId]: storedBehavior,
      };
    });
  }, [activeThreadId]);

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
      writeStoredMobileFollowUpBehaviorByThread({
        ...readStoredMobileFollowUpBehaviorByThread(),
        [activeThreadId]: behavior,
      });
      setMobileFollowUpBehaviorByThread((prev) => {
        if (prev[activeThreadId] === behavior) {
          return prev;
        }
        return {
          ...prev,
          [activeThreadId]: behavior,
        };
      });
    },
    [activeThreadId],
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
