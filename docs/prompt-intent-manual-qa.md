# Prompt-Intent Manual QA Runbook

This runbook is the manual desktop+iPhone validation path for the V1 auto model routing feature.

Use this after the automated checks are green and before merge or release.

Related docs:

- `README.md` iOS + Tailscale setup
- `docs/mobile-ios-tailscale-blueprint.md`

## Goal

Verify that:

1. The desktop backend host can route prompts correctly.
2. iOS can connect to the desktop daemon over Tailscale.
3. Routing diagnostics behave correctly when enabled and disabled.
4. Missing or unavailable router credentials fall back safely.

## Preconditions

- Desktop CodexMonitor build is current.
- iPhone and desktop are on the same Tailscale tailnet.
- Desktop has at least one reachable workspace configured.
- Backend mode is available in desktop settings.
- A router credential can be entered on the desktop host.

## Test Data

Use three prompts so you can see whether routing changes behavior:

- Quick edit prompt:
  - `Rename this function to something clearer and update the call sites.`
- Balanced coding prompt:
  - `Add input validation to this flow and include targeted tests for edge cases.`
- Heavy/debugging prompt:
  - `Trace why this cross-runtime send path drops metadata in remote mode and propose a fix.`

## Desktop Preflight

1. Open desktop CodexMonitor.
2. Go to `Settings > Codex`.
3. Confirm `Auto model routing` is enabled.
4. Set the desired routing mode for the pass you are running.
5. Confirm the router credential state is visible.
6. Go to `Settings > Server`.
7. Set a non-empty `Remote backend token`.
8. Start the mobile access daemon.
9. Run `Detect Tailscale`.
10. Record the suggested host and token source of truth.

Pass criteria:

- Daemon status shows running.
- Suggested Tailscale host is present.
- No configuration error is shown in Codex settings.

## iPhone Connection Pass

1. Open CodexMonitor on iPhone.
2. Go to `Settings > Server` or the mobile setup wizard.
3. Enter the desktop Tailscale host and the same token.
4. Tap `Connect & test`.
5. Wait for workspace loading to complete.

Pass criteria:

- `Connect & test` succeeds.
- Desktop workspaces appear on iPhone.
- No auth or host error is shown.

## Prompt-Intent Pass: Diagnostics Enabled

Desktop setup:

1. On desktop, enable routing diagnostics.
2. Keep auto model routing enabled.

iPhone steps:

1. Open a workspace and start a thread.
2. Send the quick edit prompt.
3. Send the balanced coding prompt.
4. Send the heavy/debugging prompt.

Check after each send:

- The message sends successfully.
- A routing diagnostics indicator appears.
- The indicator shows a routed model and reasoning effort.
- The indicator changes when prompt complexity meaningfully changes.

Pass criteria:

- Diagnostics indicator is visible when expected.
- The selected model/effort looks plausible for the prompt class.
- No send failure occurs because routing is enabled.

## Prompt-Intent Pass: Diagnostics Disabled

Desktop setup:

1. Disable routing diagnostics.
2. Leave auto model routing enabled.

iPhone steps:

1. Send the same three prompts again in a fresh or existing thread.

Pass criteria:

- Sends still succeed.
- No routing diagnostics indicator is shown.
- Behavior remains functional without exposing routing UI.

## Fallback Pass: Missing Credential

Desktop setup:

1. Remove the router credential from desktop settings.
2. Leave auto model routing enabled.

Desktop expectations:

- Settings shows a visible warning about missing credential state.

iPhone steps:

1. Send the balanced coding prompt.

Pass criteria:

- Send still succeeds.
- No hard error is shown to the iPhone user because routing is unavailable.
- Behavior falls back deterministically.
- If diagnostics are enabled, the indicator reflects fallback rather than a router-selected result.

## Fallback Pass: Locked Or Unavailable Credential Store

Run this only if you can safely reproduce it on the desktop host OS.

Desktop setup:

1. Put the backend host into a state where the OS credential store is locked or unavailable.
2. Keep auto model routing enabled.

iPhone steps:

1. Send the balanced coding prompt.

Pass criteria:

- Send still succeeds.
- Desktop settings shows an unavailable or locked credential state.
- iPhone flow still falls back safely.

## Result Capture

Record one row per pass:

| Pass | Result | Notes |
| --- | --- | --- |
| Desktop preflight | PASS / FAIL | |
| iPhone connection | PASS / FAIL | |
| Diagnostics enabled | PASS / FAIL | |
| Diagnostics disabled | PASS / FAIL | |
| Missing credential fallback | PASS / FAIL | |
| Locked store fallback | PASS / FAIL / SKIPPED | |

Also record:

- Desktop host OS
- iPhone model / iOS version
- CodexMonitor build or branch
- Routing mode used
- Whether diagnostics were enabled

## Failure Triage

If connection fails:

- Re-check daemon status on desktop.
- Re-check Tailscale host and token.
- Confirm both devices are online in the same tailnet.

If sends fail only when routing is enabled:

- Check desktop Codex settings for credential-state warnings.
- Confirm runtime `model/list` is returning candidates on the backend host.

If diagnostics look wrong:

- Re-test with diagnostics disabled to confirm send behavior is unaffected.
- Compare the desktop host state with the returned routing indicator.

## Exit Criteria

Prompt Intent V1 is ready for merge when:

1. Desktop preflight passes.
2. iPhone connection passes.
3. Diagnostics enabled pass succeeds.
4. Diagnostics disabled pass succeeds.
5. Missing credential fallback succeeds.
6. Locked-store fallback is either verified or explicitly documented as skipped with host constraints.
