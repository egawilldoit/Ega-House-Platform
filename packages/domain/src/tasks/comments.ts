/**
 * Pure rules for task comments.
 *
 * Comments are owner-scoped notes on a task. The author identity is separate
 * from the credential used to write: an agent comment stores a stable actor ref
 * derived from the configured agent name, so rotating a token does not rewrite
 * history. Mentions are resolved only against actors the owner actually
 * configured; a typed `@SomeAgent` that does not resolve stays plain text and
 * never becomes a mention or a notification.
 */

export const TASK_COMMENT_BODY_MAX = 4000;
export const TASK_COMMENT_REQUEST_ID_MAX = 128;
export const TASK_COMMENT_MENTION_MAX = 20;
export const TASK_COMMENT_AUTHOR_LABEL_MAX = 256;

/** The reaction picker is a fixed, small set; free-form emoji are refused. */
export const TASK_COMMENT_REACTION_EMOJIS = [
  "👍",
  "👀",
  "✅",
  "🎉",
  "🙏",
  "🔥",
] as const;

export type TaskCommentReactionEmoji =
  (typeof TASK_COMMENT_REACTION_EMOJIS)[number];

export type TaskCommentMentionCandidate = Readonly<{
  kind: "owner" | "agent";
  /** Stable reference, e.g. `owner` or `agent:codex`. */
  ref: string;
  /** Lower-case handle typed after `@`. */
  handle: string;
  label: string;
}>;

export type ResolvedTaskCommentMention = Readonly<{
  kind: "owner" | "agent";
  ref: string;
  handle: string;
  label: string;
}>;

export type NormalizedText =
  | Readonly<{ ok: true; value: string }>
  | Readonly<{ ok: false; errorMessage: string }>;

export function normalizeTaskCommentBody(value: unknown): NormalizedText {
  const body = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if (!body) return { ok: false, errorMessage: "A comment is required." };
  if (body.includes("\u0000")) {
    return { ok: false, errorMessage: "Comment contains an unsupported character." };
  }
  if (body.length > TASK_COMMENT_BODY_MAX) {
    return {
      ok: false,
      errorMessage: `Comment must be ${TASK_COMMENT_BODY_MAX} characters or fewer.`,
    };
  }
  return { ok: true, value: body };
}

export function normalizeTaskCommentRequestId(value: unknown): NormalizedText {
  const requestId = String(value ?? "").trim();
  if (!requestId) {
    return { ok: false, errorMessage: "A request id is required to post a comment." };
  }
  if (requestId.length > TASK_COMMENT_REQUEST_ID_MAX) {
    return { ok: false, errorMessage: "Request id is too long." };
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(requestId)) {
    return { ok: false, errorMessage: "Request id contains unsupported characters." };
  }
  return { ok: true, value: requestId };
}

/**
 * Stable, URL-safe actor handle. Token rotation keeps the name, so the handle
 * (and therefore historical author attribution) stays the same.
 */
export function taskCommentActorSlug(name: unknown): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 62);
}

export function agentMentionRef(name: unknown): string {
  const slug = taskCommentActorSlug(name);
  return slug ? `agent:${slug}` : "";
}

export function isTaskCommentMentionRef(value: unknown): boolean {
  const ref = String(value ?? "");
  return ref === "owner" || /^agent:[a-z0-9][a-z0-9-]{0,62}$/.test(ref);
}

export function isTaskCommentReactionEmoji(
  value: unknown,
): value is TaskCommentReactionEmoji {
  return (TASK_COMMENT_REACTION_EMOJIS as readonly string[]).includes(
    String(value ?? ""),
  );
}

/**
 * Handles typed as `@handle` in a body. `foo@bar` (an email-like token) is not
 * a mention because the `@` must start a word. Duplicates collapse.
 */
export function extractTaskCommentMentionHandles(body: unknown): string[] {
  const text = String(body ?? "");
  const handles: string[] = [];
  const pattern = /(^|[\s([{])@([a-z0-9][a-z0-9-]{0,62})/gi;
  for (const match of text.matchAll(pattern)) {
    const handle = (match[2] ?? "").toLowerCase();
    if (handle && !handles.includes(handle)) handles.push(handle);
  }
  return handles;
}

/**
 * Resolve typed handles to real authorized actors. Unknown handles are dropped
 * instead of becoming fake recipients, and owner/agent candidates are matched by
 * their stable handle rather than by display label.
 */
export function resolveTaskCommentMentions(
  body: unknown,
  candidates: ReadonlyArray<TaskCommentMentionCandidate>,
): ResolvedTaskCommentMention[] {
  const byHandle = new Map<string, TaskCommentMentionCandidate>();
  for (const candidate of candidates) {
    const handle = String(candidate.handle ?? "").toLowerCase();
    if (!handle || byHandle.has(handle)) continue;
    if (!isTaskCommentMentionRef(candidate.ref)) continue;
    byHandle.set(handle, { ...candidate, handle });
  }

  return extractTaskCommentMentionHandles(body)
    .map((handle) => byHandle.get(handle))
    .filter((candidate): candidate is TaskCommentMentionCandidate => Boolean(candidate))
    .slice(0, TASK_COMMENT_MENTION_MAX)
    .map((candidate) => ({
      kind: candidate.kind,
      ref: candidate.ref,
      handle: candidate.handle,
      label: candidate.label,
    }));
}

/** Owner actor ref used by the web and mobile owner paths. */
export function ownerTaskCommentActor(
  ownerUserId: string,
): Readonly<{
  ownerUserId: string;
  kind: "owner";
  ref: "owner";
  label: "Owner";
}> {
  return {
    ownerUserId,
    kind: "owner",
    ref: "owner",
    label: "Owner",
  };
}
