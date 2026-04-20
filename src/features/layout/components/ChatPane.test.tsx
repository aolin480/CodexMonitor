/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatPane } from "./ChatPane";

describe("ChatPane", () => {
  it("applies the workspace tint metadata when a color is provided", () => {
    const { container } = render(
      <ChatPane
        messagesNode={<div>Messages</div>}
        composerNode={null}
        workspaceThreadColor="amber"
      />,
    );

    const pane = container.querySelector(".chat-pane");
    expect(pane?.getAttribute("data-workspace-thread-color")).toBe("amber");
    expect(pane?.getAttribute("style")).toContain("--workspace-thread-tint-rgb: 245 158 11");
    expect(pane?.getAttribute("style")).toContain("--workspace-thread-secondary-rgb: 245 158 11");
  });

  it("exposes both synthwave color channels when a color is provided", () => {
    const { container } = render(
      <ChatPane
        messagesNode={<div>Messages</div>}
        composerNode={null}
        workspaceThreadColor="synthwave"
      />,
    );

    const pane = container.querySelector(".chat-pane");
    expect(pane?.getAttribute("data-workspace-thread-color")).toBe("synthwave");
    expect(pane?.getAttribute("style")).toContain("--workspace-thread-tint-rgb: 244 114 182");
    expect(pane?.getAttribute("style")).toContain(
      "--workspace-thread-secondary-rgb: 125 211 252",
    );
  });

  it("omits the workspace tint metadata when no color is provided", () => {
    const { container } = render(
      <ChatPane messagesNode={<div>Messages</div>} composerNode={null} />,
    );

    const pane = container.querySelector(".chat-pane");
    expect(pane?.hasAttribute("data-workspace-thread-color")).toBe(false);
    expect(pane?.getAttribute("style")).not.toContain("--workspace-thread-tint-rgb");
    expect(pane?.getAttribute("style")).not.toContain("--workspace-thread-secondary-rgb");
  });
});
