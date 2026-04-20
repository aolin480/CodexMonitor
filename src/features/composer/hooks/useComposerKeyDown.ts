import { useCallback, type KeyboardEvent, type RefObject } from "react";
import type { ComposerSendIntent } from "../../../types";
import { getListContinuation } from "../../../utils/composerText";
import { isComposingEvent } from "../../../utils/keys";
import { isMobilePlatform } from "../../../utils/platformPaths";

const MOBILE_NEWLINE_CONTENT_PATTERN = /[A-Za-z0-9]/;

type ReviewPromptKeyEvent = {
  key: string;
  shiftKey?: boolean;
  preventDefault: () => void;
};

type UseComposerKeyDownArgs = {
  applyTextInsertion: (nextText: string, nextCursor: number) => void;
  canSend: boolean;
  continueListOnShiftEnter: boolean;
  defaultSubmitIntent: ComposerSendIntent;
  expandFenceOnEnter: boolean;
  expandFenceOnSpace: boolean;
  handleHistoryKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSend: (submitIntent?: ComposerSendIntent) => void;
  isDictationBusy: boolean;
  isMac: boolean;
  onReviewPromptKeyDown?: (event: ReviewPromptKeyEvent) => boolean;
  oppositeSubmitIntent: ComposerSendIntent;
  reviewPromptOpen: boolean;
  suggestionsOpen: boolean;
  text: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  tryExpandFence: (start: number, end: number) => boolean;
};

export function useComposerKeyDown({
  applyTextInsertion,
  canSend,
  continueListOnShiftEnter,
  defaultSubmitIntent,
  expandFenceOnEnter,
  expandFenceOnSpace,
  handleHistoryKeyDown,
  handleInputKeyDown,
  handleSend,
  isDictationBusy,
  isMac,
  onReviewPromptKeyDown,
  oppositeSubmitIntent,
  reviewPromptOpen,
  suggestionsOpen,
  text,
  textareaRef,
  tryExpandFence,
}: UseComposerKeyDownArgs) {
  return useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      const isMobile = isMobilePlatform();
      if (isComposingEvent(event)) {
        return;
      }
      handleHistoryKeyDown(event);
      if (event.defaultPrevented) {
        return;
      }
      const isOppositeFollowUpShortcut =
        event.key === "Enter" &&
        event.shiftKey &&
        (isMac ? event.metaKey : event.ctrlKey);
      if (isOppositeFollowUpShortcut && !suggestionsOpen) {
        if (isDictationBusy) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        const dismissKeyboardAfterSend = canSend && isMobile;
        handleSend(oppositeSubmitIntent);
        if (dismissKeyboardAfterSend) {
          textareaRef.current?.blur();
        }
        return;
      }
      if (
        expandFenceOnSpace &&
        event.key === " " &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }
        const start = textarea.selectionStart ?? text.length;
        const end = textarea.selectionEnd ?? start;
        if (tryExpandFence(start, end)) {
          event.preventDefault();
          return;
        }
      }
      if (
        event.key === "Enter" &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        if (continueListOnShiftEnter && !suggestionsOpen) {
          const textarea = textareaRef.current;
          if (textarea) {
            const start = textarea.selectionStart ?? text.length;
            const end = textarea.selectionEnd ?? start;
            if (start === end) {
              const marker = getListContinuation(text, start);
              if (marker) {
                event.preventDefault();
                const before = text.slice(0, start);
                const after = text.slice(end);
                const nextText = `${before}\n${marker}${after}`;
                const nextCursor = before.length + 1 + marker.length;
                applyTextInsertion(nextText, nextCursor);
                return;
              }
            }
          }
        }
        event.preventDefault();
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }
        const start = textarea.selectionStart ?? text.length;
        const end = textarea.selectionEnd ?? start;
        const nextText = `${text.slice(0, start)}\n${text.slice(end)}`;
        const nextCursor = start + 1;
        applyTextInsertion(nextText, nextCursor);
        return;
      }
      if (
        isMobile &&
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !suggestionsOpen
      ) {
        if (!MOBILE_NEWLINE_CONTENT_PATTERN.test(text)) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }
        const start = textarea.selectionStart ?? text.length;
        const end = textarea.selectionEnd ?? start;
        const nextText = `${text.slice(0, start)}\n${text.slice(end)}`;
        const nextCursor = start + 1;
        applyTextInsertion(nextText, nextCursor);
        return;
      }
      if (reviewPromptOpen && onReviewPromptKeyDown) {
        const handled = onReviewPromptKeyDown(event);
        if (handled) {
          return;
        }
      }
      handleInputKeyDown(event);
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        if (expandFenceOnEnter) {
          const textarea = textareaRef.current;
          if (textarea) {
            const start = textarea.selectionStart ?? text.length;
            const end = textarea.selectionEnd ?? start;
            if (tryExpandFence(start, end)) {
              event.preventDefault();
              return;
            }
          }
        }
        if (isDictationBusy) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        const dismissKeyboardAfterSend = canSend && isMobile;
        handleSend(defaultSubmitIntent);
        if (dismissKeyboardAfterSend) {
          textareaRef.current?.blur();
        }
      }
    },
    [
      applyTextInsertion,
      canSend,
      continueListOnShiftEnter,
      defaultSubmitIntent,
      expandFenceOnEnter,
      expandFenceOnSpace,
      handleHistoryKeyDown,
      handleInputKeyDown,
      handleSend,
      isDictationBusy,
      isMac,
      onReviewPromptKeyDown,
      oppositeSubmitIntent,
      reviewPromptOpen,
      suggestionsOpen,
      text,
      textareaRef,
      tryExpandFence,
    ],
  );
}
