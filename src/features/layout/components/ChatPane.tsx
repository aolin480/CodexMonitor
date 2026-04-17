import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { WorkspaceThreadColor } from "../../../types";
import { getWorkspaceThreadColorOption } from "../../workspaces/utils/workspaceThreadColors";

type ChatPaneProps = {
  messagesNode: ReactNode;
  composerNode: ReactNode;
  className?: string;
  workspaceThreadColor?: WorkspaceThreadColor | null;
};

type ChatPaneStyle = CSSProperties & {
  "--composer-overlay-height": string;
  "--workspace-thread-tint-rgb"?: string;
};

export function ChatPane({
  messagesNode,
  composerNode,
  className,
  workspaceThreadColor = null,
}: ChatPaneProps) {
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const workspaceThreadColorOption = getWorkspaceThreadColorOption(workspaceThreadColor);

  useEffect(() => {
    if (!composerNode) {
      setComposerHeight(0);
      return;
    }

    const node = composerRef.current;
    if (!node) {
      return;
    }

    const updateComposerHeight = () => {
      setComposerHeight(Math.ceil(node.getBoundingClientRect().height));
    };

    updateComposerHeight();

    const observer = new ResizeObserver(() => {
      updateComposerHeight();
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [composerNode]);

  const paneStyle = useMemo(
    () => {
      const style: ChatPaneStyle = {
        "--composer-overlay-height": `${composerHeight}px`,
      };
      if (workspaceThreadColorOption) {
        style["--workspace-thread-tint-rgb"] = workspaceThreadColorOption.rgb;
      }
      return style;
    },
    [composerHeight, workspaceThreadColorOption],
  );

  return (
    <div
      className={`chat-pane${className ? ` ${className}` : ""}`}
      style={paneStyle}
      data-workspace-thread-color={workspaceThreadColor ?? undefined}
    >
      <div className="chat-pane-messages">{messagesNode}</div>
      {composerNode ? (
        <div className="chat-pane-composer" ref={composerRef}>
          {composerNode}
        </div>
      ) : null}
    </div>
  );
}
