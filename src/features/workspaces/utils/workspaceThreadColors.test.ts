import { describe, expect, it } from "vitest";
import type { WorkspaceThreadColor } from "../../../types";
import {
  getWorkspaceThreadColorCssVars,
  getWorkspaceThreadColorOption,
} from "./workspaceThreadColors";

describe("workspaceThreadColors", () => {
  it("returns both synthwave color channels", () => {
    expect(getWorkspaceThreadColorCssVars("synthwave")).toEqual({
      "--workspace-thread-tint-rgb": "244 114 182",
      "--workspace-thread-secondary-rgb": "125 211 252",
    });
  });

  it("falls back to the primary channel when no secondary color exists", () => {
    expect(getWorkspaceThreadColorCssVars("amber")).toEqual({
      "--workspace-thread-tint-rgb": "245 158 11",
      "--workspace-thread-secondary-rgb": "245 158 11",
    });
  });

  it("returns no palette metadata for unknown legacy colors", () => {
    const legacyColor = "legacy-pink" as WorkspaceThreadColor;

    expect(getWorkspaceThreadColorOption(legacyColor)).toBeNull();
    expect(getWorkspaceThreadColorCssVars(legacyColor)).toBeUndefined();
  });
});
