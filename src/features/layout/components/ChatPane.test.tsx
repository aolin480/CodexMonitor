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
  });

  it("omits the workspace tint metadata when no color is provided", () => {
    const { container } = render(
      <ChatPane messagesNode={<div>Messages</div>} composerNode={null} />,
    );

    const pane = container.querySelector(".chat-pane");
    expect(pane?.hasAttribute("data-workspace-thread-color")).toBe(false);
    expect(pane?.getAttribute("style")).not.toContain("--workspace-thread-tint-rgb");
  });
});
