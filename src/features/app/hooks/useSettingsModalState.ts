import { useCallback, useState } from "react";
import type { SettingsTarget } from "@settings/components/settingsTypes";

export type SettingsSection =
  | "projects"
  | "display"
  | "about"
  | "dictation"
  | "shortcuts"
  | "open-apps"
  | "git"
  | "codex"
  | "features";

export function useSettingsModalState() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(
    null,
  );
  const [settingsTarget, setSettingsTarget] = useState<SettingsTarget | null>(null);

  const openSettings = useCallback((section?: SettingsSection, target?: SettingsTarget) => {
    setSettingsSection(section ?? null);
    setSettingsTarget(target ?? null);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsSection(null);
    setSettingsTarget(null);
  }, []);

  return {
    settingsOpen,
    settingsSection,
    settingsTarget,
    openSettings,
    closeSettings,
    setSettingsOpen,
    setSettingsSection,
    setSettingsTarget,
  };
}
