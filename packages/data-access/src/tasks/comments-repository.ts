import type {
  TaskCommentActor,
  TaskCommentCreateRecordInput,
  TaskCommentUpdateRecordInput,
  TaskCommentViewer,
  TaskCommentsRepository,
} from "@ega/application";
import type {
  TaskCommentDto,
  TaskCommentMentionCandidateDto,
  TaskCommentReaction,
} from "@ega/contracts";
import { isTaskCommentMentionRef } from "@ega/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RepositoryResult } from "@ega/application";

const COMMENT_SELECT = [
  "id",
  "task_id",
  "author_kind",
  "author_ref",
  "author_label",
  "body",
  "created_at",
  "updated_at",
  "edited_at",
  "task_comment_mentions(mention_kind, mention_ref, mention_label)",
  "task_comment_reactions(emoji, actor_ref)",
].join(",");

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  return (value ?? {}) as Row;
}

function asRows(value: unknown): Row[] {
  return (value ?? []) as Row[];
}

function asString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function repositoryFailure(code: "conflict" | "unknown" | "notFound" | "forbidden") {
  return { ok: false as const, error: { code } };
}

/**
 * RPC error messages are written by the migration; map only the stable ones we
 * own and collapse everything else so database internals never reach a client.
 */
function mapRpcError(error: unknown): RepositoryResult<never> {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  if (message.includes("idempotency conflict")) {
    return repositoryFailure("conflict");
  }
  if (
    message.includes("not authorized") ||
    message.includes("author mismatch") ||
    message.includes("owner mismatch") ||
    message.includes("invalid author")
  ) {
    return repositoryFailure("forbidden");
  }
  if (
    message.includes("not found") ||
    message.includes("no longer available") ||
    message.includes("not owned")
  ) {
    return repositoryFailure("notFound");
  }
  return repositoryFailure("unknown");
}

function mapReactions(row: Row, viewerRef: string): TaskCommentReaction[] {
  const grouped = new Map<string, { count: number; reactedByViewer: boolean }>();
  for (const reaction of asRows(row.task_comment_reactions)) {
    const emoji = asString(reaction.emoji);
    if (!emoji) continue;
    const entry = grouped.get(emoji) ?? { count: 0, reactedByViewer: false };
    entry.count += 1;
    if (asString(reaction.actor_ref) === viewerRef) entry.reactedByViewer = true;
    grouped.set(emoji, entry);
  }

  return [...grouped.entries()]
    .map(([emoji, value]) => ({ emoji, ...value }))
    .sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      return left.emoji.localeCompare(right.emoji);
    });
}

function mapComment(row: Row, viewerRef: string): TaskCommentDto {
  const authorRef = asString(row.author_ref);
  return {
    id: asString(row.id),
    taskId: asString(row.task_id),
    body: asString(row.body),
    author: {
      kind: asString(row.author_kind) === "agent" ? "agent" : "owner",
      ref: authorRef,
      label: asString(row.author_label) || "Unknown author",
    },
    mentions: asRows(row.task_comment_mentions).map((mention) => ({
      kind: asString(mention.mention_kind) === "agent" ? "agent" : "owner",
      ref: asString(mention.mention_ref),
      label: asString(mention.mention_label) || "Unknown actor",
    })),
    reactions: mapReactions(row, viewerRef),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    editedAt: asNullableString(row.edited_at),
    viewerCanEdit: authorRef === viewerRef,
    viewerCanDelete: authorRef === viewerRef,
  };
}

function parseReactionSummary(value: unknown): TaskCommentReaction[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Row => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      emoji: asString(entry.emoji),
      count: Number.isFinite(Number(entry.count)) ? Math.max(0, Number(entry.count)) : 0,
      reactedByViewer: entry.reacted === true,
    }))
    .filter((entry) => entry.emoji.length > 0)
    .sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      return left.emoji.localeCompare(right.emoji);
    });
}

function parseMentionCandidates(value: unknown): TaskCommentMentionCandidateDto[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Row => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      kind: asString(entry.kind) === "agent" ? ("agent" as const) : ("owner" as const),
      ref: asString(entry.ref),
      handle: asString(entry.handle).toLowerCase(),
      label: asString(entry.label) || "Unknown actor",
    }))
    .filter(
      (entry) =>
        entry.handle.length > 0 && isTaskCommentMentionRef(entry.ref),
    );
}

/**
 * Request-scoped Supabase adapter.
 *
 * Reads always filter by the trusted owner and a comment id/task id; the
 * database RPCs own the atomic write, mention validation, notification intent
 * and activity ledger. This adapter never uses a service-role shortcut.
 */
export class SupabaseTaskCommentsRepository implements TaskCommentsRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listTaskComments(
    viewer: TaskCommentViewer,
    taskId: string,
  ): Promise<RepositoryResult<TaskCommentDto[]>> {
    const { data, error } = await this.supabase
      .from("task_comments")
      .select(COMMENT_SELECT)
      .eq("owner_user_id", viewer.ownerUserId)
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });

    if (error) return repositoryFailure("unknown");
    return {
      ok: true,
      value: asRows(data).map((row) => mapComment(row, viewer.actorRef)),
    };
  }

  async createTaskComment(
    actor: TaskCommentActor,
    input: TaskCommentCreateRecordInput,
  ): Promise<RepositoryResult<TaskCommentDto>> {
    const { data, error } = await this.supabase.rpc("create_task_comment", {
      p_task_id: input.taskId,
      p_body: input.body,
      p_client_request_id: input.clientRequestId,
      p_author_kind: actor.kind,
      p_owner_user_id: actor.ownerUserId,
      p_author_token_id: actor.tokenId ?? null,
      p_mentions: input.mentions.map((mention) => ({
        kind: mention.kind,
        ref: mention.ref,
        label: mention.label,
      })),
    });

    if (error) return mapRpcError(error);
    const row = asRow(data);
    const commentId = asString(row.id);
    if (!commentId) return repositoryFailure("unknown");
    return this.getTaskComment(
      { ownerUserId: actor.ownerUserId, actorRef: actor.ref },
      commentId,
    );
  }

  async updateTaskComment(
    actor: TaskCommentActor,
    input: TaskCommentUpdateRecordInput,
  ): Promise<RepositoryResult<TaskCommentDto>> {
    const { error } = await this.supabase.rpc("update_task_comment", {
      p_comment_id: input.commentId,
      p_body: input.body,
      p_author_kind: actor.kind,
      p_owner_user_id: actor.ownerUserId,
      p_author_token_id: actor.tokenId ?? null,
      p_mentions: input.mentions.map((mention) => ({
        kind: mention.kind,
        ref: mention.ref,
        label: mention.label,
      })),
    });

    if (error) return mapRpcError(error);
    return this.getTaskComment(
      { ownerUserId: actor.ownerUserId, actorRef: actor.ref },
      input.commentId,
    );
  }

  async deleteTaskComment(
    actor: TaskCommentActor,
    commentId: string,
  ): Promise<RepositoryResult<true>> {
    const { error } = await this.supabase.rpc("delete_task_comment", {
      p_comment_id: commentId,
      p_author_kind: actor.kind,
      p_owner_user_id: actor.ownerUserId,
      p_author_token_id: actor.tokenId ?? null,
    });

    if (error) return mapRpcError(error);
    return { ok: true, value: true };
  }

  async toggleTaskCommentReaction(
    actor: TaskCommentActor,
    input: { commentId: string; emoji: string },
  ): Promise<RepositoryResult<TaskCommentReaction[]>> {
    const { data, error } = await this.supabase.rpc(
      "toggle_task_comment_reaction",
      {
        p_comment_id: input.commentId,
        p_emoji: input.emoji,
        p_actor_kind: actor.kind,
        p_owner_user_id: actor.ownerUserId,
        p_actor_token_id: actor.tokenId ?? null,
      },
    );

    if (error) return mapRpcError(error);
    return { ok: true, value: parseReactionSummary(data) };
  }

  async listTaskCommentMentionCandidates(
    viewer: TaskCommentViewer,
  ): Promise<RepositoryResult<TaskCommentMentionCandidateDto[]>> {
    const { data, error } = await this.supabase.rpc(
      "list_task_comment_mentions",
      { p_owner_user_id: viewer.ownerUserId },
    );
    if (error) return mapRpcError(error);
    return { ok: true, value: parseMentionCandidates(data) };
  }

  private async getTaskComment(
    viewer: TaskCommentViewer,
    commentId: string,
  ): Promise<RepositoryResult<TaskCommentDto>> {
    const { data, error } = await this.supabase
      .from("task_comments")
      .select(COMMENT_SELECT)
      .eq("owner_user_id", viewer.ownerUserId)
      .eq("id", commentId)
      .maybeSingle();

    if (error) return repositoryFailure("unknown");
    if (!data) return repositoryFailure("notFound");
    return { ok: true, value: mapComment(asRow(data), viewer.actorRef) };
  }
}
