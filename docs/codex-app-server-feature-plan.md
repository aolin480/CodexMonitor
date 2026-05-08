# Codex App-Server Feature Plan

Canonical upstream baseline: `../Codex` at `3377afd84a420193839a06e237118e7a267e9f94`.

## Goal

Make CodexMonitor behave like a first-class Codex app-server client on desktop
and mobile, while landing mobile sync reliability first.

## Phase 1: Mobile Thread Sync Reliability

- Keep foreground mobile live subscriptions attached across normal WebView
  focus/blur churn. iOS can emit blur for keyboard and chrome transitions, and
  actively detaching the stream there creates avoidable stale-thread windows.
- Treat daemon event-channel lag as a catch-up trigger. When the TCP daemon
  reports skipped app-server events, the active remote thread should refresh and
  reattach instead of silently trusting a partial stream.
- Add ordered event delivery next. The daemon should attach a monotonically
  increasing sequence number per client stream, and the mobile app should track
  gaps explicitly.
- Add replay/cursor recovery after sequence gaps. Use Codex app-server
  `thread/read` with `includeTurns` and `thread/turns/list` to rebuild the
  active thread state after reconnect, foreground resume, or missed-event
  detection.
- Replace synthetic live state with real Codex subscription state where
  available: `thread/subscribe`, `thread/unsubscribe`, `thread/read`, and
  loaded-thread APIs should drive the mobile status badge.

## Phase 2: Native Skill Usage

- Update `skills/list` calls to the current Codex schema:
  `cwds`, `forceReload`, and `perCwdExtraUserRoots`.
- Preserve full skill metadata in the UI: `path`, `enabled`, `scope`,
  `shortDescription`, `interface`, `dependencies`, and per-cwd `errors`.
- Convert selected `$skill` autocomplete entries into Codex-native user input
  items: `{ type: "skill", name, path }`.
- Keep raw automatic skill selection conservative. Exact `$skill` selections
  should attach automatically; fuzzy matches should be shown as suggested chips
  before send rather than silently injected.
- Route native `skills/changed` so skill lists refresh from Codex app-server
  changes instead of depending only on CodexMonitor synthetic update events.

## Phase 3: Broader Codex Feature Parity

- Add skill management commands using `skills/config/write` so users can enable
  or disable skills without editing files.
- Add plugin and marketplace surfaces: `plugin/list`, `plugin/read`,
  `plugin/install`, `plugin/uninstall`, `marketplace/add`,
  `marketplace/remove`, and `marketplace/upgrade`.
- Surface thread goals through `thread/goal/set`, `thread/goal/get`, and
  `thread/goal/clear`; show goal state in the active thread header and mobile
  status area.
- Add filesystem-watch support for mobile-visible changes using Codex
  app-server `fs/changed` and related file APIs where safe.
- Route additional high-value app-server events: `warning`, `guardianWarning`,
  `item/fileChange/patchUpdated`, `model/verification`, `serverRequest/resolved`,
  `thread/goal/updated`, and `thread/goal/cleared`.

## Validation

- Frontend hook/UI changes: run targeted Vitest files, then `npm run test`.
- TypeScript contract changes: run `npm run typecheck`.
- Rust daemon/app changes: run `cd src-tauri && cargo check`.
- App-server protocol parity changes: update `docs/app-server-events.md` in the
  same change.
