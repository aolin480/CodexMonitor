# Prompt Intent Auto Model Selection Design

## Goal

Extend Prompt Intent so CodexMonitor can choose between the currently available runtime models automatically based on the user prompt, while still allowing manual override.

The intended behavior is:

- `Auto (prompt intent)` classifies the prompt first, then selects the best runtime-available model/reasoning pair.
- Selecting a concrete model bypasses prompt-intent routing and keeps that model active until the user switches back to `Auto (prompt intent)`.
- Reasoning controls only appear when the currently selected concrete model exposes reasoning options.

The selection goal is not “always cheapest” and not “always largest.” It is “best that still keeps cost reasonable.”

## Design Constraints

- The backend host remains the source of truth for model selection.
- The runtime `model/list` output remains the source of truth for what is selectable.
- The prompt classifier returns intent metadata, not a hardcoded final model choice.
- Manual model selection always takes precedence over automatic selection.
- Auto selection must never overwrite the saved manual defaults unless the user explicitly chooses to save them.

## Proposed Flow

1. The user enters a prompt in the composer.
2. CodexMonitor checks the selected model source.
3. If the selected option is `Auto (prompt intent)`, the backend sends the prompt to the classifier API.
4. The classifier returns a compact task intent and confidence signal.
5. CodexMonitor maps that intent onto the best runtime-available model and reasoning level.
6. If the selected option is a concrete model, CodexMonitor uses that model directly and bypasses prompt-intent routing.
7. The selected concrete model remains active until the user explicitly switches back to `Auto (prompt intent)`.

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

The composer model selector should become the primary routing control.

Recommended UX behavior:

- Add `Auto (prompt intent)` as the first entry in the model selector.
- Show concrete runtime models below it in the same list.
- If `Auto (prompt intent)` is selected, hide the reasoning selector.
- If a concrete model is selected, show the reasoning selector only when that model supports reasoning.
- Keep the active selection visible in the same composer control so the user can always tell whether prompt-intent routing or a pinned model is controlling the next send.

## Failure Behavior

If the classifier is unavailable, the credential is missing, or the router response cannot be parsed:

- do not block sending
- do not guess a model beyond the existing safe fallback policy
- fall back to the current default/manual model
- surface the failure in diagnostics when diagnostics are enabled

If a concrete model is selected:

- prefer the manual model even if automatic routing would otherwise choose something different

## Testing Strategy

The feature should be covered at three levels:

- routing-policy unit tests for prompt intent to model selection
- send-path integration tests that verify the chosen model is actually used
- frontend state tests that verify `Auto (prompt intent)` versus pinned-model behavior

The highest-value cases are:

- simple rename/refactor prompt chooses a lightweight model
- medium code-edit prompt chooses a balanced model
- complex/debugging prompt chooses the strongest reasonable model
- selecting `Auto (prompt intent)` hides reasoning controls
- selecting a concrete model shows reasoning controls when supported
- manual model selection persists until the user switches back to `Auto (prompt intent)`
- fallback behavior remains silent and deterministic

## Open Questions

- Should the classifier return only task intent, or also a recommended confidence threshold?
- Should the selected model source be global only for V1, or eventually be thread-scoped?

## Recommendation

Use a small classifier-to-policy design:

- classifier returns intent metadata
- CodexMonitor decides the model from the runtime candidate list
- the composer selector exposes one `Auto (prompt intent)` entry plus concrete manual models
- manual model selection stays authoritative until the user switches back to `Auto (prompt intent)`

This is the safest way to keep the router cost-aware without making the classifier the source of truth for model selection.
