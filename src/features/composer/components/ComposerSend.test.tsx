/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isMobilePlatform } from "../../../utils/platformPaths";
import { Composer } from "./Composer";
import type {
  AppOption,
  AppMention,
  ComposerSendIntent,
  FollowUpMessageBehavior,
} from "../../../types";

vi.mock("../../../services/dragDrop", () => ({
  subscribeWindowDragDrop: vi.fn(() => () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `tauri://${path}`,
}));

vi.mock("../../../utils/platformPaths", async () => {
  const actual = await vi.importActual<typeof import("../../../utils/platformPaths")>(
    "../../../utils/platformPaths",
  );
  return {
    ...actual,
    isMobilePlatform: vi.fn(() => false),
  };
});

type HarnessProps = {
  onSend: (
    text: string,
    images: string[],
    appMentions?: AppMention[],
    submitIntent?: ComposerSendIntent,
  ) => void;
  apps?: AppOption[];
  isProcessing?: boolean;
  followUpMessageBehavior?: FollowUpMessageBehavior;
  steerAvailable?: boolean;
  selectedServiceTier?: "fast" | "flex" | null;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
};

function ComposerHarness({
  onSend,
  apps = [],
  isProcessing = false,
  followUpMessageBehavior = "queue",
  steerAvailable = false,
  selectedServiceTier = null,
  processingStartedAt = null,
  lastDurationMs = null,
}: HarnessProps) {
  const [draftText, setDraftText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  return (
    <Composer
      onSend={onSend}
      onStop={() => {}}
      canStop={false}
      isProcessing={isProcessing}
      appsEnabled={true}
      steerAvailable={steerAvailable}
      followUpMessageBehavior={followUpMessageBehavior}
      composerFollowUpHintEnabled={true}
      collaborationModes={[]}
      selectedCollaborationModeId={null}
      onSelectCollaborationMode={() => {}}
      models={[]}
      selectedModelId={null}
      onSelectModel={() => {}}
      reasoningOptions={[]}
      selectedEffort={null}
      onSelectEffort={() => {}}
      selectedServiceTier={selectedServiceTier}
      reasoningSupported={false}
      accessMode="current"
      onSelectAccessMode={() => {}}
      skills={[]}
      apps={apps}
      prompts={[]}
      files={[]}
      processingStartedAt={processingStartedAt}
      lastDurationMs={lastDurationMs}
      draftText={draftText}
      onDraftChange={setDraftText}
      textareaRef={textareaRef}
      dictationEnabled={false}
    />
  );
}

describe("Composer send triggers", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(isMobilePlatform).mockReturnValue(false);
    vi.restoreAllMocks();
  });

  it("sends once on Enter", () => {
    const onSend = vi.fn();
    render(<ComposerHarness onSend={onSend} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "hello world" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello world", [], undefined, "default");
  });

  it("sends once on send-button click", () => {
    const onSend = vi.fn();
    render(<ComposerHarness onSend={onSend} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "from button" } });
    fireEvent.click(screen.getByLabelText("Send"));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("from button", [], undefined, "default");
  });

  it("shows the fast-mode indicator when enabled", () => {
    const onSend = vi.fn();
    render(<ComposerHarness onSend={onSend} selectedServiceTier="fast" />);

    expect(screen.getByLabelText("Fast mode enabled")).toBeTruthy();
  });

  it("does not blur the textarea on mobile Enter because Enter inserts a newline", () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    const onSend = vi.fn();
    const blurSpy = vi.spyOn(HTMLTextAreaElement.prototype, "blur");
    render(<ComposerHarness onSend={onSend} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "dismiss keyboard" } });
    textarea.setSelectionRange(16, 16);
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    expect(blurSpy).not.toHaveBeenCalled();
    expect(textarea.value).toBe("dismiss keyboard\n");
  });

  it("inserts a newline instead of sending on mobile Enter", () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    const onSend = vi.fn();
    const blurSpy = vi.spyOn(HTMLTextAreaElement.prototype, "blur");
    render(<ComposerHarness onSend={onSend} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "line one" } });
    textarea.setSelectionRange(8, 8);
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    expect(blurSpy).not.toHaveBeenCalled();
    expect(textarea.value).toBe("line one\n");
    expect(textarea.selectionStart).toBe(9);
    expect(textarea.selectionEnd).toBe(9);
  });

  it("does nothing on mobile Enter when the composer only has whitespace", () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    const onSend = vi.fn();
    const blurSpy = vi.spyOn(HTMLTextAreaElement.prototype, "blur");
    render(<ComposerHarness onSend={onSend} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: " \n  " } });
    textarea.setSelectionRange(4, 4);
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    expect(blurSpy).not.toHaveBeenCalled();
    expect(textarea.value).toBe(" \n  ");
    expect(textarea.selectionStart).toBe(4);
    expect(textarea.selectionEnd).toBe(4);
  });

  it("does nothing on mobile Enter when the composer only has punctuation", () => {
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    const onSend = vi.fn();
    const blurSpy = vi.spyOn(HTMLTextAreaElement.prototype, "blur");
    render(<ComposerHarness onSend={onSend} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "!!!" } });
    textarea.setSelectionRange(3, 3);
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    expect(blurSpy).not.toHaveBeenCalled();
    expect(textarea.value).toBe("!!!");
    expect(textarea.selectionStart).toBe(3);
    expect(textarea.selectionEnd).toBe(3);
  });

  it("sends explicit app mentions when an app autocomplete item is selected", () => {
    const onSend = vi.fn();
    render(
      <ComposerHarness
        onSend={onSend}
        apps={[
          {
            id: "connector_calendar",
            name: "Calendar App",
            description: "Calendar integration",
            isAccessible: true,
          },
        ]}
      />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "$cal" } });
    fireEvent.keyDown(textarea, { key: "Tab" });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      "$calendar-app",
      [],
      [{ name: "Calendar App", path: "app://connector_calendar" }],
      "default",
    );
  });

  it("uses queue by default while processing when follow-up behavior is queue", () => {
    const onSend = vi.fn();
    render(
      <ComposerHarness
        onSend={onSend}
        isProcessing={true}
        followUpMessageBehavior="queue"
        steerAvailable={true}
      />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "queue this" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("queue this", [], undefined, "queue");
  });

  it("uses opposite follow-up behavior on Shift+Ctrl+Enter while processing", () => {
    const onSend = vi.fn();
    render(
      <ComposerHarness
        onSend={onSend}
        isProcessing={true}
        followUpMessageBehavior="queue"
        steerAvailable={true}
      />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "steer this" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true, ctrlKey: true });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("steer this", [], undefined, "steer");
  });

  it("falls back to queue when steer is selected but unavailable", () => {
    const onSend = vi.fn();
    render(
      <ComposerHarness
        onSend={onSend}
        isProcessing={true}
        followUpMessageBehavior="steer"
        steerAvailable={false}
      />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "queue fallback" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(
      screen.getByText(
        "Default: Queue (Steer unavailable). Both Enter and Shift+Ctrl+Enter will queue this message.",
      ),
    ).toBeTruthy();
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("queue fallback", [], undefined, "queue");
  });

  it("treats Shift+Ctrl+Enter like normal send when not processing", () => {
    const onSend = vi.fn();
    render(
      <ComposerHarness
        onSend={onSend}
        isProcessing={false}
        followUpMessageBehavior="queue"
        steerAvailable={true}
      />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "normal shortcut send" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true, ctrlKey: true });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      "normal shortcut send",
      [],
      undefined,
      "default",
    );
  });

  it("does not queue on Tab while processing", () => {
    const onSend = vi.fn();
    render(
      <ComposerHarness
        onSend={onSend}
        isProcessing={true}
        followUpMessageBehavior="queue"
        steerAvailable={true}
      />,
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "tab no send" } });
    fireEvent.keyDown(textarea, { key: "Tab" });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows a live elapsed timer while processing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T12:00:00.000Z"));

    render(
      <ComposerHarness
        onSend={vi.fn()}
        isProcessing={true}
        processingStartedAt={Date.now() - 850}
      />,
    );

    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("850ms")).toBeTruthy();
    expect(screen.getByRole("timer")).toBeTruthy();
    expect(
      screen.getByLabelText("Current turn elapsed time 850ms").getAttribute("title"),
    ).toBe("Current turn elapsed time: 850ms");

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText("1.1s")).toBeTruthy();
  });

  it("shows the last completed duration when idle", () => {
    render(<ComposerHarness onSend={vi.fn()} lastDurationMs={4_250} />);

    expect(screen.getByText("Last")).toBeTruthy();
    expect(screen.getByText("4.3s")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(
      screen.getByLabelText("Last turn duration 4.3s").getAttribute("title"),
    ).toBe("Last turn completed in 4.3s");
  });

  it("treats a zero processing timestamp as a valid timer start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("1970-01-01T00:00:00.500Z"));

    render(
      <ComposerHarness
        onSend={vi.fn()}
        isProcessing={true}
        processingStartedAt={0}
      />,
    );

    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("500ms")).toBeTruthy();
  });

  it("hides the duration badge when no timing is available", () => {
    render(<ComposerHarness onSend={vi.fn()} />);

    expect(screen.queryByText("Live")).toBeNull();
    expect(screen.queryByText("Last")).toBeNull();
  });

  it("does not show a live badge before processing has a start time", () => {
    render(
      <ComposerHarness
        onSend={vi.fn()}
        isProcessing={true}
        processingStartedAt={null}
      />,
    );

    expect(screen.queryByText("Live")).toBeNull();
    expect(screen.queryByLabelText(/Current turn elapsed time/i)).toBeNull();
  });

  it("switches from live elapsed time to the last completed duration", () => {
    const { rerender } = render(
      <ComposerHarness
        onSend={vi.fn()}
        isProcessing={true}
        processingStartedAt={Date.now() - 1_200}
      />,
    );

    expect(screen.getByLabelText("Current turn elapsed time 1.2s")).toBeTruthy();

    rerender(<ComposerHarness onSend={vi.fn()} lastDurationMs={4_250} />);

    expect(screen.getByLabelText("Last turn duration 4.3s")).toBeTruthy();
    expect(screen.queryByText("Live")).toBeNull();
  });

  it("stops live timer updates after the composer rerenders idle", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T12:00:00.000Z"));

    const { rerender } = render(
      <ComposerHarness
        onSend={vi.fn()}
        isProcessing={true}
        processingStartedAt={Date.now() - 900}
      />,
    );

    expect(screen.getByText("900ms")).toBeTruthy();

    rerender(<ComposerHarness onSend={vi.fn()} lastDurationMs={2_500} />);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(screen.getByText("2.5s")).toBeTruthy();
    expect(screen.queryByText("2.7s")).toBeNull();
  });

  it("pauses live timer updates while the document is hidden", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T12:00:00.000Z"));

    render(
      <ComposerHarness
        onSend={vi.fn()}
        isProcessing={true}
        processingStartedAt={Date.now() - 900}
      />,
    );

    const getBadgeText = () =>
      screen.getByLabelText(/Current turn elapsed time/i).textContent;

    expect(getBadgeText()).toContain("900ms");

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    const hiddenBadgeText = getBadgeText();

    act(() => {
      vi.advanceTimersByTime(1_500);
    });

    expect(getBadgeText()).toBe(hiddenBadgeText);

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(screen.getByText("2.4s")).toBeTruthy();
  });
});
