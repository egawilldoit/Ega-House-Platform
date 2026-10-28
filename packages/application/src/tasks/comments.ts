import type {
  TaskCommentDto,
  TaskCommentMentionCandidateDto,
  TaskCommentReaction,
} from "@ega/contracts";
import {
  extractTaskCommentMentionHandles,
  isTaskCommentReactionEmoji,
  normalizeTaskCommentBody,
  normalizeTaskCommentRequestId,
  resolveTaskCommentMentions,
  type ResolvedTaskCommentMention,
  type TaskCommentMentionCandidate,
} from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
  type RepositoryFailure,
  type RepositoryResult,
} from "../shared/result";

/** The caller whose isolation boundary this operation runs inside. */
export type TaskCommentViewer = Readonly<{
  ownerUserId: string;
  /** `owner` or `agent:<stable-name>`; decides reactedByViewer/canEdit. */
  actorRef: string;
}>;

/**
 * Verified author for a write. The token id is credential evidence only; the
 * stable ref/label are what history keeps after rotation or revocation.
 */
export type TaskCommentActor = Readonly<{
  ownerUserId: string;
  kind: "owner" | "agent";
  ref: string;
  label: string;
  tokenId?: string | null;
}>;

export type TaskCommentCreateRecordInput = Readonly<{
  taskId: string;
  body: string;
  clientRequestId: string;
  mentions: ResolvedTaskCommentMention[];
}>;

export type TaskCommentUpdateRecordInput = Readonly<{
  commentId: string;
  body: string;
  mentions: ResolvedTaskCommentMention[];
}>;

export interface TaskCommentsRepository {
  listTaskComments(
    viewer: TaskCommentViewer,
    taskId: string,
  ): Promise<RepositoryResult<TaskCommentDto[]>>;
  createTaskComment(
    actor: TaskCommentActor,
    input: TaskCommentCreateRecordInput,
  ): Promise<RepositoryResult<TaskCommentDto>>;
  updateTaskComment(
    actor: TaskCommentActor,
    input: TaskCommentUpdateRecordInput,
  ): Promise<RepositoryResult<TaskCommentDto>>;
  deleteTaskComment(
    actor: TaskCommentActor,
    commentId: string,
  ): Promise<RepositoryResult<true>>;
  toggleTaskCommentReaction(
    actor: TaskCommentActor,
    input: { commentId: string; emoji: string },
  ): Promise<RepositoryResult<TaskCommentReaction[]>>;
  listTaskCommentMentionCandidates(
    viewer: TaskCommentViewer,
  ): Promise<RepositoryResult<TaskCommentMentionCandidateDto[]>>;
}

function failureMessage(code: RepositoryFailure["code"]): string {
  switch (code) {
    case "conflict":
      return "That comment request was already used for different content.";
    case "notFound":
      return "Comment was not found or is no longer available.";
    case "forbidden":
      return "You can only change your own comments.";
    default:
      return "Unable to update the comment right now.";
  }
}

function fromRepository<T>(
  result: RepositoryResult<T>,
  fallback: string,
): ApplicationResult<T> {
  if (result.ok) return applicationSuccess(result.value);
  const code = result.error.code;
  const message = code === "unknown" ? fallback : failureMessage(code);
  return applicationFailure(message, code === "unknown" ? undefined : code);
}

function validViewer(viewer: TaskCommentViewer): string | null {
  if (!viewer?.ownerUserId?.trim()) return "Authentication required.";
  if (!viewer.actorRef?.trim()) return "Authentication required.";
  return null;
}

function validateActor(actor: TaskCommentActor): string | null {
  if (!actor?.ownerUserId?.trim()) return "Authentication required.";
  if (actor.kind === "owner") {
    if (actor.ref !== "owner") return "Author identity is invalid.";
    return null;
  }
  if (!actor.tokenId?.trim()) return "Agent author identity is invalid.";
  if (!/^agent:[a-z0-9][a-z0-9-]{0,62}$/.test(actor.ref)) {
    return "Agent author identity is invalid.";
  }
  return null;
}

function normalizedMentions(
  body: string,
  candidates: ReadonlyArray<TaskCommentMentionCandidate>,
): ResolvedTaskCommentMention[] {
  return resolveTaskCommentMentions(body, candidates);
}

async function resolveMentions(
  body: string,
  viewer: TaskCommentViewer,
  repository: TaskCommentsRepository,
): Promise<
  | { ok: true; mentions: ResolvedTaskCommentMention[] }
  | { ok: false; errorMessage: string }
> {
  if (extractTaskCommentMentionHandles(body).length === 0) {
    return { ok: true, mentions: [] };
  }

  const candidates = await repository.listTaskCommentMentionCandidates(viewer);
  if (!candidates.ok) {
    return {
      ok: false,
      errorMessage: "Unable to resolve mentions right now. Try again.",
    };
  }
  return { ok: true, mentions: normalizedMentions(body, candidates.value) };
}

export async function listTaskComments(
  viewer: TaskCommentViewer,
  repository: TaskCommentsRepository,
  taskId: string,
): Promise<ApplicationResult<TaskCommentDto[]>> {
  const invalid = validViewer(viewer);
  if (invalid) return applicationFailure(invalid);
  if (!taskId?.trim()) {
    return applicationFailure("Task was not found or is no longer available.", "notFound");
  }

  return fromRepository(
    await repository.listTaskComments(viewer, taskId),
    "Unable to load comments right now.",
  );
}

export async function createTaskComment(
  actor: TaskCommentActor,
  repository: TaskCommentsRepository,
  input: { taskId: string; body: unknown; clientRequestId: unknown },
): Promise<ApplicationResult<TaskCommentDto>> {
  const invalidActor = validateActor(actor);
  if (invalidActor) return applicationFailure(invalidActor);
  if (!input.taskId?.trim()) {
    return applicationFailure("Task was not found or is no longer available.", "notFound");
  }

  const body = normalizeTaskCommentBody(input.body);
  if (!body.ok) return applicationFailure(body.errorMessage, "validation");

  const requestId = normalizeTaskCommentRequestId(input.clientRequestId);
  if (!requestId.ok) return applicationFailure(requestId.errorMessage, "validation");

  const mentions = await resolveMentions(
    body.value,
    { ownerUserId: actor.ownerUserId, actorRef: actor.ref },
    repository,
  );
  if ("errorMessage" in mentions) return applicationFailure(mentions.errorMessage);

  return fromRepository(
    await repository.createTaskComment(actor, {
      taskId: input.taskId,
      body: body.value,
      clientRequestId: requestId.value,
      mentions: mentions.mentions,
    }),
    "Unable to post the comment right now.",
  );
}

export async function updateTaskComment(
  actor: TaskCommentActor,
  repository: TaskCommentsRepository,
  input: { commentId: string; body: unknown },
): Promise<ApplicationResult<TaskCommentDto>> {
  const invalidActor = validateActor(actor);
  if (invalidActor) return applicationFailure(invalidActor);
  if (!input.commentId?.trim()) return applicationFailure("Comment was not found.", "notFound");

  const body = normalizeTaskCommentBody(input.body);
  if (!body.ok) return applicationFailure(body.errorMessage, "validation");

  const mentions = await resolveMentions(
    body.value,
    { ownerUserId: actor.ownerUserId, actorRef: actor.ref },
    repository,
  );
  if ("errorMessage" in mentions) return applicationFailure(mentions.errorMessage);

  return fromRepository(
    await repository.updateTaskComment(actor, {
      commentId: input.commentId,
      body: body.value,
      mentions: mentions.mentions,
    }),
    "Unable to save the comment right now.",
  );
}

export async function deleteTaskComment(
  actor: TaskCommentActor,
  repository: TaskCommentsRepository,
  commentId: string,
): Promise<ApplicationResult<{ deleted: true }>> {
  const invalidActor = validateActor(actor);
  if (invalidActor) return applicationFailure(invalidActor);
  if (!commentId?.trim()) return applicationFailure("Comment was not found.", "notFound");

  const result = await repository.deleteTaskComment(actor, commentId);
  if (!result.ok) {
    const code = result.error.code;
    return applicationFailure(
      code === "unknown" ? "Unable to delete the comment right now." : failureMessage(code),
      code === "unknown" ? undefined : code,
    );
  }
  return applicationSuccess({ deleted: true });
}

export async function toggleTaskCommentReaction(
  actor: TaskCommentActor,
  repository: TaskCommentsRepository,
  input: { commentId: string; emoji: unknown },
): Promise<ApplicationResult<TaskCommentReaction[]>> {
  const invalidActor = validateActor(actor);
  if (invalidActor) return applicationFailure(invalidActor);
  if (!input.commentId?.trim()) return applicationFailure("Comment was not found.", "notFound");
  if (!isTaskCommentReactionEmoji(input.emoji)) {
    return applicationFailure("That reaction is not supported.", "validation");
  }

  return fromRepository(
    await repository.toggleTaskCommentReaction(actor, {
      commentId: input.commentId,
      emoji: input.emoji,
    }),
    "Unable to update the reaction right now.",
  );
}

export async function listTaskCommentMentionCandidates(
  actor: Pick<AuthenticatedActor, "userId">,
  repository: TaskCommentsRepository,
): Promise<ApplicationResult<TaskCommentMentionCandidateDto[]>> {
  if (!actor?.userId?.trim()) return applicationFailure("Authentication required.");

  return fromRepository(
    await repository.listTaskCommentMentionCandidates({
      ownerUserId: actor.userId,
      actorRef: "owner",
    }),
    "Unable to load mention suggestions right now.",
  );
}
