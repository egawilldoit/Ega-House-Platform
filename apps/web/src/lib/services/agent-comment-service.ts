import {
  createTaskComment,
  deleteTaskComment,
  listTaskComments,
  toggleTaskCommentReaction,
  updateTaskComment,
  type TaskCommentActor,
  type TaskCommentViewer,
} from "@ega/application";
import type {
  TaskCommentDto,
  TaskCommentReaction,
} from "@ega/contracts";
import { agentMentionRef } from "@ega/domain";
import { SupabaseTaskCommentsRepository } from "@ega/data-access/tasks/comments";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type AgentCommentResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorMessage: string; code?: "conflict" | "validation" | "notFound" | "forbidden" | "unknown" };

export type AgentCommentIdentity = {
  ownerUserId: string;
  tokenId: string;
  tokenName: string;
};

function actorFor(identity: AgentCommentIdentity): TaskCommentActor {
  return {
    ownerUserId: identity.ownerUserId,
    kind: "agent",
    ref: agentMentionRef(identity.tokenName),
    label: identity.tokenName,
    tokenId: identity.tokenId,
  };
}

function viewerFor(identity: AgentCommentIdentity): TaskCommentViewer {
  return {
    ownerUserId: identity.ownerUserId,
    actorRef: agentMentionRef(identity.tokenName),
  };
}

function repository() {
  return new SupabaseTaskCommentsRepository(getSupabaseServiceClient() as never);
}

export async function listAgentTaskComments(
  identity: AgentCommentIdentity,
  taskId: string,
): Promise<AgentCommentResult<TaskCommentDto[]>> {
  const result = await listTaskComments(
    viewerFor(identity),
    repository(),
    taskId,
  );
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, errorMessage: result.errorMessage, code: result.code };
}

export async function createAgentTaskComment(
  identity: AgentCommentIdentity,
  input: { taskId: string; body: string; clientRequestId: string },
): Promise<AgentCommentResult<TaskCommentDto>> {
  const result = await createTaskComment(actorFor(identity), repository(), input);
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, errorMessage: result.errorMessage, code: result.code };
}

export async function updateAgentTaskComment(
  identity: AgentCommentIdentity,
  input: { taskId: string; commentId: string; body: string },
): Promise<AgentCommentResult<TaskCommentDto>> {
  const result = await updateTaskComment(actorFor(identity), repository(), input);
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, errorMessage: result.errorMessage, code: result.code };
}

export async function deleteAgentTaskComment(
  identity: AgentCommentIdentity,
  input: { taskId: string; commentId: string },
): Promise<AgentCommentResult<{ deleted: true }>> {
  const result = await deleteTaskComment(
    actorFor(identity),
    repository(),
    input.commentId,
    input.taskId,
  );
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, errorMessage: result.errorMessage, code: result.code };
}

export async function toggleAgentTaskCommentReaction(
  identity: AgentCommentIdentity,
  input: { taskId: string; commentId: string; emoji: string },
): Promise<AgentCommentResult<TaskCommentReaction[]>> {
  const result = await toggleTaskCommentReaction(actorFor(identity), repository(), input);
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, errorMessage: result.errorMessage, code: result.code };
}
