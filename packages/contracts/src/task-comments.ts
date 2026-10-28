/** Shared wire shapes for task comments (EGA-783). */

export const TASK_COMMENT_AUTHOR_KIND_VALUES = ["owner", "agent"] as const;
export type TaskCommentAuthorKind =
  (typeof TASK_COMMENT_AUTHOR_KIND_VALUES)[number];

export type TaskCommentAuthor = Readonly<{
  kind: TaskCommentAuthorKind;
  /** Stable ref, e.g. `owner` or `agent:codex`. */
  ref: string;
  label: string;
}>;

export type TaskCommentMention = Readonly<{
  kind: TaskCommentAuthorKind;
  ref: string;
  label: string;
}>;

export type TaskCommentReaction = Readonly<{
  emoji: string;
  count: number;
  /** True when the requesting actor owns this reaction. */
  reactedByViewer: boolean;
}>;

export type TaskCommentDto = Readonly<{
  id: string;
  taskId: string;
  body: string;
  author: TaskCommentAuthor;
  mentions: TaskCommentMention[];
  reactions: TaskCommentReaction[];
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  /** Server-derived authority; clients never infer authorship. */
  viewerCanEdit: boolean;
  viewerCanDelete: boolean;
}>;

export type TaskCommentCreateInput = Readonly<{
  body: string;
  /**
   * Stable per-composer idempotency key. Retrying the same post returns the
   * original comment instead of creating a second one.
   */
  clientRequestId: string;
}>;

export type TaskCommentUpdateInput = Readonly<{
  body: string;
}>;

export type TaskCommentListResponse = Readonly<{
  ok: true;
  comments: TaskCommentDto[];
}>;

export type TaskCommentMutationResponse = Readonly<{
  ok: true;
  comment: TaskCommentDto;
}>;

export type TaskCommentDeleteResponse = Readonly<{
  ok: true;
  deleted: true;
}>;

export type TaskCommentReactionResponse = Readonly<{
  ok: true;
  reactions: TaskCommentReaction[];
}>;

export type TaskCommentMentionCandidateDto = Readonly<{
  kind: TaskCommentAuthorKind;
  ref: string;
  handle: string;
  label: string;
}>;
