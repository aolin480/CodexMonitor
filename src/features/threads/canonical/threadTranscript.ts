import type { ConversationItem } from "@/types";
import { buildConversationItemFromThreadItem } from "@utils/threadItems";

export type CanonicalThreadItemPhase = "started" | "completed" | "snapshot";
export type CanonicalThreadItemProvenance = "live" | "snapshot";

export type CanonicalThreadItemRecord = {
  id: string;
  type: string;
  turnId: string | null;
  raw: Record<string, unknown>;
  phase: CanonicalThreadItemPhase;
  provenance: CanonicalThreadItemProvenance;
  firstSeenAt: number;
  updatedAt: number;
  output: string;
};

export type CanonicalThreadTranscript = {
  itemOrder: string[];
  itemsById: Record<string, CanonicalThreadItemRecord>;
  turnOrder: string[];
};

export type CanonicalThreadTranscriptById = Record<
  string,
  CanonicalThreadTranscript
>;

export type UpsertCanonicalThreadItemInput = {
  transcript: CanonicalThreadTranscript | undefined;
  item: Record<string, unknown>;
  phase: CanonicalThreadItemPhase;
  provenance: CanonicalThreadItemProvenance;
  turnId?: string | null;
  timestamp?: number;
};

export type AppendCanonicalItemTextInput = {
  transcript: CanonicalThreadTranscript | undefined;
  itemId: string;
  itemType: string;
  field: "agentText" | "commandOutput" | "fileOutput" | "planText" | "reasoningContent" | "reasoningSummary";
  delta: string;
  turnId?: string | null;
  timestamp?: number;
};

const EMPTY_TRANSCRIPT: CanonicalThreadTranscript = {
  itemOrder: [],
  itemsById: {},
  turnOrder: [],
};

function cloneTranscript(
  transcript: CanonicalThreadTranscript | undefined,
): CanonicalThreadTranscript {
  if (!transcript) {
    return {
      itemOrder: [],
      itemsById: {},
      turnOrder: [],
    };
  }
  return {
    itemOrder: [...transcript.itemOrder],
    itemsById: { ...transcript.itemsById },
    turnOrder: [...transcript.turnOrder],
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function itemId(item: Record<string, unknown>) {
  return stringValue(item.id).trim();
}

function itemType(item: Record<string, unknown>) {
  return stringValue(item.type).trim();
}

function normalizeTurnId(turnId: unknown) {
  const value = stringValue(turnId).trim();
  return value || null;
}

function appendText(existing: string, delta: string) {
  if (!delta) {
    return existing;
  }
  if (!existing) {
    return delta;
  }
  if (delta.startsWith(existing)) {
    return delta;
  }
  if (existing.endsWith(delta)) {
    return existing;
  }
  return `${existing}${delta}`;
}

function mergeArrayText(existing: unknown, incoming: unknown) {
  const existingArray = Array.isArray(existing) ? existing : [];
  const incomingArray = Array.isArray(incoming) ? incoming : [];
  return incomingArray.length >= existingArray.length ? incoming : existing;
}

function chooseLongerText(existing: unknown, incoming: unknown) {
  const existingText = stringValue(existing);
  const incomingText = stringValue(incoming);
  if (!incomingText) {
    return existing;
  }
  if (!existingText) {
    return incoming;
  }
  return incomingText.length >= existingText.length ? incoming : existing;
}

function mergeRawItem(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
) {
  const merged = { ...existing, ...incoming };
  const type = itemType(incoming) || itemType(existing);

  if (type === "agentMessage") {
    merged.text = chooseLongerText(existing.text, incoming.text);
  }

  if (type === "plan") {
    merged.text = chooseLongerText(existing.text, incoming.text);
  }

  if (type === "reasoning") {
    merged.summary = mergeArrayText(existing.summary, incoming.summary);
    merged.content = mergeArrayText(existing.content, incoming.content);
  }

  if (type === "commandExecution") {
    merged.aggregatedOutput = chooseLongerText(
      existing.aggregatedOutput,
      incoming.aggregatedOutput,
    );
  }

  if (type === "mcpToolCall") {
    merged.result = incoming.result ?? existing.result ?? null;
    merged.error = incoming.error ?? existing.error ?? null;
  }

  if (type === "dynamicToolCall") {
    merged.contentItems = incoming.contentItems ?? existing.contentItems ?? null;
  }

  return merged;
}

function recordOutput(raw: Record<string, unknown>) {
  const type = itemType(raw);
  if (type === "agentMessage") {
    return stringValue(raw.text);
  }
  if (type === "plan") {
    return stringValue(raw.text);
  }
  if (type === "commandExecution") {
    return stringValue(raw.aggregatedOutput);
  }
  return "";
}

type MessageProjection = {
  role: "user" | "assistant";
  text: string;
  images: string;
};

function normalizeDuplicateMessageText(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function normalizeDuplicateMessageImages(images: string[] | undefined) {
  return (images ?? []).map((image) => image.trim()).filter(Boolean).join("\u0000");
}

function projectMessageForIdentity(raw: Record<string, unknown>): MessageProjection | null {
  const converted = buildConversationItemFromThreadItem(raw);
  if (converted?.kind === "message") {
    return {
      role: converted.role,
      text: normalizeDuplicateMessageText(converted.text),
      images: normalizeDuplicateMessageImages(converted.images),
    };
  }

  const type = itemType(raw);
  if (type === "userMessage") {
    const text = normalizeDuplicateMessageText(stringValue(raw.text));
    if (!text) {
      return null;
    }
    return { role: "user", text, images: "" };
  }
  if (type === "agentMessage") {
    const text = normalizeDuplicateMessageText(stringValue(raw.text));
    if (!text) {
      return null;
    }
    return { role: "assistant", text, images: "" };
  }
  return null;
}

function turnsCanRepresentSameItem(
  existingTurnId: string | null,
  incomingTurnId: string | null,
) {
  return !existingTurnId || !incomingTurnId || existingTurnId === incomingTurnId;
}

function messagesRepresentSameItem(
  existing: MessageProjection,
  incoming: MessageProjection,
) {
  if (existing.role !== incoming.role || existing.images !== incoming.images) {
    return false;
  }
  if (!existing.text && !incoming.text) {
    return Boolean(existing.images);
  }
  if (existing.text === incoming.text) {
    return true;
  }
  if (existing.role !== "assistant" || !existing.text || !incoming.text) {
    return false;
  }
  const shorterLength = Math.min(existing.text.length, incoming.text.length);
  if (shorterLength < 24) {
    return false;
  }
  return existing.text.startsWith(incoming.text) || incoming.text.startsWith(existing.text);
}

function findEquivalentCanonicalItemId(
  transcript: CanonicalThreadTranscript,
  incoming: Record<string, unknown>,
  incomingTurnId: string | null,
) {
  const incomingType = itemType(incoming);
  if (incomingType !== "userMessage" && incomingType !== "agentMessage") {
    return null;
  }
  const incomingMessage = projectMessageForIdentity(incoming);
  if (!incomingMessage) {
    return null;
  }

  for (let index = transcript.itemOrder.length - 1; index >= 0; index -= 1) {
    const id = transcript.itemOrder[index];
    const record = transcript.itemsById[id];
    if (!record || record.type !== incomingType) {
      continue;
    }
    if (!turnsCanRepresentSameItem(record.turnId, incomingTurnId)) {
      continue;
    }
    const existingMessage = projectMessageForIdentity(rawWithOutput(record));
    if (existingMessage && messagesRepresentSameItem(existingMessage, incomingMessage)) {
      return id;
    }
  }
  return null;
}

function resolveCanonicalItemId(
  transcript: CanonicalThreadTranscript,
  item: Record<string, unknown>,
  normalizedTurnId: string | null,
) {
  const id = itemId(item);
  if (!id) {
    return "";
  }
  return transcript.itemsById[id]
    ? id
    : findEquivalentCanonicalItemId(transcript, item, normalizedTurnId) ?? id;
}

function rawWithOutput(record: CanonicalThreadItemRecord) {
  const raw = { ...record.raw };
  if (!record.output) {
    return raw;
  }
  if (record.type === "agentMessage") {
    raw.text = chooseLongerText(raw.text, record.output);
  } else if (record.type === "plan") {
    raw.text = chooseLongerText(raw.text, record.output);
  } else if (record.type === "commandExecution") {
    raw.aggregatedOutput = chooseLongerText(raw.aggregatedOutput, record.output);
  }
  return raw;
}

function ensureTurnOrder(
  transcript: CanonicalThreadTranscript,
  turnId: string | null,
) {
  if (!turnId || transcript.turnOrder.includes(turnId)) {
    return;
  }
  transcript.turnOrder.push(turnId);
}

function ensureItemOrder(
  transcript: CanonicalThreadTranscript,
  id: string,
  afterItemId?: string | null,
) {
  if (transcript.itemOrder.includes(id)) {
    return;
  }
  if (afterItemId) {
    const afterIndex = transcript.itemOrder.indexOf(afterItemId);
    if (afterIndex >= 0) {
      transcript.itemOrder.splice(afterIndex + 1, 0, id);
      return;
    }
  }
  transcript.itemOrder.push(id);
}

export function upsertCanonicalThreadItem({
  item,
  phase,
  provenance,
  timestamp = Date.now(),
  transcript,
  turnId,
}: UpsertCanonicalThreadItemInput): CanonicalThreadTranscript {
  const id = itemId(item);
  const type = itemType(item);
  if (!id || !type) {
    return transcript ?? EMPTY_TRANSCRIPT;
  }

  const next = cloneTranscript(transcript);
  const normalizedTurnId =
    normalizeTurnId(turnId) ?? normalizeTurnId(item.turnId ?? item.turn_id);
  const canonicalId = resolveCanonicalItemId(next, item, normalizedTurnId);
  const existing = next.itemsById[canonicalId];
  const raw = existing ? mergeRawItem(existing.raw, item) : { ...item };
  raw.id = canonicalId;
  const output = recordOutput(raw) || existing?.output || "";

  if (canonicalId !== id) {
    delete next.itemsById[id];
    next.itemOrder = next.itemOrder.filter((entryId) => entryId !== id);
  }

  next.itemsById[canonicalId] = {
    id: canonicalId,
    type,
    turnId: normalizedTurnId ?? existing?.turnId ?? null,
    raw,
    phase:
      phase === "completed" || existing?.phase === "completed"
        ? "completed"
        : phase,
    provenance: existing?.provenance === "live" ? "live" : provenance,
    firstSeenAt: existing?.firstSeenAt ?? timestamp,
    updatedAt: timestamp,
    output,
  };
  ensureTurnOrder(next, next.itemsById[canonicalId].turnId);
  ensureItemOrder(next, canonicalId);
  return next;
}

export function appendCanonicalItemText({
  delta,
  field,
  itemId,
  itemType,
  timestamp = Date.now(),
  transcript,
  turnId,
}: AppendCanonicalItemTextInput): CanonicalThreadTranscript {
  if (!itemId || !delta) {
    return transcript ?? EMPTY_TRANSCRIPT;
  }

  const next = cloneTranscript(transcript);
  const existing = next.itemsById[itemId];
  const type = existing?.type ?? itemType;
  const raw: Record<string, unknown> = existing
    ? { ...existing.raw }
    : { id: itemId, type };
  const output = appendText(existing?.output ?? recordOutput(raw), delta);

  if (field === "agentText") {
    raw.text = output;
  } else if (field === "commandOutput") {
    raw.aggregatedOutput = output;
  } else if (field === "planText") {
    raw.text = output;
  } else if (field === "reasoningContent") {
    const content = Array.isArray(raw.content) ? [...raw.content] : [""];
    content[content.length - 1] = appendText(
      stringValue(content[content.length - 1]),
      delta,
    );
    raw.content = content;
  } else if (field === "reasoningSummary") {
    const summary = Array.isArray(raw.summary) ? [...raw.summary] : [""];
    summary[summary.length - 1] = appendText(
      stringValue(summary[summary.length - 1]),
      delta,
    );
    raw.summary = summary;
  }

  next.itemsById[itemId] = {
    id: itemId,
    type,
    turnId: existing?.turnId ?? normalizeTurnId(turnId),
    raw,
    phase: existing?.phase ?? "started",
    provenance: existing?.provenance ?? "live",
    firstSeenAt: existing?.firstSeenAt ?? timestamp,
    updatedAt: timestamp,
    output,
  };
  ensureTurnOrder(next, next.itemsById[itemId].turnId);
  ensureItemOrder(next, itemId);
  return next;
}

export function appendReasoningSummaryBoundary(
  transcript: CanonicalThreadTranscript | undefined,
  itemId: string,
  timestamp = Date.now(),
) {
  if (!itemId) {
    return transcript ?? EMPTY_TRANSCRIPT;
  }
  const next = cloneTranscript(transcript);
  const existing = next.itemsById[itemId];
  const raw: Record<string, unknown> = existing
    ? { ...existing.raw }
    : { id: itemId, type: "reasoning" };
  const summary = Array.isArray(raw.summary) ? [...raw.summary] : [];
  summary.push("");
  raw.summary = summary;
  next.itemsById[itemId] = {
    id: itemId,
    type: "reasoning",
    turnId: existing?.turnId ?? null,
    raw,
    phase: existing?.phase ?? "started",
    provenance: existing?.provenance ?? "live",
    firstSeenAt: existing?.firstSeenAt ?? timestamp,
    updatedAt: timestamp,
    output: existing?.output ?? "",
  };
  ensureItemOrder(next, itemId);
  return next;
}

export function hydrateCanonicalThreadFromSnapshot({
  thread,
  timestamp = Date.now(),
  transcript,
}: {
  thread: Record<string, unknown>;
  transcript: CanonicalThreadTranscript | undefined;
  timestamp?: number;
}) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  let next = transcript ?? EMPTY_TRANSCRIPT;
  let previousItemId: string | null = null;

  turns.forEach((turn) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnId = normalizeTurnId(turnRecord.id);
    const items = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    items.forEach((item) => {
      const id = resolveCanonicalItemId(next, item, turnId);
      next = upsertCanonicalThreadItem({
        transcript: next,
        item: { ...item, turnId },
        phase: "snapshot",
        provenance: "snapshot",
        turnId,
        timestamp,
      });
      const cloned = cloneTranscript(next);
      if (id && previousItemId && !transcript?.itemsById[id]) {
        cloned.itemOrder = cloned.itemOrder.filter((entryId) => entryId !== id);
        ensureItemOrder(cloned, id, previousItemId);
        next = cloned;
      }
      previousItemId = id || previousItemId;
    });
  });

  return next;
}

export function projectCanonicalThreadItems(
  transcript: CanonicalThreadTranscript | undefined,
): ConversationItem[] {
  if (!transcript) {
    return [];
  }
  const items: ConversationItem[] = [];
  transcript.itemOrder.forEach((id) => {
    const record = transcript.itemsById[id];
    if (!record) {
      return;
    }
    const converted = buildConversationItemFromThreadItem(rawWithOutput(record));
    if (!converted) {
      return;
    }
    if (converted.kind === "tool" && record.output) {
      const existingOutput = converted.output ?? "";
      items.push({
        ...converted,
        output:
          existingOutput && existingOutput !== record.output
            ? `${existingOutput}\n\n${record.output}`
            : record.output,
      });
      return;
    }
    items.push(converted);
  });
  return items;
}
