import { Fragment } from "react";

import type { TaskCommentMention } from "@ega/contracts";

import {
  parseCommentMarkdown,
  type CommentMarkdownBlock,
  type CommentMarkdownInline,
} from "@/lib/comment-markdown";

function Inline({ nodes }: { nodes: CommentMarkdownInline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "text":
            return <Fragment key={index}>{node.value}</Fragment>;
          case "break":
            return <br key={index} />;
          case "strong":
            return (
              <strong key={index} className="font-semibold">
                <Inline nodes={node.children} />
              </strong>
            );
          case "em":
            return (
              <em key={index}>
                <Inline nodes={node.children} />
              </em>
            );
          case "code":
            return (
              <code
                key={index}
                className="rounded-[var(--radius-xs)] bg-[var(--ega-surface-subtle)] px-1 py-0.5 font-mono text-[0.95em]"
              >
                {node.value}
              </code>
            );
          case "link":
            return (
              <a
                key={index}
                href={node.href}
                target="_blank"
                rel="nofollow noopener noreferrer"
                className="underline decoration-[var(--ega-border-strong)] underline-offset-2 hover:text-[color:var(--ega-accent)]"
              >
                <Inline nodes={node.children} />
              </a>
            );
          case "mention":
            return (
              <span
                key={index}
                title={`Mentioned ${node.label}`}
                className="rounded-[var(--radius-xs)] bg-[var(--ega-surface-hover)] px-1 font-medium text-[color:var(--ega-accent)]"
              >
                @{node.handle}
              </span>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

function Block({ block }: { block: CommentMarkdownBlock }) {
  switch (block.type) {
    case "code":
      return (
        <pre className="mt-1 overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--ega-surface-subtle)] p-2 text-[length:var(--text-meta)]">
          <code>{block.value}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote className="mt-1 border-l-2 border-[var(--ega-border-strong)] pl-2 text-[color:var(--ega-text-secondary)]">
          <Inline nodes={block.children} />
        </blockquote>
      );
    case "heading":
      return (
        <p className="mt-1 font-semibold">
          <Inline nodes={block.children} />
        </p>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List
          className={
            block.ordered
              ? "mt-1 list-decimal pl-5"
              : "mt-1 list-disc pl-5"
          }
        >
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline nodes={item} />
            </li>
          ))}
        </List>
      );
    }
    case "paragraph":
    default:
      return (
        <p className="whitespace-pre-wrap break-words">
          <Inline nodes={block.children} />
        </p>
      );
  }
}

/**
 * Renders comment markdown as React nodes. Raw HTML never becomes markup, and
 * links only exist when the shared parser accepted the URL scheme.
 */
export function TaskCommentBody({
  body,
  mentions,
}: {
  body: string;
  mentions: TaskCommentMention[];
}) {
  const blocks = parseCommentMarkdown(
    body,
    mentions.map((mention) => ({
      ref: mention.ref,
      label: mention.label,
      kind: mention.kind,
    })),
  );

  return (
    <div className="flex flex-col gap-1 text-sm leading-[var(--leading-relaxed)] text-[color:var(--ega-text)]">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
