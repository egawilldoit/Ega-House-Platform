/**
 * Small, explicit comment markdown parser.
 *
 * It produces an AST; no HTML string is ever generated or injected. Raw HTML in
 * the source is plain text, and links are accepted only for an explicit scheme
 * allowlist (`http`, `https`, `mailto`) or same-document/relative targets.
 */

export type CommentMarkdownMention = Readonly<{
  ref: string;
  label: string;
  kind: "owner" | "agent";
}>;

export type CommentMarkdownInline =
  | { type: "text"; value: string }
  | { type: "break" }
  | { type: "strong"; children: CommentMarkdownInline[] }
  | { type: "em"; children: CommentMarkdownInline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: CommentMarkdownInline[] }
  | {
      type: "mention";
      handle: string;
      ref: string;
      label: string;
      kind: "owner" | "agent";
    };

export type CommentMarkdownBlock =
  | { type: "paragraph"; children: CommentMarkdownInline[] }
  | { type: "heading"; children: CommentMarkdownInline[] }
  | { type: "quote"; children: CommentMarkdownInline[] }
  | { type: "list"; ordered: boolean; items: CommentMarkdownInline[][] }
  | { type: "code"; value: string };

const ALLOWED_URL_SCHEMES = new Set(["http", "https", "mailto"]);
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Only explicit schemes from the allowlist, or safe relative anchors. */
export function isAllowedCommentUrl(value: string): boolean {
  const url = value.trim().replace(CONTROL_CHARACTERS, "");
  if (!url) return false;
  if (/\s/.test(url)) return false;

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url)?.[1]?.toLowerCase();
  if (scheme) return ALLOWED_URL_SCHEMES.has(scheme);

  // Protocol-relative URLs are external too; do not let them slip through as
  // "relative".
  if (url.startsWith("//")) return false;
  return url.startsWith("/") || url.startsWith("#");
}

function mentionMap(
  mentions: ReadonlyArray<CommentMarkdownMention>,
): Map<string, CommentMarkdownMention> {
  const map = new Map<string, CommentMarkdownMention>();
  for (const mention of mentions) {
    const handle = mention.ref.startsWith("agent:")
      ? mention.ref.slice("agent:".length)
      : "owner";
    if (handle) map.set(handle, mention);
  }
  return map;
}

function findClosing(source: string, start: number, marker: string): number {
  const index = source.indexOf(marker, start);
  return index === -1 ? -1 : index;
}

function parseInline(
  source: string,
  mentions: Map<string, CommentMarkdownMention>,
): CommentMarkdownInline[] {
  const nodes: CommentMarkdownInline[] = [];
  let buffer = "";
  let index = 0;

  const pushText = () => {
    if (!buffer) return;
    nodes.push({ type: "text", value: buffer });
    buffer = "";
  };

  while (index < source.length) {
    const character = source[index]!;

    if (character === "\\" && index + 1 < source.length) {
      buffer += source[index + 1]!;
      index += 2;
      continue;
    }

    if (character === "`") {
      const end = findClosing(source, index + 1, "`");
      if (end !== -1 && end > index + 1) {
        pushText();
        nodes.push({ type: "code", value: source.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (character === "[") {
      const labelEnd = findClosing(source, index + 1, "]");
      if (labelEnd !== -1 && source[labelEnd + 1] === "(") {
        const hrefEnd = findClosing(source, labelEnd + 2, ")");
        if (hrefEnd !== -1) {
          const label = source.slice(index + 1, labelEnd);
          const href = source.slice(labelEnd + 2, hrefEnd);
          if (isAllowedCommentUrl(href)) {
            pushText();
            nodes.push({
              type: "link",
              href: href.trim(),
              children: parseInline(label, mentions),
            });
            index = hrefEnd + 1;
            continue;
          }
          // Unsafe/malformed target: keep the label as ordinary text, never as
          // an anchor with the original URL.
          buffer += label;
          index = hrefEnd + 1;
          continue;
        }
      }
    }

    if (source.startsWith("**", index)) {
      const end = findClosing(source, index + 2, "**");
      if (end !== -1 && end > index + 2) {
        pushText();
        nodes.push({
          type: "strong",
          children: parseInline(source.slice(index + 2, end), mentions),
        });
        index = end + 2;
        continue;
      }
    }

    if (character === "*" || character === "_") {
      const end = findClosing(source, index + 1, character);
      if (end !== -1 && end > index + 1) {
        pushText();
        nodes.push({
          type: "em",
          children: parseInline(source.slice(index + 1, end), mentions),
        });
        index = end + 1;
        continue;
      }
    }

    if (character === "@") {
      const previous = index === 0 ? "" : source[index - 1]!;
      const match = /^@([a-z0-9][a-z0-9-]{0,62})/i.exec(source.slice(index));
      if (match && (!previous || /[\s([{]/.test(previous))) {
        const handle = match[1]!.toLowerCase();
        const mention = mentions.get(handle);
        if (mention) {
          pushText();
          nodes.push({
            type: "mention",
            handle,
            ref: mention.ref,
            label: mention.label,
            kind: mention.kind,
          });
          index += match[0].length;
          continue;
        }
      }
    }

    buffer += character;
    index += 1;
  }

  pushText();
  return nodes;
}

function isBlockStart(line: string): boolean {
  return (
    /^```/.test(line) ||
    /^#{1,3}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+\.\s+/.test(line)
  );
}

/** Parse comment markdown into blocks. Never throws on malformed input. */
export function parseCommentMarkdown(
  source: string,
  mentions: ReadonlyArray<CommentMarkdownMention> = [],
): CommentMarkdownBlock[] {
  const normalized = String(source ?? "")
    .replace(/\r\n/g, "\n")
    .replace(CONTROL_CHARACTERS, "");
  const mentionIndex = mentionMap(mentions);
  const lines = normalized.split("\n");
  const blocks: CommentMarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith("```")) {
        codeLines.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", value: codeLines.join("\n") });
      continue;
    }

    const heading = /^#{1,3}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        children: parseInline(heading[1]!, mentionIndex),
      });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index]!)) {
        quoteLines.push(lines[index]!.replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({
        type: "quote",
        children: parseInline(quoteLines.join("\n"), mentionIndex),
      });
      continue;
    }

    const unordered = /^[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered);
      const items: CommentMarkdownInline[][] = [];
      while (index < lines.length) {
        const match = isOrdered
          ? /^\d+\.\s+(.*)$/.exec(lines[index]!)
          : /^[-*+]\s+(.*)$/.exec(lines[index]!);
        if (!match) break;
        items.push(parseInline(match[1]!, mentionIndex));
        index += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      (paragraphLines.length === 0 || !isBlockStart(lines[index]!))
    ) {
      paragraphLines.push(lines[index]!);
      index += 1;
    }

    const children: CommentMarkdownInline[] = [];
    paragraphLines.forEach((paragraphLine, lineIndex) => {
      if (lineIndex > 0) children.push({ type: "break" });
      children.push(...parseInline(paragraphLine, mentionIndex));
    });

    blocks.push({
      type: "paragraph",
      children,
    });
  }

  return blocks;
}
