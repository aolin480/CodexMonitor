import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ConversationItem } from "../../../types";
import { isPlanReadyTaggedMessage } from "../../../utils/internalPlanReadyMessages";
import {
  SCROLL_THRESHOLD_PX,
  buildToolGroups,
  computePlanFollowupState,
  parseReasoning,
  scrollKeyForItems,
} from "../utils/messageRenderUtils";

function toMarkdownQuote(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n")
    .concat("\n\n");
}

type UseMessagesViewStateArgs = {
  items: ConversationItem[];
  threadId: string | null;
  isThinking: boolean;
  activeUserInputRequestId: string | number | null;
  hasVisibleUserInputRequest: boolean;
  onPlanAccept?: () => void;
  onPlanSubmitChanges?: (changes: string) => void;
  onQuoteMessage?: (text: string) => void;
};

export function useMessagesViewState({
  items,
  threadId,
  isThinking,
  activeUserInputRequestId,
  hasVisibleUserInputRequest,
  onPlanAccept,
  onPlanSubmitChanges,
  onQuoteMessage,
}: UseMessagesViewStateArgs) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerNodeRef = useRef<HTMLDivElement | null>(null);
  const contentNodeRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const manuallyToggledExpandedRef = useRef<Set<string>>(new Set());
  const autoScrollFrameRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const observedContentNodeRef = useRef<HTMLDivElement | null>(null);

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [collapsedToolGroups, setCollapsedToolGroups] = useState<Set<string>>(
    new Set(),
  );
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [dismissedPlanFollowupByThread, setDismissedPlanFollowupByThread] =
    useState<Record<string, string>>({});

  const scrollKey = `${scrollKeyForItems(items)}-${activeUserInputRequestId ?? "no-input"}`;

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    containerNodeRef.current = node;
  }, []);

  const isNearBottom = useCallback(
    (node: HTMLDivElement) =>
      node.scrollHeight - node.scrollTop - node.clientHeight <= SCROLL_THRESHOLD_PX,
    [],
  );

  const updateAutoScroll = useCallback(() => {
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
      return;
    }
    const container = containerNodeRef.current;
    if (!container) {
      return;
    }
    const shouldAutoScroll = isNearBottom(container);
    autoScrollRef.current = shouldAutoScroll;
  }, [isNearBottom]);

  const requestAutoScroll = useCallback(() => {
    const container = containerNodeRef.current;
    const shouldScroll =
      autoScrollRef.current || (container ? isNearBottom(container) : true);
    if (!shouldScroll) {
      return;
    }
    if (container) {
      programmaticScrollRef.current = true;
      container.scrollTop = container.scrollHeight;
      return;
    }
    programmaticScrollRef.current = true;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [isNearBottom]);

  const scheduleAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      return;
    }
    autoScrollFrameRef.current = window.requestAnimationFrame(() => {
      autoScrollFrameRef.current = null;
      const container = containerNodeRef.current;
      if (!container && !bottomRef.current) {
        return;
      }
      if (container && !autoScrollRef.current && !isNearBottom(container)) {
        return;
      }
      requestAutoScroll();
    });
  }, [isNearBottom, requestAutoScroll]);

  const cancelAutoScrollFrame = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  }, []);

  const disconnectResizeObserver = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    observedContentNodeRef.current = null;
  }, []);

  const contentRef = useCallback(
    (node: HTMLDivElement | null) => {
      const hasActiveObserver = resizeObserverRef.current !== null;
      if (
        contentNodeRef.current === node &&
        observedContentNodeRef.current === node &&
        hasActiveObserver
      ) {
        return;
      }
      disconnectResizeObserver();
      contentNodeRef.current = node;
      if (!node) {
        contentNodeRef.current = null;
        return;
      }
      scheduleAutoScroll();
      const schedulePinnedScroll = () => {
        if (autoScrollRef.current) {
          scheduleAutoScroll();
        }
      };
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => {
          schedulePinnedScroll();
        });
        observer.observe(node);
        resizeObserverRef.current = observer;
      }
      observedContentNodeRef.current = node;
    },
    [disconnectResizeObserver, scheduleAutoScroll],
  );

  useLayoutEffect(() => {
    autoScrollRef.current = true;
  }, [threadId]);

  useLayoutEffect(() => {
    const container = containerNodeRef.current;
    const shouldScroll =
      autoScrollRef.current || (container ? isNearBottom(container) : true);
    if (!shouldScroll) {
      return;
    }
    if (container) {
      container.scrollTop = container.scrollHeight;
      return;
    }
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [scrollKey, isThinking, isNearBottom, threadId]);

  useEffect(() => {
    if (!autoScrollRef.current) {
      return;
    }
    requestAutoScroll();
    scheduleAutoScroll();
  }, [isThinking, requestAutoScroll, scheduleAutoScroll, scrollKey]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      cancelAutoScrollFrame();
      disconnectResizeObserver();
    };
  }, [cancelAutoScrollFrame, disconnectResizeObserver]);

  const toggleExpanded = useCallback((id: string) => {
    manuallyToggledExpandedRef.current.add(id);
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleToolGroup = useCallback((id: string) => {
    setCollapsedToolGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleCopyMessage = useCallback(
    async (item: Extract<ConversationItem, { kind: "message" }>) => {
      try {
        await navigator.clipboard.writeText(item.text);
        setCopiedMessageId(item.id);
        if (copyTimeoutRef.current) {
          window.clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = window.setTimeout(() => {
          setCopiedMessageId(null);
        }, 1200);
      } catch {
        // No-op: clipboard errors can occur in restricted contexts.
      }
    },
    [],
  );

  const handleQuoteMessage = useCallback(
    (item: Extract<ConversationItem, { kind: "message" }>, selectedText?: string) => {
      if (!onQuoteMessage) {
        return;
      }
      const sourceText = selectedText?.trim().length ? selectedText : item.text;
      const quoteText = toMarkdownQuote(sourceText);
      if (!quoteText) {
        return;
      }
      onQuoteMessage(quoteText);
    },
    [onQuoteMessage],
  );

  const reasoningMetaById = useMemo(() => {
    const meta = new Map<string, ReturnType<typeof parseReasoning>>();
    items.forEach((item) => {
      if (item.kind === "reasoning") {
        meta.set(item.id, parseReasoning(item));
      }
    });
    return meta;
  }, [items]);

  const latestReasoningLabel = useMemo(() => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item.kind === "message") {
        break;
      }
      if (item.kind !== "reasoning") {
        continue;
      }
      const parsed = reasoningMetaById.get(item.id);
      if (parsed?.workingLabel) {
        return parsed.workingLabel;
      }
    }
    return null;
  }, [items, reasoningMetaById]);

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (
          item.kind === "message" &&
          item.role === "user" &&
          isPlanReadyTaggedMessage(item.text)
        ) {
          return false;
        }
        if (item.kind !== "reasoning") {
          return true;
        }
        return reasoningMetaById.get(item.id)?.hasBody ?? false;
      }),
    [items, reasoningMetaById],
  );

  useEffect(() => {
    for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
      const item = visibleItems[index];
      if (
        item.kind === "tool" &&
        item.toolType === "plan" &&
        (item.output ?? "").trim().length > 0
      ) {
        if (manuallyToggledExpandedRef.current.has(item.id)) {
          return;
        }
        setExpandedItems((prev) => {
          if (prev.has(item.id)) {
            return prev;
          }
          const next = new Set(prev);
          next.add(item.id);
          return next;
        });
        return;
      }
    }
  }, [visibleItems]);

  const groupedItems = useMemo(() => buildToolGroups(visibleItems), [visibleItems]);

  const planFollowup = useMemo(() => {
    if (!onPlanAccept || !onPlanSubmitChanges) {
      return { shouldShow: false, planItemId: null };
    }

    const candidate = computePlanFollowupState({
      threadId,
      items,
      isThinking,
      hasVisibleUserInputRequest,
    });

    if (threadId && candidate.planItemId) {
      if (dismissedPlanFollowupByThread[threadId] === candidate.planItemId) {
        return { ...candidate, shouldShow: false };
      }
    }

    return candidate;
  }, [
    dismissedPlanFollowupByThread,
    hasVisibleUserInputRequest,
    isThinking,
    items,
    onPlanAccept,
    onPlanSubmitChanges,
    threadId,
  ]);

  const dismissPlanFollowup = useCallback(() => {
    if (!threadId || !planFollowup.planItemId) {
      return;
    }
    setDismissedPlanFollowupByThread((prev) => ({
      ...prev,
      [threadId]: planFollowup.planItemId!,
    }));
  }, [planFollowup.planItemId, threadId]);

  return {
    bottomRef,
    containerRef,
    contentRef,
    updateAutoScroll,
    requestAutoScroll,
    expandedItems,
    toggleExpanded,
    collapsedToolGroups,
    toggleToolGroup,
    copiedMessageId,
    handleCopyMessage,
    handleQuoteMessage,
    reasoningMetaById,
    latestReasoningLabel,
    groupedItems,
    planFollowup,
    dismissPlanFollowup,
  };
}
