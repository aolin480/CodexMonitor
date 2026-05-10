import type { ConversationItem } from "@/types";
import {
  consumeMessageDuplicateKey,
  countMessageDuplicateKeys,
} from "@utils/threadItems";
import {
  appendCanonicalItemText,
  appendReasoningSummaryBoundary,
  hydrateCanonicalThreadFromSnapshot,
  projectCanonicalThreadItems,
  upsertCanonicalThreadItem,
} from "@threads/canonical/threadTranscript";
import type {
  CanonicalThreadTranscript,
  CanonicalThreadTranscriptById,
} from "@threads/canonical/threadTranscript";
import type { ThreadAction, ThreadState } from "../useThreadsReducer";
import { prepareStateItemsForReducer } from "./threadItemsSlice";

function hasCanonicalTranscript(
  canonicalByThread: CanonicalThreadTranscriptById,
  threadId: string,
) {
  return Boolean(canonicalByThread[threadId]);
}

function areStringArraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sortedRecordKeys(record: Record<string, unknown>) {
  return Object.keys(record).sort();
}

function areJsonValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function areCanonicalTranscriptsEquivalent(
  left: CanonicalThreadTranscript | undefined,
  right: CanonicalThreadTranscript,
) {
  if (!left) {
    return false;
  }
  if (
    !areStringArraysEqual(left.itemOrder, right.itemOrder) ||
    !areStringArraysEqual(left.turnOrder, right.turnOrder) ||
    !areStringArraysEqual(
      sortedRecordKeys(left.itemsById),
      sortedRecordKeys(right.itemsById),
    )
  ) {
    return false;
  }
  return left.itemOrder.every((id) => {
    const leftRecord = left.itemsById[id];
    const rightRecord = right.itemsById[id];
    if (!leftRecord || !rightRecord) {
      return false;
    }
    return (
      leftRecord.id === rightRecord.id &&
      leftRecord.type === rightRecord.type &&
      leftRecord.turnId === rightRecord.turnId &&
      leftRecord.phase === rightRecord.phase &&
      leftRecord.provenance === rightRecord.provenance &&
      leftRecord.output === rightRecord.output &&
      areJsonValuesEqual(leftRecord.raw, rightRecord.raw)
    );
  });
}

function areConversationItemsEqual(
  left: ConversationItem[] | undefined,
  right: ConversationItem[],
) {
  if (!left || left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => areJsonValuesEqual(item, right[index]));
}

function commitTranscript(
  state: ThreadState,
  threadId: string,
  transcript: CanonicalThreadTranscript,
): ThreadState {
  const projectedItems = projectCanonicalThreadItems(transcript);
  const preparedItems = prepareStateItemsForReducer(
    projectedItems,
    state.maxItemsPerThread,
  );
  if (
    areCanonicalTranscriptsEquivalent(
      state.canonicalItemsByThread[threadId],
      transcript,
    ) &&
    areConversationItemsEqual(state.itemsByThread[threadId], preparedItems)
  ) {
    return state;
  }
  return {
    ...state,
    canonicalItemsByThread: {
      ...state.canonicalItemsByThread,
      [threadId]: transcript,
    },
    itemsByThread: {
      ...state.itemsByThread,
      [threadId]: preparedItems,
    },
  };
}

function commandOrFileField(itemType: string) {
  return itemType === "fileChange" ? "fileOutput" : "commandOutput";
}

export function reduceThreadCanonical(
  state: ThreadState,
  action: ThreadAction,
): ThreadState {
  switch (action.type) {
    case "canonicalItemStarted": {
      const transcript = upsertCanonicalThreadItem({
        transcript: state.canonicalItemsByThread[action.threadId],
        item: action.item,
        phase: "started",
        provenance: "live",
        turnId: action.turnId,
      });
      return commitTranscript(state, action.threadId, transcript);
    }
    case "canonicalItemCompleted": {
      const transcript = upsertCanonicalThreadItem({
        transcript: state.canonicalItemsByThread[action.threadId],
        item: action.item,
        phase: "completed",
        provenance: "live",
        turnId: action.turnId,
      });
      return commitTranscript(state, action.threadId, transcript);
    }
    case "hydrateCanonicalThread": {
      const transcript = hydrateCanonicalThreadFromSnapshot({
        transcript: state.canonicalItemsByThread[action.threadId],
        thread: action.thread,
      });
      return commitTranscript(state, action.threadId, transcript);
    }
    case "appendAgentDelta": {
      if (!hasCanonicalTranscript(state.canonicalItemsByThread, action.threadId)) {
        return state;
      }
      const transcript = appendCanonicalItemText({
        transcript: state.canonicalItemsByThread[action.threadId],
        itemId: action.itemId,
        itemType: "agentMessage",
        field: "agentText",
        delta: action.delta,
      });
      return commitTranscript(state, action.threadId, transcript);
    }
    case "completeAgentMessage": {
      if (!hasCanonicalTranscript(state.canonicalItemsByThread, action.threadId)) {
        return state;
      }
      const transcript = upsertCanonicalThreadItem({
        transcript: state.canonicalItemsByThread[action.threadId],
        item: { id: action.itemId, type: "agentMessage", text: action.text },
        phase: "completed",
        provenance: "live",
      });
      return commitTranscript(state, action.threadId, transcript);
    }
    case "appendToolOutput": {
      if (!hasCanonicalTranscript(state.canonicalItemsByThread, action.threadId)) {
        return state;
      }
      const existing =
        state.canonicalItemsByThread[action.threadId]?.itemsById[action.itemId];
      const itemType = existing?.type ?? "commandExecution";
      const transcript = appendCanonicalItemText({
        transcript: state.canonicalItemsByThread[action.threadId],
        itemId: action.itemId,
        itemType,
        field: commandOrFileField(itemType),
        delta: action.delta,
      });
      return commitTranscript(state, action.threadId, transcript);
    }
    case "appendPlanDelta": {
      if (!hasCanonicalTranscript(state.canonicalItemsByThread, action.threadId)) {
        return state;
      }
      const transcript = appendCanonicalItemText({
        transcript: state.canonicalItemsByThread[action.threadId],
        itemId: action.itemId,
        itemType: "plan",
        field: "planText",
        delta: action.delta,
      });
      return commitTranscript(state, action.threadId, transcript);
    }
    case "appendReasoningContent": {
      if (!hasCanonicalTranscript(state.canonicalItemsByThread, action.threadId)) {
        return state;
      }
      const transcript = appendCanonicalItemText({
        transcript: state.canonicalItemsByThread[action.threadId],
        itemId: action.itemId,
        itemType: "reasoning",
        field: "reasoningContent",
        delta: action.delta,
      });
      return commitTranscript(state, action.threadId, transcript);
    }
    case "appendReasoningSummary": {
      if (!hasCanonicalTranscript(state.canonicalItemsByThread, action.threadId)) {
        return state;
      }
      const transcript = appendCanonicalItemText({
        transcript: state.canonicalItemsByThread[action.threadId],
        itemId: action.itemId,
        itemType: "reasoning",
        field: "reasoningSummary",
        delta: action.delta,
      });
      return commitTranscript(state, action.threadId, transcript);
    }
    case "appendReasoningSummaryBoundary": {
      if (!hasCanonicalTranscript(state.canonicalItemsByThread, action.threadId)) {
        return state;
      }
      const transcript = appendReasoningSummaryBoundary(
        state.canonicalItemsByThread[action.threadId],
        action.itemId,
      );
      return commitTranscript(state, action.threadId, transcript);
    }
    case "setThreadItems": {
      if (!hasCanonicalTranscript(state.canonicalItemsByThread, action.threadId)) {
        return state;
      }
      const projected = projectCanonicalThreadItems(
        state.canonicalItemsByThread[action.threadId],
      );
      const mergedById = new Map<string, ConversationItem>(
        projected.map((item) => [item.id, item]),
      );
      const remainingCanonicalMessageMatches = countMessageDuplicateKeys(projected);
      action.items.forEach((item) => {
        if (mergedById.has(item.id)) {
          return;
        }
        if (consumeMessageDuplicateKey(remainingCanonicalMessageMatches, item)) {
          return;
        }
        mergedById.set(item.id, item);
      });
      const preparedItems = prepareStateItemsForReducer(
        Array.from(mergedById.values()),
        state.maxItemsPerThread,
      );
      if (areConversationItemsEqual(state.itemsByThread[action.threadId], preparedItems)) {
        const unfilteredItems = prepareStateItemsForReducer(
          action.items,
          state.maxItemsPerThread,
        );
        return areConversationItemsEqual(
          state.itemsByThread[action.threadId],
          unfilteredItems,
        )
          ? state
          : { ...state };
      }
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: preparedItems,
        },
      };
    }
    default:
      return state;
  }
}
