import type { KeyboardEvent } from "react";
import type { WorkspaceThreadColor } from "../../../types";
import { ModalShell } from "../../design-system/components/modal/ModalShell";
import { WORKSPACE_THREAD_COLOR_OPTIONS } from "../utils/workspaceThreadColors";

type WorkspaceColorPromptProps = {
  workspaceName: string;
  currentColor: WorkspaceThreadColor | null;
  error?: string | null;
  isBusy?: boolean;
  onSelect: (color: WorkspaceThreadColor | null) => void;
  onCancel: () => void;
};

function handlePromptKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  isBusy: boolean,
  onCancel: () => void,
) {
  if (event.key === "Escape" && !isBusy) {
    event.preventDefault();
    onCancel();
  }
}

export function WorkspaceColorPrompt({
  workspaceName,
  currentColor,
  error = null,
  isBusy = false,
  onSelect,
  onCancel,
}: WorkspaceColorPromptProps) {
  return (
    <ModalShell
      className="workspace-color-modal"
      ariaLabel="Conversation color"
      onBackdropClick={() => {
        if (!isBusy) {
          onCancel();
        }
      }}
    >
      <div className="ds-modal-title workspace-color-modal-title">Conversation color</div>
      <div className="ds-modal-subtitle workspace-color-modal-subtitle">
        Set the faint conversation background for "{workspaceName}".
      </div>
      <div className="workspace-color-modal-grid" role="list">
        {WORKSPACE_THREAD_COLOR_OPTIONS.map((option, index) => {
          const isSelected = currentColor === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`workspace-color-modal-option${isSelected ? " is-selected" : ""}`}
              onClick={() => onSelect(option.value)}
              onKeyDown={(event) => handlePromptKeyDown(event, isBusy, onCancel)}
              disabled={isBusy}
              aria-pressed={isSelected}
              autoFocus={isSelected || (!currentColor && index === 0)}
            >
              <span
                className="workspace-color-modal-swatch"
                style={{
                  ["--workspace-color-swatch-rgb" as string]: option.rgb,
                  ["--workspace-color-swatch-secondary-rgb" as string]:
                    option.secondaryRgb ?? option.rgb,
                }}
                aria-hidden
              />
              <span className="workspace-color-modal-option-copy">
                <span className="workspace-color-modal-option-label">{option.label}</span>
                <span className="workspace-color-modal-option-state">
                  {isSelected ? "Current" : "Apply"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={`ghost ds-modal-button workspace-color-modal-clear${
          currentColor === null ? " is-selected" : ""
        }`}
        onClick={() => onSelect(null)}
        onKeyDown={(event) => handlePromptKeyDown(event, isBusy, onCancel)}
        disabled={isBusy}
        aria-pressed={currentColor === null}
      >
        {currentColor === null ? "Current: None" : "Clear color"}
      </button>
      {error ? <div className="ds-modal-error workspace-color-modal-error">{error}</div> : null}
      <div className="ds-modal-actions workspace-color-modal-actions">
        <button
          className="ghost ds-modal-button workspace-color-modal-button"
          onClick={onCancel}
          type="button"
          disabled={isBusy}
        >
          Close
        </button>
      </div>
    </ModalShell>
  );
}
