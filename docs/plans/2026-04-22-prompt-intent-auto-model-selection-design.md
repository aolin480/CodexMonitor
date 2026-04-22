# Prompt Intent Auto Model Selection Design

## Goal

Extend Prompt Intent so CodexMonitor can choose between the currently available runtime models automatically based on the user prompt, while still allowing manual override.

The intended behavior is:

- `Auto` mode classifies the prompt first, then selects the best runtime-available model/reasoning pair.
- `Manual next send` applies a user-selected model to one send only, then returns to `Auto`.
- `Manual for session` applies a user-selected model until the app restarts.
- The user can switch back to `Auto` at any time.

The selection goal is not “always cheapest” and not “always largest.” It is “best that still keeps cost reasonable.”

## Design Constraints

- The backend host remains the source of truth for model selection.
- The runtime `model/list` output remains the source of truth for what is selectable.
- The prompt classifier returns intent metadata, not a hardcoded final model choice.
- User overrides always take precedence over automatic selection.
- Auto selection must never overwrite the saved manual defaults unless the user explicitly chooses to save them.

## Proposed Flow

1. The user enters a prompt in the composer.
2. CodexMonitor checks the current routing mode.
3. If the mode is `Auto`, the backend sends the prompt to the classifier API.
4. The classifier returns a compact task intent and confidence signal.
5. CodexMonitor maps that intent onto the best runtime-available model and reasoning level.
6. If the mode is `Manual next send`, the selected model is used once and the mode returns to `Auto`.
7. If the mode is `Manual for session`, the selected model is reused until app restart or an explicit switch back to `Auto`.

## Routing Policy

The router should classify prompts into a small set of coarse task types, for example:

- simple edit
- code change
- high reasoning
- uncertain

CodexMonitor then applies its own policy:

- `simple edit` should prefer a cheaper capable model.
- `code change` should prefer a balanced model.
- `high reasoning` should prefer the strongest available model that is still cost-aware.
- `uncertain` should fall back to the current saved default or the best safe balanced choice.

This keeps the cost/capability policy inside CodexMonitor rather than outsourcing the final choice to the classifier.

## UI and State

The composer should expose three routing states:

- `Auto`
- `Manual next send`
- `Manual for session`

The active state should remain visible in the UI so the user can tell whether the next send will be automatic or pinned.

Recommended UX behavior:

- When the user picks a manual model, show a clear “next send” or “session” scope choice.
- When `Manual next send` completes, the app should revert to `Auto`.
- When `Manual for session` is active, the app should keep showing the pinned model until the app is restarted or the user switches back to `Auto`.

## Failure Behavior

If the classifier is unavailable, the credential is missing, or the router response cannot be parsed:

- do not block sending
- do not guess a model beyond the existing safe fallback policy
- fall back to the current default/manual model
- surface the failure in diagnostics when diagnostics are enabled

If the user override is active:

- prefer the override even if automatic routing would otherwise choose something different

## Testing Strategy

The feature should be covered at three levels:

- routing-policy unit tests for prompt intent to model selection
- send-path integration tests that verify the chosen model is actually used
- frontend state tests that verify `Auto`, `Manual next send`, and `Manual for session` behavior

The highest-value cases are:

- simple rename/refactor prompt chooses a lightweight model
- medium code-edit prompt chooses a balanced model
- complex/debugging prompt chooses the strongest reasonable model
- next-send override applies once and then returns to auto
- session override persists until app restart
- fallback behavior remains silent and deterministic

## Open Questions

- Should the classifier return only task intent, or also a recommended confidence threshold?
- Should `Manual for session` survive daemon reconnects, or only a full app restart?
- Should the selected routing mode be per-thread or global only for V1?

## Recommendation

Use a small classifier-to-policy design:

- classifier returns intent metadata
- CodexMonitor decides the model from the runtime candidate list
- manual override stays authoritative for the configured scope

This is the safest way to keep the router cost-aware without making the classifier the source of truth for model selection.
