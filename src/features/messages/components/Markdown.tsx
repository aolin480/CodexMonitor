import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ClipboardEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  describeFileTarget,
  formatParsedFileLocation,
  isFileLinkUrl,
  parseFileLinkUrl,
  parseInlineFileTarget,
  remarkFileLinks,
  resolveMessageFileHref,
  toFileLink,
} from "../utils/messageFileLinks";
import type { ParsedFileLocation } from "../../../utils/fileLinks";

type MarkdownProps = {
  value: string;
  className?: string;
  codeBlock?: boolean;
  codeBlockStyle?: "default" | "message";
  showFilePath?: boolean;
  workspacePath?: string | null;
  onOpenFileLink?: (path: ParsedFileLocation) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: ParsedFileLocation) => void;
  onOpenThreadLink?: (threadId: string) => void;
};

type CodeBlockProps = {
  className?: string;
  value: string;
};

type PreProps = {
  node?: {
    tagName?: string;
    children?: Array<{
      tagName?: string;
      properties?: { className?: string[] | string };
      children?: Array<{ value?: string }>;
    }>;
  };
  children?: ReactNode;
};

type LinkBlockProps = {
  urls: string[];
};

function getCodeSelectionText(root: HTMLElement, fallback: string) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const selectedInsideRoot =
    root.contains(range.commonAncestorContainer) ||
    root.contains(selection.anchorNode) ||
    root.contains(selection.focusNode);

  if (!selectedInsideRoot) {
    return null;
  }

  const selectedText = selection.toString();
  return selectedText.trim().length > 0 ? selectedText : fallback;
}

function extractLanguageTag(className?: string) {
  if (!className) {
    return null;
  }
  const match = className.match(/language-([\w-]+)/i);
  if (!match) {
    return null;
  }
  return match[1];
}

function extractCodeFromPre(node?: PreProps["node"]) {
  const codeNode = node?.children?.find((child) => child.tagName === "code");
  const className = codeNode?.properties?.className;
  const normalizedClassName = Array.isArray(className)
    ? className.join(" ")
    : className;
  const value =
    codeNode?.children?.map((child) => child.value ?? "").join("") ?? "";
  return {
    className: normalizedClassName,
    value: value.replace(/\n$/, ""),
  };
}

function normalizeUrlLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const withoutBullet = trimmed.replace(/^(?:[-*]|\d+\.)\s+/, "");
  if (!/^https?:\/\/\S+$/i.test(withoutBullet)) {
    return null;
  }
  return withoutBullet;
}

type StructuredReviewFinding = {
  file: string;
  category: string;
  finding: string;
  recommendation: string;
  severity: string;
};

function escapeTableCell(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br />")
    .trim();
}

function parseStructuredReviewFinding(line: string): StructuredReviewFinding | null {
  const parts = line.split(/\s+\|\s+/).map((part) => part.trim());
  if (parts.length !== 5) {
    return null;
  }
  const [file, rawCategory, finding, recommendation, rawSeverity] = parts;
  if (!file || !finding || !recommendation || !/^category=/i.test(rawCategory)) {
    return null;
  }
  const category = rawCategory.replace(/^category=/i, "").trim();
  const severity = rawSeverity.replace(/^severity=/i, "").trim();
  if (!category || !severity) {
    return null;
  }
  if (!/^(critical|high|medium|low|info|warning|error)$/i.test(severity)) {
    return null;
  }
  return {
    file,
    category,
    finding,
    recommendation,
    severity,
  };
}

function buildStructuredReviewTable(rows: StructuredReviewFinding[]) {
  const header = [
    "| File | Category | Finding | Recommendation | Severity |",
    "| --- | --- | --- | --- | --- |",
  ];
  const body = rows.map(
    ({ file, category, finding, recommendation, severity }) =>
      `| \`${escapeTableCell(file)}\` | ${escapeTableCell(category)} | ${escapeTableCell(
        finding,
      )} | ${escapeTableCell(recommendation)} | ${escapeTableCell(severity)} |`,
  );
  return [...header, ...body].join("\n");
}

function normalizeStructuredReviewTables(value: string) {
  const lines = value.split(/\r?\n/);
  let inFence = false;
  let pendingRows: StructuredReviewFinding[] = [];
  const output: string[] = [];

  const flushPendingRows = () => {
    if (pendingRows.length === 0) {
      return;
    }
    if (output.length > 0 && output[output.length - 1].trim()) {
      output.push("");
    }
    output.push(buildStructuredReviewTable(pendingRows));
    output.push("");
    pendingRows = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      flushPendingRows();
      inFence = !inFence;
      output.push(line);
      continue;
    }
    const structuredRow = inFence ? null : parseStructuredReviewFinding(line);
    if (structuredRow) {
      pendingRows.push(structuredRow);
      continue;
    }
    if (!inFence && pendingRows.length > 0 && !line.trim()) {
      continue;
    }
    flushPendingRows();
    output.push(line);
  }

  flushPendingRows();
  return output.join("\n");
}

function stripTrailingMemoryCitation(value: string) {
  return value.replace(/\n*<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>\s*$/i, "").trim();
}

export function isStandaloneMarkdownTable(value: string) {
  const stripped = stripTrailingMemoryCitation(value);
  if (!stripped) {
    return false;
  }
  const normalized = normalizeStructuredReviewTables(normalizeListIndentation(stripped)).trim();
  if (!normalized) {
    return false;
  }
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return false;
  }
  return lines.every((line) => /^\|.*\|\s*$/.test(line.trim()));
}

function extractUrlLines(value: string) {
  const lines = value.split(/\r?\n/);
  const urls = lines
    .map((line) => normalizeUrlLine(line))
    .filter((line): line is string => Boolean(line));
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length === 0) {
    return null;
  }
  if (urls.length !== nonEmptyLines.length) {
    return null;
  }
  return urls;
}

function normalizeListIndentation(value: string) {
  const lines = value.split(/\r?\n/);
  let inFence = false;
  let activeOrderedItem = false;
  let orderedBaseIndent = 4;
  let orderedIndentOffset: number | null = null;

  const countLeadingSpaces = (line: string) =>
    line.match(/^\s*/)?.[0].length ?? 0;
  const spaces = (count: number) => " ".repeat(Math.max(0, count));
  const normalized = lines.map((line) => {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      inFence = !inFence;
      activeOrderedItem = false;
      orderedIndentOffset = null;
      return line;
    }
    if (inFence) {
      return line;
    }
    if (!line.trim()) {
      return line;
    }

    const orderedMatch = line.match(/^(\s*)\d+\.\s+/);
    if (orderedMatch) {
      const rawIndent = orderedMatch[1].length;
      const normalizedIndent =
        rawIndent > 0 && rawIndent < 4 ? 4 : rawIndent;
      activeOrderedItem = true;
      orderedBaseIndent = normalizedIndent + 4;
      orderedIndentOffset = null;
      if (normalizedIndent !== rawIndent) {
        return `${spaces(normalizedIndent)}${line.trimStart()}`;
      }
      return line;
    }

    const bulletMatch = line.match(/^(\s*)([-*+])\s+/);
    if (bulletMatch) {
      const rawIndent = bulletMatch[1].length;
      let targetIndent = rawIndent;

      if (!activeOrderedItem && rawIndent > 0 && rawIndent < 4) {
        targetIndent = 4;
      }

      if (activeOrderedItem) {
        if (orderedIndentOffset === null && rawIndent < orderedBaseIndent) {
          orderedIndentOffset = orderedBaseIndent - rawIndent;
        }
        if (orderedIndentOffset !== null) {
          const adjustedIndent = rawIndent + orderedIndentOffset;
          if (adjustedIndent <= orderedBaseIndent + 12) {
            targetIndent = adjustedIndent;
          }
        }
      }

      if (targetIndent !== rawIndent) {
        return `${spaces(targetIndent)}${line.trimStart()}`;
      }
      return line;
    }

    const leadingSpaces = countLeadingSpaces(line);
    if (activeOrderedItem && leadingSpaces < orderedBaseIndent) {
      activeOrderedItem = false;
      orderedIndentOffset = null;
    }
    return line;
  });
  return normalized.join("\n");
}

function LinkBlock({ urls }: LinkBlockProps) {
  return (
    <div className="markdown-linkblock">
      {urls.map((url, index) => (
        <a
          key={`${url}-${index}`}
          href={url}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void openUrl(url);
          }}
        >
          {url}
        </a>
      ))}
    </div>
  );
}

function FileReferenceLink({
  href,
  rawPath,
  showFilePath,
  workspacePath,
  onClick,
  onContextMenu,
}: {
  href: string;
  rawPath: ParsedFileLocation;
  showFilePath: boolean;
  workspacePath?: string | null;
  onClick: (event: React.MouseEvent, path: ParsedFileLocation) => void;
  onContextMenu: (event: React.MouseEvent, path: ParsedFileLocation) => void;
}) {
  const { fullPath, fileName, lineLabel, parentPath } = describeFileTarget(rawPath, workspacePath);
  return (
    <a
      href={href}
      className="message-file-link"
      title={fullPath}
      onClick={(event) => onClick(event, rawPath)}
      onContextMenu={(event) => onContextMenu(event, rawPath)}
    >
      <span className="message-file-link-name">{fileName}</span>
      {lineLabel ? <span className="message-file-link-line">L{lineLabel}</span> : null}
      {showFilePath && parentPath ? (
        <span className="message-file-link-path">{parentPath}</span>
      ) : null}
    </a>
  );
}

type CodeBlockCopyMode = "code" | "markdown";

function CodeBlock({ className, value }: CodeBlockProps) {
  const [copiedMode, setCopiedMode] = useState<CodeBlockCopyMode | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const languageTag = extractLanguageTag(className);
  const languageLabel = languageTag ?? "Code";
  const fencedValue = `\`\`\`${languageTag ?? ""}\n${value}\n\`\`\``;

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async (copyValue: string, mode: CodeBlockCopyMode) => {
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopiedMode(mode);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedMode(null);
      }, 1200);
    } catch {
      // No-op: clipboard errors can occur in restricted contexts.
    }
  };

  const handleSelectedTextCopy = useCallback(
    (event: ClipboardEvent<HTMLPreElement>) => {
      const pre = preRef.current;
      if (!pre) {
        return;
      }
      const copyText = getCodeSelectionText(pre, value);
      if (copyText === null) {
        return;
      }
      event.clipboardData.setData("text/plain", copyText);
      event.preventDefault();
    },
    [value],
  );

  return (
    <div className="markdown-codeblock">
      <div className="markdown-codeblock-header">
        <span className="markdown-codeblock-language">{languageLabel}</span>
        <div className="markdown-codeblock-actions">
          <button
            type="button"
            className={`ghost markdown-codeblock-copy${copiedMode === "code" ? " is-copied" : ""}`}
            onClick={() => void handleCopy(value, "code")}
            aria-label="Copy code block"
            title={copiedMode === "code" ? "Copied" : "Copy code"}
          >
            {copiedMode === "code" ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            className={`ghost markdown-codeblock-copy${copiedMode === "markdown" ? " is-copied" : ""}`}
            onClick={() => void handleCopy(fencedValue, "markdown")}
            aria-label="Copy code block as Markdown"
            title={copiedMode === "markdown" ? "Copied" : "Copy Markdown"}
          >
            {copiedMode === "markdown" ? "Copied" : "Copy Markdown"}
          </button>
        </div>
      </div>
      <pre ref={preRef} onCopy={handleSelectedTextCopy}>
        <code className={className}>{value}</code>
      </pre>
    </div>
  );
}

function SingleLineCodeBlock({ className, value }: CodeBlockProps) {
  const preRef = useRef<HTMLPreElement | null>(null);
  const handleSelectedTextCopy = useCallback(
    (event: ClipboardEvent<HTMLPreElement>) => {
      const pre = preRef.current;
      if (!pre) {
        return;
      }
      const copyText = getCodeSelectionText(pre, value);
      if (copyText === null) {
        return;
      }
      event.clipboardData.setData("text/plain", copyText);
      event.preventDefault();
    },
    [value],
  );

  return (
    <pre
      ref={preRef}
      className="markdown-codeblock-single"
      onCopy={handleSelectedTextCopy}
    >
      <code className={className}>{value}</code>
    </pre>
  );
}

function PreBlock({ node, children }: PreProps) {
  const { className, value } = extractCodeFromPre(node);
  if (!className && !value && children) {
    return <pre>{children}</pre>;
  }
  const urlLines = extractUrlLines(value);
  if (urlLines) {
    return <LinkBlock urls={urlLines} />;
  }
  const isSingleLine = !value.includes("\n");
  if (isSingleLine) {
    return <SingleLineCodeBlock className={className} value={value} />;
  }
  return <CodeBlock className={className} value={value} />;
}

export function Markdown({
  value,
  className,
  codeBlock,
  codeBlockStyle = "default",
  showFilePath = true,
  workspacePath = null,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
}: MarkdownProps) {
  const normalizedValue = codeBlock
    ? value
    : normalizeStructuredReviewTables(normalizeListIndentation(value));
  const content = codeBlock
    ? `\`\`\`\n${normalizedValue}\n\`\`\``
    : normalizedValue;
  const handleFileLinkClick = (event: React.MouseEvent, path: ParsedFileLocation) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenFileLink?.(path);
  };
  const handleLocalLinkClick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const handleFileLinkContextMenu = (
    event: React.MouseEvent,
    path: ParsedFileLocation,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenFileLinkMenu?.(event, path);
  };
  const resolvedHrefFilePathCache = new Map<string, ParsedFileLocation | null>();
  const resolveHrefFilePath = (url: string) => {
    if (resolvedHrefFilePathCache.has(url)) {
      return resolvedHrefFilePathCache.get(url) ?? null;
    }
    const resolvedPath = resolveMessageFileHref(url, workspacePath);
    if (!resolvedPath) {
      resolvedHrefFilePathCache.set(url, null);
      return null;
    }
    resolvedHrefFilePathCache.set(url, resolvedPath);
    return resolvedPath;
  };
  const components: Components = {
    table: ({ children }) => (
      <div className="markdown-table-wrap">
        <table className="markdown-table">{children}</table>
      </div>
    ),
    a: ({ href, children }) => {
      const url = (href ?? "").trim();
      const threadId = url.startsWith("thread://")
        ? url.slice("thread://".length).trim()
        : url.startsWith("/thread/")
          ? url.slice("/thread/".length).trim()
          : "";
      if (threadId) {
        return (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenThreadLink?.(threadId);
            }}
          >
            {children}
          </a>
        );
      }
      if (isFileLinkUrl(url)) {
        const path = parseFileLinkUrl(url);
        if (!path) {
          return (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              {children}
            </a>
          );
        }
        return (
          <FileReferenceLink
            href={href ?? toFileLink(path)}
            rawPath={path}
            showFilePath={showFilePath}
            workspacePath={workspacePath}
            onClick={handleFileLinkClick}
            onContextMenu={handleFileLinkContextMenu}
          />
        );
      }
      const hrefFilePath = resolveHrefFilePath(url);
      if (hrefFilePath) {
        const formattedHrefFilePath = formatParsedFileLocation(hrefFilePath);
        const clickHandler = (event: React.MouseEvent) =>
          handleFileLinkClick(event, hrefFilePath);
        const contextMenuHandler = onOpenFileLinkMenu
          ? (event: React.MouseEvent) => handleFileLinkContextMenu(event, hrefFilePath)
          : undefined;
        return (
          <a
            href={href ?? toFileLink(hrefFilePath)}
            title={formattedHrefFilePath}
            onClick={clickHandler}
            onContextMenu={contextMenuHandler}
          >
            {children}
          </a>
        );
      }
      const isExternal =
        url.startsWith("http://") ||
        url.startsWith("https://") ||
        url.startsWith("mailto:");

      if (!isExternal) {
        if (url.startsWith("#")) {
          return <a href={href}>{children}</a>;
        }
        return (
          <a href={href} onClick={handleLocalLinkClick}>
            {children}
          </a>
        );
      }

      return (
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void openUrl(url);
          }}
        >
          {children}
        </a>
      );
    },
    code: ({ className: codeClassName, children }) => {
      if (codeClassName) {
        return <code className={codeClassName}>{children}</code>;
      }
      const text = String(children ?? "").trim();
      const fileTarget = parseInlineFileTarget(text);
      if (!fileTarget) {
        return <code>{children}</code>;
      }
      const href = toFileLink(fileTarget);
      return (
        <FileReferenceLink
          href={href}
          rawPath={fileTarget}
          showFilePath={showFilePath}
          workspacePath={workspacePath}
          onClick={handleFileLinkClick}
          onContextMenu={handleFileLinkContextMenu}
        />
      );
    },
  };

  if (codeBlockStyle === "message") {
    components.pre = ({ node, children }) => (
      <PreBlock node={node as PreProps["node"]}>
        {children}
      </PreBlock>
    );
  }

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFileLinks]}
        urlTransform={(url) => {
          const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
          // Keep file-like hrefs intact before scheme sanitization runs, otherwise
          // Windows absolute paths such as C:/repo/file.ts look like unknown schemes.
          if (resolveHrefFilePath(url)) {
            return url;
          }
          if (
            isFileLinkUrl(url) ||
            url.startsWith("http://") ||
            url.startsWith("https://") ||
            url.startsWith("mailto:") ||
            url.startsWith("#") ||
            url.startsWith("/") ||
            url.startsWith("./") ||
            url.startsWith("../")
          ) {
            return url;
          }
          if (!hasScheme) {
            return url;
          }
          return "";
        }}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
