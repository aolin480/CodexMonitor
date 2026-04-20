# iOS Local Build Setup

This is the supported first-time setup flow for local iOS builds.

Goal:

1. Keep personal signing data out of git.
2. Store local iOS values in one gitignored JSON file.
3. Use Xcode once for Apple account, device trust, and first provisioning.
4. Use the CLI scripts for repeat builds after that.

## Files

- Example config: [src-tauri/tauri.ios.local.example.json](/Volumes/localdev/ai/CodexMonitor/src-tauri/tauri.ios.local.example.json:1)
- Local config: `src-tauri/tauri.ios.local.conf.json` (gitignored)
- Setup script: [scripts/setup_ios_local_config.sh](/Volumes/localdev/ai/CodexMonitor/scripts/setup_ios_local_config.sh:1)
- Device build script: [scripts/build_run_ios_device.sh](/Volumes/localdev/ai/CodexMonitor/scripts/build_run_ios_device.sh:1)
- Simulator build script: [scripts/build_run_ios.sh](/Volumes/localdev/ai/CodexMonitor/scripts/build_run_ios.sh:1)

## Prerequisites

- Xcode installed
- Xcode Command Line Tools installed
- Rust iOS targets installed:

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
# Optional on Intel Macs:
rustup target add x86_64-apple-ios
```

- Node.js and npm installed
- iPhone trusted with this Mac if you plan to install on device
- Developer Mode enabled on the iPhone

## 1. Create The Local iOS Config

Preferred:

```bash
./scripts/setup_ios_local_config.sh
```

The script prompts for:

- Apple development team ID
- iOS bundle identifier

Manual fallback:

```bash
cp src-tauri/tauri.ios.local.example.json src-tauri/tauri.ios.local.conf.json
```

Then edit `src-tauri/tauri.ios.local.conf.json`.

Notes:

- The local config is gitignored.
- The setup script only writes the local JSON config. It does not rewrite tracked generated Xcode files.
- Do not commit local signing changes under `src-tauri/gen/apple/*`. Those are generated artifacts, not the source of truth for per-machine signing.

## 1a. Install The Repo Safeguards

Run this once per clone:

```bash
./scripts/install_git_hooks.sh
```

This installs the repo pre-commit hook and blocks the most common accidental leaks:

- force-adding `src-tauri/tauri.ios.local.conf.json`
- staging local signing drift in `src-tauri/gen/apple/codex-monitor.xcodeproj/project.pbxproj`
- staging generated Xcode scheme or generated iOS `Info.plist` churn

## 2. First-Time Xcode Bootstrap

This is the part that should stay in Xcode. Apple account login, trust, and first provisioning are not worth scripting around.

1. Open Xcode.
2. Go to `Xcode > Settings > Accounts`.
3. Sign in with the Apple ID that owns your development team.
4. Connect the iPhone by cable the first time.
5. Trust the computer on the iPhone if prompted.
6. In Xcode, open `Window > Devices and Simulators` and confirm the phone appears.
7. From the repo root, run:

```bash
./scripts/build_run_ios_device.sh --open-xcode
```

8. In the generated Xcode project, select the `codex-monitor_iOS` target.
9. Open `Signing & Capabilities`.
10. Confirm the bundle identifier matches your local config.
11. Select your Apple team if Xcode has not already selected it.
12. Build once from Xcode with `Product > Build` or run once to the connected phone.

Success criteria:

- Xcode no longer shows signing/profile errors.
- The app builds at least once from Xcode.

After this step, the CLI flow should be the normal path.

## 3. Run On Simulator

```bash
./scripts/build_run_ios.sh
```

Useful options:

- `--simulator "<name>"`
- `--target aarch64-sim|x86_64-sim`
- `--skip-build`
- `--no-clean`

## 4. Run On Device

List discoverable devices:

```bash
./scripts/build_run_ios_device.sh --list-devices
```

Build, install, and launch:

```bash
./scripts/build_run_ios_device.sh --device "<device name or identifier>"
```

Useful options:

- `--skip-build`
- `--bundle-id <id>`
- `--target aarch64`
- `--open-xcode`

## 5. Repeat Workflow

After the first Xcode bootstrap, the normal loop should be:

```bash
./scripts/build_run_ios_device.sh --device "<device name or identifier>"
```

If you only need to reinstall an existing app bundle:

```bash
./scripts/build_run_ios_device.sh --device "<device name or identifier>" --skip-build
```

## Troubleshooting

### Missing local config

Run:

```bash
./scripts/setup_ios_local_config.sh
```

### Wrong team or bundle ID showing up again

Re-run:

```bash
./scripts/setup_ios_local_config.sh --force
```

That rewrites the local config. If Xcode still shows stale signing state, open the generated project again with:

```bash
./scripts/build_run_ios_device.sh --open-xcode
```

Then confirm `Signing & Capabilities` matches the local JSON config and build once from Xcode.

### Xcode says there is no account or no provisioning profile

This is still an Xcode-side bootstrap problem, not a repo config problem.

Check:

1. `Xcode > Settings > Accounts` has the correct Apple ID.
2. The iPhone is trusted and unlocked.
3. Developer Mode is enabled on the iPhone.
4. The selected team in `Signing & Capabilities` matches the local JSON config.
5. You have built once successfully from Xcode after selecting the team.

### CLI still fails after Xcode worked

Open the Xcode path again:

```bash
./scripts/build_run_ios_device.sh --open-xcode
```

If needed, rebuild once in Xcode, then return to the CLI flow.
