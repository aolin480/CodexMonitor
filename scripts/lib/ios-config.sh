#!/usr/bin/env bash

IOS_LOCAL_CONFIG_PATH="${IOS_LOCAL_CONFIG_PATH:-src-tauri/tauri.ios.local.conf.json}"
IOS_LOCAL_CONFIG_EXAMPLE_PATH="${IOS_LOCAL_CONFIG_EXAMPLE_PATH:-src-tauri/tauri.ios.local.example.json}"
IOS_DEFAULT_BUNDLE_ID="${IOS_DEFAULT_BUNDLE_ID:-com.dimillian.codexmonitor.ios}"

ios_has_local_config() {
  [[ -f "$IOS_LOCAL_CONFIG_PATH" ]]
}

ios_local_config_value() {
  local key="${1:?missing key}"

  node - "$key" "$IOS_LOCAL_CONFIG_PATH" <<'NODE'
const fs = require("fs");

const [key, configPath] = process.argv.slice(2);

function readConfig(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (_) {
    return {};
  }
}

const localCfg = readConfig(configPath);
const values = {
  identifier: String(localCfg?.identifier ?? "").trim(),
  team: String(localCfg?.bundle?.iOS?.developmentTeam ?? "").trim(),
};

process.stdout.write(values[key] ?? "");
NODE
}

ios_resolve_config_value() {
  local key="${1:?missing key}"

  node - "$key" "$IOS_LOCAL_CONFIG_PATH" <<'NODE'
const fs = require("fs");

const [key, localPath] = process.argv.slice(2);

function readConfig(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (_) {
    return {};
  }
}

const baseCfg = readConfig("src-tauri/tauri.conf.json");
const iosCfg = readConfig("src-tauri/tauri.ios.conf.json");
const localCfg = readConfig(localPath);

const values = {
  identifier: String(
    localCfg?.identifier ??
      iosCfg?.identifier ??
      baseCfg?.identifier ??
      ""
  ).trim(),
  team: String(
    localCfg?.bundle?.iOS?.developmentTeam ??
      iosCfg?.bundle?.iOS?.developmentTeam ??
      baseCfg?.bundle?.iOS?.developmentTeam ??
      ""
  ).trim(),
  hasLocal: fs.existsSync(localPath) ? "1" : "0",
};

process.stdout.write(values[key] ?? "");
NODE
}
