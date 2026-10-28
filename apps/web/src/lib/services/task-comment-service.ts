import {
  createAuthenticatedActor,
  createTaskComment,
  deleteTaskComment,
  listTaskCommentMentionCandidates,
  listTaskComments,
  toggleTaskCommentReaction,
  updateTaskComment,
  type TaskCommentActor,
  type TaskCommentViewer,
} from "@ega/application";
import { SupabaseTaskCommentsRepository } from "@ega/data-access/tasks/comments";
import type {
  TaskCommentDto,
  TaskCommentMentionCandidateDto,
  TaskCommentReaction,
} from "@ega/contracts";
import { ownerTaskCommentActor } from "@ega/domain";

import { requireAuthenticatedIdentity } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type TaskCommentServiceOptions = {
  supabase?: SupabaseServerClient;
};

export type TaskCommentThread = {
  comments: TaskCommentDto[];
  mentionCandidates: TaskCommentMentionCandidateDto[];
  errorMessage: string | null;
};

export type TaskCommentWriteResult<T> = {
  data: T | null;
  errorMessage: string | null;
};

async function getContext(options?: TaskCommentServiceOptions) {
  const supabase = options?.supabase ?? (await createClient());
  const identity = await requireAuthenticatedIdentity({ supabase });
  const actor = createAuthenticatedActor(identity.id);
  const repository = new SupabaseTaskCommentsRepository(supabase as never);
  const viewer: TaskCommentViewer = {
    ownerUserId: actor.userId,
    actorRef: "owner",
  };
  const author: TaskCommentActor = {
    ...ownerTaskCommentActor(actor.userId),
  };
  return { actor, repository, viewer, author };
}

export async function getTaskCommentThread(
  taskId: string,
  options?: TaskCommentServiceOptions,
): Promise<TaskCommentThread> {
  try {
    const { actor, repository, viewer } = await getContext(options);
    const [comments, candidates] = await Promise.all([
      listTaskComments(viewer, repository, taskId),
      listTaskCommentMentionCandidates(actor, repository),
    ]);

    if (!comments.ok) {
      return {
        comments: [],
        mentionCandidates: candidates.ok ? candidates.data : [],
        errorMessage: comments.errorMessage,
      };
    }

    return {
      comments: comments.data,
      mentionCandidates: candidates.ok ? candidates.data : [],
      errorMessage: candidates.ok
        ? null
        : "Mention suggestions are unavailable right now.",
    };
  } catch {
    return {
      comments: [],
      mentionCandidates: [],
      errorMessage: "Unable to load comments right now.",
    };
  }
}

export async function createTaskCommentForOwner(
  input: { taskId: string; body: string; clientRequestId: string },
  options?: TaskCommentServiceOptions,
): Promise<TaskCommentWriteResult<TaskCommentDto>> {
  try {
    const { repository, author } = await getContext(options);
    const result = await createTaskComment(author, repository, input);
    return result.ok
      ? { data: result.data, errorMessage: null }
      : { data: null, errorMessage: result.errorMessage };
  } catch {
    return { data: null, errorMessage: "Unable to post the comment right now." };
  }
}

export async function updateTaskCommentForOwner(
  input: { commentId: string; taskId?: string | null; body: string },
  options?: TaskCommentServiceOptions,
): Promise<TaskCommentWriteResult<TaskCommentDto>> {
  try {
    const { repository, author } = await getContext(options);
    const result = await updateTaskComment(author, repository, input);
    return result.ok
      ? { data: result.data, errorMessage: null }
      : { data: null, errorMessage: result.errorMessage };
  } catch {
    return { data: null, errorMessage: "Unable to save the comment right now." };
  }
}

export async function deleteTaskCommentForOwner(
  commentId: string,
  taskId?: string | null,
  options?: TaskCommentServiceOptions,
): Promise<{ errorMessage: string | null }> {
  try {
    const { repository, author } = await getContext(options);
    const result = await deleteTaskComment(author, repository, commentId, taskId);
    return { errorMessage: result.ok ? null : result.errorMessage };
  } catch {
    return { errorMessage: "Unable to delete the comment right now." };
  }
}

export async function toggleTaskCommentReactionForOwner(
  input: { commentId: string; taskId?: string | null; emoji: string },
  options?: TaskCommentServiceOptions,
): Promise<TaskCommentWriteResult<TaskCommentReaction[]>> {
  try {
    const { repository, author } = await getContext(options);
    const result = await toggleTaskCommentReaction(author, repository, input);
    return result.ok
      ? { data: result.data, errorMessage: null }
      : { data: null, errorMessage: result.errorMessage };
  } catch {
    return { data: null, errorMessage: "Unable to update the reaction right now." };
  }
}
