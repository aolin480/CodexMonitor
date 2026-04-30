import { chmodSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const targetTriple = resolveTargetTriple();
const binaryExtension = targetTriple.includes("windows") ? ".exe" : "";
const releaseDir = path.join(rootDir, "src-tauri", "target", "release");

for (const binaryName of ["codex_monitor_daemon", "codex_monitor_daemonctl"]) {
  const sourcePath = path.join(releaseDir, `${binaryName}${binaryExtension}`);
  const targetPath = path.join(releaseDir, `${binaryName}-${targetTriple}${binaryExtension}`);

  if (!existsSync(sourcePath)) {
    console.error(`[prepare-tauri-sidecars] Missing source binary: ${sourcePath}`);
    process.exit(1);
  }

  copyFileSync(sourcePath, targetPath);
  chmodSync(targetPath, 0o755);
  console.log(`[prepare-tauri-sidecars] Prepared ${path.basename(targetPath)}`);
}

function resolveTargetTriple() {
  const explicitTarget = process.env.CARGO_BUILD_TARGET?.trim();
  if (explicitTarget) {
    return explicitTarget;
  }

  const platform = process.env.TAURI_ENV_PLATFORM ?? process.platform;
  const arch = process.env.TAURI_ENV_ARCH ?? process.arch;

  if (platform === "darwin") {
    return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }

  if (platform === "win32") {
    return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }

  if (platform === "linux") {
    return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }

  console.error(
    `[prepare-tauri-sidecars] Unsupported platform/arch combination: ${platform}/${arch}`,
  );
  process.exit(1);
}
