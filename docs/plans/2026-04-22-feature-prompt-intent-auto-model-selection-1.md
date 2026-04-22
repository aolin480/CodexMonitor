---
goal: Prompt Intent Auto Model Selection
version: 1.0
date_created: 2026-04-22
last_updated: 2026-04-22
owner: CodexMonitor
status: 'Planned'
tags: [feature, routing, prompt-intent, auto-model-selection]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan extends Prompt Intent so CodexMonitor can select between runtime-available models automatically based on the user's prompt, while still preserving manual overrides for the next send or the whole app session.

## 1. Requirements & Constraints

- **REQ-001**: `Auto` mode must classify the prompt first and then select the best runtime-available model/reasoning pair.
- **REQ-002**: `Manual next send` must apply the user-selected model to exactly one send, then return to `Auto`.
- **REQ-003**: `Manual for session` must apply the user-selected model until the app restarts.
- **REQ-004**: The user must be able to switch back to `Auto` at any time.
- **REQ-005**: The backend host must remain the source of truth for selection decisions.
- **REQ-006**: The runtime `model/list` output must remain the source of truth for selectable candidates.
- **REQ-007**: The classifier must return intent metadata, not a final hardcoded model choice.
- **REQ-008**: Manual overrides must always take precedence over automatic selection.
- **REQ-009**: Auto selection must not overwrite saved manual defaults unless the user explicitly saves them.
- **CON-001**: The feature must preserve app/daemon parity for backend behavior.
- **CON-002**: The feature must not block sending when the classifier or router is unavailable.
- **CON-003**: The feature must keep fallback behavior deterministic and silent unless diagnostics are enabled.
- **SEC-001**: Router credentials must remain in the backend-host secure store path already established for Prompt Intent.
- **PAT-001**: Keep shared backend logic in `src-tauri/src/shared/*` first, then adapt through app and daemon layers.
- **PAT-002**: Keep frontend state orchestration in hooks/orchestration modules, not inline in presentational components.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Define the routing-mode contract and frontend state surface for `Auto`, `Manual next send`, and `Manual for session`.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Extend `src/types.ts` with explicit routing-mode and override-scope types for the new two-level manual override behavior. |  |  |
| TASK-002 | Extend `src-tauri/src/types.rs` with matching backend settings/state types so frontend and backend remain contract-aligned. |  |  |
| TASK-003 | Update `src/features/settings/hooks/useAppSettings.ts` so persisted settings can represent the new routing mode and override scope. |  |  |
| TASK-004 | Update `src/features/settings/hooks/useSettingsCodexSection.ts` and `src/features/settings/components/sections/SettingsCodexSection.tsx` so the UI can display and edit the three routing states. |  |  |

### Implementation Phase 2

- GOAL-002: Implement backend prompt classification and model-selection policy in shared Rust code.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Extend `src-tauri/src/shared/prompt_routing_core.rs` with prompt-intent classification results that are intent metadata only, not final model selections. |  |  |
| TASK-006 | Add policy mapping in `src-tauri/src/shared/prompt_routing_core.rs` that converts prompt intent plus runtime candidates into the selected model and reasoning effort. |  |  |
| TASK-007 | Preserve fallback behavior in `src-tauri/src/shared/prompt_routing_core.rs` so missing credentials, parse failures, or unavailable router responses still fall back deterministically. |  |  |
| TASK-008 | Keep app and daemon behavior aligned by flowing the shared routing result through `src-tauri/src/shared/codex_core.rs`, `src-tauri/src/prompt_routing.rs`, `src-tauri/src/lib.rs`, and `src-tauri/src/bin/codex_monitor_daemon/rpc.rs`. |  |  |

### Implementation Phase 3

- GOAL-003: Wire the frontend send path and composer state so routing mode and manual override scope behave correctly.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | Update `src/features/threads/hooks/useThreadMessaging.ts` so the send path respects `Auto`, `Manual next send`, and `Manual for session` before issuing the backend send call. |  |  |
| TASK-010 | Update `src/features/threads/hooks/useThreads.ts` and any thread-state reducers needed so routing state remains visible to the active composer without mutating saved manual defaults. |  |  |
| TASK-011 | Update `src/features/composer/components/Composer.tsx` and `src/features/composer/components/ComposerMetaBar.tsx` so the active routing state and override scope are visible and user-switchable. |  |  |
| TASK-012 | Update `src/services/tauri.ts` so the frontend request/response contract can carry the routing decision metadata without changing the stable send API shape. |  |  |

### Implementation Phase 4

- GOAL-004: Add verification coverage for routing selection, override scope, and daemon parity.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-013 | Add Rust unit tests in `src-tauri/src/shared/prompt_routing_core.rs` for simple-edit, code-change, high-reasoning, and fallback classification outcomes. |  |  |
| TASK-014 | Extend `src-tauri/src/bin/codex_monitor_daemon.rs` tests to assert daemon RPC parity for the routed model, reasoning effort, and routing metadata. |  |  |
| TASK-015 | Extend `src/features/threads/hooks/useThreads.integration.test.tsx` and `src/features/threads/hooks/useThreadMessaging.test.tsx` to cover active-thread state, next-send override, and session override behavior. |  |  |
| TASK-016 | Verify the feature with `npm run typecheck`, targeted frontend tests, `cd src-tauri && cargo test --lib prompt_routing_core`, and targeted daemon integration tests. |  |  |

## 3. Alternatives

- **ALT-001**: Directly let the classifier choose the final model and reasoning pair. Rejected because it makes CodexMonitor dependent on the classifier's model preferences instead of keeping policy in the app.
- **ALT-002**: Use a purely local heuristic router with no classifier call. Rejected because prompt nuance matters and the design goal is prompt-aware selection rather than a static rules table.
- **ALT-003**: Make manual override sticky until the user clears it. Rejected because the requested behavior is a bounded `next send` mode plus an app-session mode.

## 4. Dependencies

- **DEP-001**: Existing Prompt Intent backend routing foundation in `src-tauri/src/shared/prompt_routing_core.rs`.
- **DEP-002**: Existing backend-host secure credential storage path already implemented for router credentials.
- **DEP-003**: Runtime `model/list` availability from the Codex backend session.
- **DEP-004**: Existing frontend thread/composer state plumbing in `src/features/threads/hooks/*` and `src/features/composer/components/*`.
- **DEP-005**: Existing Tauri IPC contract in `src/services/tauri.ts` and `src-tauri/src/lib.rs`.

## 5. Files

- **FILE-001**: `src/types.ts` - frontend routing mode and override scope contract.
- **FILE-002**: `src-tauri/src/types.rs` - backend settings/state contract mirroring the frontend.
- **FILE-003**: `src/features/settings/hooks/useAppSettings.ts` - persisted settings loading/normalization.
- **FILE-004**: `src/features/settings/hooks/useSettingsCodexSection.ts` - settings section state wiring.
- **FILE-005**: `src/features/settings/components/sections/SettingsCodexSection.tsx` - UI controls for routing mode and override scope.
- **FILE-006**: `src-tauri/src/shared/prompt_routing_core.rs` - classifier and policy engine.
- **FILE-007**: `src-tauri/src/shared/codex_core.rs` - shared send-path decision application.
- **FILE-008**: `src-tauri/src/prompt_routing.rs` - app command surface for routing state and decisions.
- **FILE-009**: `src-tauri/src/lib.rs` - Tauri command registration.
- **FILE-010**: `src-tauri/src/bin/codex_monitor_daemon/rpc.rs` - daemon RPC registration.
- **FILE-011**: `src/features/threads/hooks/useThreadMessaging.ts` - send-path orchestration and override scope handling.
- **FILE-012**: `src/features/threads/hooks/useThreads.ts` - active-thread routing state exposure.
- **FILE-013**: `src/features/composer/components/Composer.tsx` - routing state controls in the composer.
- **FILE-014**: `src/features/composer/components/ComposerMetaBar.tsx` - compact routing badge / diagnostics surface.
- **FILE-015**: `src/services/tauri.ts` - frontend send API contract.
- **FILE-016**: `src-tauri/src/bin/codex_monitor_daemon.rs` - daemon parity tests.
- **FILE-017**: `src/features/threads/hooks/useThreads.integration.test.tsx` - frontend integration coverage.
- **FILE-018**: `src/features/threads/hooks/useThreadMessaging.test.tsx` - send-path behavior tests.

## 6. Testing

- **TEST-001**: `npm run typecheck` must pass after the contract changes.
- **TEST-002**: `npm run test -- src/features/threads/hooks/useThreadMessaging.test.tsx src/features/threads/hooks/useThreads.integration.test.tsx` must cover `Auto`, `Manual next send`, and `Manual for session` behavior.
- **TEST-003**: `cd src-tauri && cargo test --lib prompt_routing_core` must validate classification and policy selection.
- **TEST-004**: `cd src-tauri && cargo test --bin codex_monitor_daemon <targeted-routing-test>` must prove daemon RPC parity for routed model and routing metadata.
- **TEST-005**: `npm run tauri:dev` must still launch cleanly after the routing-mode wiring changes.

## 7. Risks & Assumptions

- **RISK-001**: The prompt classifier may return ambiguous intent for borderline prompts, which can produce surprising model choices unless the fallback policy is conservative.
- **RISK-002**: Manual override behavior can become confusing if the composer does not make the active scope visible enough.
- **RISK-003**: Changes to routing state must not mutate saved defaults unintentionally, or the feature will feel unstable across sends.
- **ASSUMPTION-001**: The current backend-host credential storage is sufficient for the classifier/router API key path and does not require a new secret backend.
- **ASSUMPTION-002**: The runtime `model/list` shape continues to expose enough reasoning metadata to choose among the available candidates.
- **ASSUMPTION-003**: A global routing mode is acceptable for V1, with no per-thread override persistence beyond the app session.

## 8. Related Specifications / Further Reading

- [Prompt Intent Auto Model Selection Design](docs/plans/2026-04-22-prompt-intent-auto-model-selection-design.md)
- [Prompt Intent Manual QA Runbook](docs/prompt-intent-manual-qa.md)
- [Codebase Map](docs/codebase-map.md)
