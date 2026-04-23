/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ModelOption } from "../../../types";
import { WorkspaceHomeRunControls } from "./WorkspaceHomeRunControls";

const models: ModelOption[] = [
  {
    id: "gpt-5.4",
    model: "gpt-5.4",
    displayName: "GPT-5.4",
    description: "Test model",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Low" },
      { reasoningEffort: "medium", description: "Medium" },
    ],
    defaultReasoningEffort: "medium",
    isDefault: true,
  },
];

const baseProps = {
  workspaceKind: "main" as const,
  runMode: "local" as const,
  onRunModeChange: vi.fn(),
  models,
  selectedModelSelectionMode: "auto" as const,
  selectedModelId: null,
  onSelectModel: vi.fn(),
  autoModelRoutingCredentialConfigured: true,
  onOpenAutoModelRoutingSettings: vi.fn(),
  modelSelections: {},
  onToggleModel: vi.fn(),
  onModelCountChange: vi.fn(),
  collaborationModes: [],
  selectedCollaborationModeId: null,
  onSelectCollaborationMode: vi.fn(),
  reasoningOptions: ["low", "medium"],
  selectedEffort: null,
  onSelectEffort: vi.fn(),
  reasoningSupported: false,
  isSubmitting: false,
};

describe("WorkspaceHomeRunControls", () => {
  it("hides reasoning when Auto is selected for local runs", () => {
    render(<WorkspaceHomeRunControls {...baseProps} />);

    expect(screen.queryByRole("combobox", { name: "Thinking mode" })).toBeNull();
  });

  it("shows Auto setup affordance when routing credentials are unavailable", () => {
    const onOpenAutoModelRoutingSettings = vi.fn();

    const { container } = render(
      <WorkspaceHomeRunControls
        {...baseProps}
        autoModelRoutingCredentialConfigured={false}
        onOpenAutoModelRoutingSettings={onOpenAutoModelRoutingSettings}
      />,
    );

    const controls = within(container);
    const toggleButtons = controls.getAllByRole("button", {
      name: "Toggle models menu",
    });
    fireEvent.click(toggleButtons[toggleButtons.length - 1]!);
    fireEvent.click(screen.getByRole("button", { name: /Set up Auto/i }));

    expect(onOpenAutoModelRoutingSettings).toHaveBeenCalledTimes(1);
  });

  it("shows a disabled loading state while Auto credential status is unknown", () => {
    const { container } = render(
      <WorkspaceHomeRunControls
        {...baseProps}
        autoModelRoutingCredentialConfigured={null}
      />,
    );

    const controls = within(container);
    const toggleButtons = controls.getAllByRole("button", {
      name: "Toggle models menu",
    });
    fireEvent.click(toggleButtons[toggleButtons.length - 1]!);

    const autoButton = screen.getByRole("button", {
      name: /Auto \(checking Settings/i,
    });
    expect(autoButton.getAttribute("disabled")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: /Set up Auto/i }),
    ).toBeNull();
  });
});
