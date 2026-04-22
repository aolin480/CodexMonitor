/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComposerMetaBar } from "./ComposerMetaBar";

const baseProps = {
  disabled: false,
  collaborationModes: [],
  selectedCollaborationModeId: null,
  onSelectCollaborationMode: vi.fn(),
  models: [{ id: "gpt-5.4", displayName: "GPT-5.4", model: "gpt-5.4" }],
  selectedModelId: "gpt-5.4",
  onSelectModel: vi.fn(),
  reasoningOptions: ["low", "medium", "high"],
  selectedEffort: "medium",
  onSelectEffort: vi.fn(),
  selectedServiceTier: null,
  reasoningSupported: true,
  autoModelRoutingCredentialConfigured: true,
  onOpenAutoModelRoutingSettings: vi.fn(),
  accessMode: "current" as const,
  onSelectAccessMode: vi.fn(),
};

describe("ComposerMetaBar", () => {
  it("renders a compact auto-routing badge when a routing decision is present", () => {
    render(
      <ComposerMetaBar
        {...baseProps}
        activeAutoModelRoutingDecision={{
          mode: "responsive",
          provider: "openai",
          selectedModel: "gpt-5.4",
          selectedReasoningEffort: "medium",
          fallbackUsed: false,
          reason: "Matched a balanced coding task.",
          confidence: 0.78,
          taskType: "coding",
          complexity: "medium",
          ambiguity: "low",
          needsTools: true,
          needsLargeContext: false,
          policyNote: null,
        }}
      />,
    );

    expect(
      screen.getByRole("status", {
        name: "Auto routing selected gpt-5.4 with medium reasoning",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Auto")).toBeTruthy();
    expect(screen.getByText(/gpt-5\.4/)).toBeTruthy();
  });

  it("renders a fallback label when the routing decision used fallback", () => {
    render(
      <ComposerMetaBar
        {...baseProps}
        activeAutoModelRoutingDecision={{
          mode: "responsive",
          provider: "openai",
          selectedModel: "gpt-5.4-mini",
          selectedReasoningEffort: null,
          fallbackUsed: true,
          reason: "Router unavailable; using fallback.",
          confidence: null,
          taskType: "fallback",
          complexity: "unknown",
          ambiguity: "unknown",
          needsTools: false,
          needsLargeContext: false,
          policyNote: "Mode policy selected the default runtime candidate.",
        }}
      />,
    );

    expect(screen.getByText("Auto fallback")).toBeTruthy();
    expect(screen.getByText(/gpt-5\.4-mini/)).toBeTruthy();
  });

  it("truncates long reason text in the hover title", () => {
    const longReason =
      "This is a very long diagnostics reason that should not be rendered in full in the badge tooltip because it turns a compact hover affordance into a noisy wall of policy text for the user.";

    render(
      <ComposerMetaBar
        {...baseProps}
        activeAutoModelRoutingDecision={{
          mode: "responsive",
          provider: "openai",
          selectedModel: "gpt-5.4",
          selectedReasoningEffort: "medium",
          fallbackUsed: false,
          reason: longReason,
          confidence: 0.82,
          taskType: "coding",
          complexity: "medium",
          ambiguity: "low",
          needsTools: true,
          needsLargeContext: false,
          policyNote: null,
        }}
      />,
    );

    const badges = screen.getAllByRole("status", {
      name: "Auto routing selected gpt-5.4 with medium reasoning",
    });
    const badge = badges[badges.length - 1];
    expect(badge).toBeTruthy();
    expect(badge?.getAttribute("title")).toContain("Router selection: gpt-5.4 (medium)");
    expect(badge?.getAttribute("title")).toContain("…");
    expect(badge?.getAttribute("title")?.length).toBeLessThan(longReason.length);
  });

  it("shows Auto in the model picker and hides reasoning when Auto is selected", () => {
    const { container } = render(
      <ComposerMetaBar
        {...baseProps}
        selectedModelId={null}
        reasoningSupported={false}
        selectedEffort={null}
      />,
    );

    const scoped = within(container);
    const modelSelect = scoped.getByRole("combobox", {
      name: "Model",
    }) as HTMLSelectElement;
    expect(modelSelect.value).toBe("__auto__");
    expect(scoped.queryByRole("combobox", { name: "Thinking mode" })).toBeNull();
  });

  it("shows a setup action when Auto is unavailable", () => {
    const onOpenAutoModelRoutingSettings = vi.fn();

    render(
      <ComposerMetaBar
        {...baseProps}
        autoModelRoutingCredentialConfigured={false}
        onOpenAutoModelRoutingSettings={onOpenAutoModelRoutingSettings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(onOpenAutoModelRoutingSettings).toHaveBeenCalledTimes(1);
  });
});
