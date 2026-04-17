import type { WorkspaceThreadColor } from "../../../types";

type WorkspaceThreadColorOption = {
  value: WorkspaceThreadColor;
  label: string;
  rgb: string;
};

export const WORKSPACE_THREAD_COLOR_OPTIONS: WorkspaceThreadColorOption[] = [
  { value: "slate", label: "Slate", rgb: "148 163 184" },
  { value: "blue", label: "Blue", rgb: "96 165 250" },
  { value: "green", label: "Green", rgb: "74 222 128" },
  { value: "amber", label: "Amber", rgb: "245 158 11" },
  { value: "rose", label: "Rose", rgb: "251 113 133" },
];

export function getWorkspaceThreadColorOption(
  color: WorkspaceThreadColor | null | undefined,
) {
  if (!color) {
    return null;
  }
  return WORKSPACE_THREAD_COLOR_OPTIONS.find((option) => option.value === color) ?? null;
}
