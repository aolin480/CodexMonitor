import { memo, useEffect, useState, type CSSProperties } from "react";
import { BrainCog, SlidersHorizontal, Zap } from "lucide-react";
import type {
  AccessMode,
  AutoModelRoutingDecision,
  ServiceTier,
  ThreadTokenUsage,
} from "../../../types";
import type { CodexArgsOption } from "../../threads/utils/codexArgsProfiles";

type ComposerMetaBarProps = {
  disabled: boolean;
  collaborationModes: { id: string; label: string }[];
  selectedCollaborationModeId: string | null;
  onSelectCollaborationMode: (id: string | null) => void;
  models: { id: string; displayName: string; model: string }[];
  selectedModelId: string | null;
  onSelectModel: (id: string) => void;
  reasoningOptions: string[];
  selectedEffort: string | null;
  onSelectEffort: (effort: string) => void;
  selectedServiceTier: ServiceTier | null;
  activeAutoModelRoutingDecision?: AutoModelRoutingDecision | null;
  reasoningSupported: boolean;
  accessMode: AccessMode;
  onSelectAccessMode: (mode: AccessMode) => void;
  codexArgsOptions?: CodexArgsOption[];
  selectedCodexArgsOverride?: string | null;
  onSelectCodexArgsOverride?: (value: string | null) => void;
  contextUsage?: ThreadTokenUsage | null;
  durationBadge?: {
    isProcessing: boolean;
    processingStartedAt?: number | null;
    lastDurationMs?: number | null;
  };
};

function formatComposerDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${Math.max(0, Math.round(durationMs))}ms`;
  }
  if (durationMs < 10_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${Math.max(1, Math.round(durationMs / 1000))}s`;
}

function getComposerDurationTickDelay(elapsedMs: number) {
  if (elapsedMs < 1000) {
    return 200;
  }
  if (elapsedMs < 10_000) {
    return 250;
  }
  return 1000;
}

const ComposerDurationBadge = memo(function ComposerDurationBadge({
  isProcessing,
  processingStartedAt = null,
  lastDurationMs = null,
}: NonNullable<ComposerMetaBarProps["durationBadge"]>) {
  const getLiveElapsedMs = () =>
    isProcessing && processingStartedAt != null
      ? Math.max(0, Date.now() - processingStartedAt)
      : 0;
  const [currentElapsedMs, setCurrentElapsedMs] = useState(getLiveElapsedMs);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );

  useEffect(() => {
    setCurrentElapsedMs(getLiveElapsedMs());
  }, [isProcessing, processingStartedAt]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = () => {
      const nextVisible = document.visibilityState !== "hidden";
      setIsDocumentVisible(nextVisible);
      if (nextVisible && isProcessing && processingStartedAt != null) {
        setCurrentElapsedMs(Math.max(0, Date.now() - processingStartedAt));
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!isProcessing || processingStartedAt == null) {
      setCurrentElapsedMs(0);
      return;
    }

    if (!isDocumentVisible) {
      setCurrentElapsedMs(Math.max(0, Date.now() - processingStartedAt));
      return;
    }

    let isCancelled = false;
    let timeoutId: number | null = null;

    const scheduleNextTick = () => {
      if (isCancelled) {
        return;
      }
      const elapsedMs = Math.max(0, Date.now() - processingStartedAt);
      setCurrentElapsedMs(elapsedMs);
      const nextDelay = getComposerDurationTickDelay(elapsedMs);
      timeoutId = window.setTimeout(() => {
        if (!isCancelled) {
          scheduleNextTick();
        }
      }, nextDelay);
    };

    scheduleNextTick();

    return () => {
      isCancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isDocumentVisible, isProcessing, processingStartedAt]);

  const visibleDurationMs = isProcessing
    ? processingStartedAt != null
      ? currentElapsedMs
      : null
    : lastDurationMs;

  if (visibleDurationMs == null) {
    return null;
  }

  const durationLabel = formatComposerDuration(visibleDurationMs);
  const durationTitle = isProcessing
    ? `Current turn elapsed time: ${durationLabel}`
    : `Last turn completed in ${durationLabel}`;
  const durationAriaLabel = isProcessing
    ? `Current turn elapsed time ${durationLabel}`
    : `Last turn duration ${durationLabel}`;
  const durationStatusLabel = isProcessing ? "Live" : "Last";

  return (
    <div
      className={`composer-duration-badge${isProcessing ? " is-live" : ""}`}
      role={isProcessing ? "timer" : "status"}
      aria-label={durationAriaLabel}
      aria-atomic="true"
      title={durationTitle}
    >
      <span className="composer-duration-label">{durationStatusLabel}</span>
      <span className="composer-duration-value">{durationLabel}</span>
    </div>
  );
});

function buildRoutingDecisionTitle(decision: AutoModelRoutingDecision) {
  const truncateLine = (value: string, maxLength = 120) =>
    value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;
  const effortLabel = decision.selectedReasoningEffort ?? "default";
  const statusLabel = decision.fallbackUsed ? "Fallback selection" : "Router selection";
  const lines = [
    `${statusLabel}: ${decision.selectedModel} (${effortLabel})`,
    truncateLine(decision.reason),
  ];
  if (decision.policyNote) {
    lines.push(truncateLine(decision.policyNote));
  }
  return lines.join("\n");
}

const ComposerRoutingBadge = memo(function ComposerRoutingBadge({
  decision,
}: {
  decision: AutoModelRoutingDecision;
}) {
  const effortLabel = decision.selectedReasoningEffort ?? "default";

  return (
    <div
      className={`composer-routing-badge${decision.fallbackUsed ? " is-fallback" : ""}`}
      role="status"
      aria-label={`Auto routing selected ${decision.selectedModel} with ${effortLabel} reasoning`}
      title={buildRoutingDecisionTitle(decision)}
    >
      <span className="composer-routing-badge-label">
        {decision.fallbackUsed ? "Auto fallback" : "Auto"}
      </span>
      <span className="composer-routing-badge-value">
        {decision.selectedModel}
        <span className="composer-routing-badge-separator" aria-hidden>
          •
        </span>
        {effortLabel}
      </span>
    </div>
  );
});

export function ComposerMetaBar({
  disabled,
  collaborationModes,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  models,
  selectedModelId,
  onSelectModel,
  reasoningOptions,
  selectedEffort,
  onSelectEffort,
  selectedServiceTier,
  activeAutoModelRoutingDecision = null,
  reasoningSupported,
  accessMode,
  onSelectAccessMode,
  codexArgsOptions = [],
  selectedCodexArgsOverride = null,
  onSelectCodexArgsOverride,
  contextUsage = null,
  durationBadge = undefined,
}: ComposerMetaBarProps) {
  const selectedModel =
    models.find((model) => model.id === selectedModelId) ?? null;
  const selectedModelLabel =
    selectedModel?.displayName || selectedModel?.model || "No models";
  const modelSelectStyle = {
    "--composer-model-select-width": `${Math.max(selectedModelLabel.length + 2, 8)}ch`,
  } as CSSProperties;
  const contextWindow = contextUsage?.modelContextWindow ?? null;
  const lastTokens = contextUsage?.last.totalTokens ?? 0;
  const totalTokens = contextUsage?.total.totalTokens ?? 0;
  const usedTokens = lastTokens > 0 ? lastTokens : totalTokens;
  const contextFreePercent =
    contextWindow && contextWindow > 0 && usedTokens > 0
      ? Math.max(
          0,
          100 -
            Math.min(Math.max((usedTokens / contextWindow) * 100, 0), 100),
        )
      : null;
  const planMode =
    collaborationModes.find((mode) => mode.id === "plan") ?? null;
  const defaultMode =
    collaborationModes.find((mode) => mode.id === "default") ?? null;
  const canUsePlanToggle =
    Boolean(planMode) &&
    collaborationModes.every(
      (mode) => mode.id === "default" || mode.id === "plan",
    );
  const planSelected = selectedCollaborationModeId === (planMode?.id ?? "");

  return (
    <div className="composer-bar">
      <div className="composer-meta">
        {collaborationModes.length > 0 && (
          canUsePlanToggle ? (
            <div className="composer-select-wrap composer-plan-toggle-wrap">
              <label className="composer-plan-toggle" aria-label="Plan mode">
                <input
                  className="composer-plan-toggle-input"
                  type="checkbox"
                  checked={planSelected}
                  disabled={disabled}
                  onChange={(event) =>
                    onSelectCollaborationMode(
                      event.target.checked
                        ? planMode?.id ?? "plan"
                        : (defaultMode?.id ?? null),
                    )
                  }
                />
                <span className="composer-plan-toggle-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="m6.5 7.5 1 1 2-2M6.5 12.5l1 1 2-2M6.5 17.5l1 1 2-2M11 7.5h7M11 12.5h7M11 17.5h7"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="composer-plan-toggle-label">
                  {planMode?.label || "Plan"}
                </span>
              </label>
            </div>
          ) : (
            <div className="composer-select-wrap">
            <span className="composer-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="m6.5 7.5 1 1 2-2M6.5 12.5l1 1 2-2M6.5 17.5l1 1 2-2M11 7.5h7M11 12.5h7M11 17.5h7"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
              <select
                className="composer-select composer-select--model composer-select--collab"
                aria-label="Collaboration mode"
                value={selectedCollaborationModeId ?? ""}
                onChange={(event) =>
                  onSelectCollaborationMode(event.target.value || null)
                }
                disabled={disabled}
              >
                {collaborationModes.map((mode) => (
                  <option key={mode.id} value={mode.id}>
                    {mode.label || mode.id}
                  </option>
                ))}
              </select>
            </div>
          )
        )}
        <div className="composer-select-wrap composer-select-wrap--model">
          <span className="composer-icon composer-icon--model" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 4v2"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M8 7.5h8a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 15v-5A2.5 2.5 0 0 1 8 7.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <circle cx="9.5" cy="12.5" r="1" fill="currentColor" />
              <circle cx="14.5" cy="12.5" r="1" fill="currentColor" />
              <path
                d="M9.5 15.5h5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M5.5 11H4M20 11h-1.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <select
            className="composer-select composer-select--model"
            aria-label="Model"
            value={selectedModelId ?? ""}
            onChange={(event) => onSelectModel(event.target.value)}
            disabled={disabled}
            style={modelSelectStyle}
          >
            {models.length === 0 && <option value="">No models</option>}
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName || model.model}
              </option>
            ))}
          </select>
          {selectedServiceTier === "fast" && (
            <span
              className="composer-fast-indicator"
              role="status"
              aria-label="Fast mode enabled"
              title="Fast mode enabled"
            >
              <Zap size={12} strokeWidth={1.8} />
            </span>
          )}
        </div>
        <div className="composer-select-wrap composer-select-wrap--effort">
          <span className="composer-icon composer-icon--effort" aria-hidden>
            <BrainCog size={14} strokeWidth={1.8} />
          </span>
          <select
            className="composer-select composer-select--effort"
            aria-label="Thinking mode"
            value={selectedEffort ?? ""}
            onChange={(event) => onSelectEffort(event.target.value)}
            disabled={disabled || !reasoningSupported}
          >
            {reasoningOptions.length === 0 && <option value="">Default</option>}
            {reasoningOptions.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
        </div>
        {activeAutoModelRoutingDecision && (
          <ComposerRoutingBadge decision={activeAutoModelRoutingDecision} />
        )}
        {codexArgsOptions.length > 1 && onSelectCodexArgsOverride && (
          <div className="composer-select-wrap">
            <span className="composer-icon" aria-hidden>
              <SlidersHorizontal size={14} strokeWidth={1.8} />
            </span>
            <select
              className="composer-select composer-select--approval"
              aria-label="Codex args profile"
              disabled={disabled}
              value={selectedCodexArgsOverride ?? ""}
              onChange={(event) =>
                onSelectCodexArgsOverride(event.target.value || null)
              }
            >
              {codexArgsOptions.map((option) => (
                <option key={option.value || "default"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="composer-select-wrap">
          <span className="composer-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 4l7 3v5c0 4.5-3 7.5-7 8-4-0.5-7-3.5-7-8V7l7-3z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path
                d="M9.5 12.5l1.8 1.8 3.7-4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <select
            className="composer-select composer-select--approval"
            aria-label="Agent access"
            disabled={disabled}
            value={accessMode}
            onChange={(event) =>
              onSelectAccessMode(event.target.value as AccessMode)
            }
          >
            <option value="read-only">Read only</option>
            <option value="current">On-Request</option>
            <option value="full-access">Full access</option>
          </select>
        </div>
      </div>
      <div className="composer-context">
        {durationBadge ? <ComposerDurationBadge {...durationBadge} /> : null}
        <div
          className="composer-context-ring"
          data-tooltip={
            contextFreePercent === null
              ? "Context free --"
              : `Context free ${Math.round(contextFreePercent)}%`
          }
          aria-label={
            contextFreePercent === null
              ? "Context free --"
              : `Context free ${Math.round(contextFreePercent)}%`
          }
          style={
            {
              "--context-free": contextFreePercent ?? 0,
            } as CSSProperties
          }
        >
          <span className="composer-context-value">●</span>
        </div>
      </div>
    </div>
  );
}
