import { Hono } from "hono";

import {
  createTaskComment,
  deleteTaskComment,
  listTaskComments,
  toggleTaskCommentReaction,
  updateTaskComment,
  type ApplicationResult,
} from "@ega/application";
import type {
  TaskCommentDeleteResponse,
  TaskCommentListResponse,
  TaskCommentMutationResponse,
  TaskCommentReactionResponse,
} from "@ega/contracts";
import { ownerTaskCommentActor } from "@ega/domain";
import { SupabaseTaskCommentsRepository } from "@ega/data-access/tasks/comments";

import type { ServerVariables } from "../app";
import { readJsonBody } from "../app";

function errorResponse<T>(
  c: { json: (body: unknown, status: number) => Response },
  result: Extract<ApplicationResult<T>, { ok: false }>,
) {
  switch (result.code) {
    case "notFound":
      return c.json({ error: { code: "NOT_FOUND", message: result.errorMessage } }, 404);
    case "forbidden":
      return c.json({ error: { code: "FORBIDDEN", message: result.errorMessage } }, 403);
    case "conflict":
      return c.json({ error: { code: "CONFLICT", message: result.errorMessage } }, 409);
    case "validation":
      return c.json({ error: { code: "VALIDATION", message: result.errorMessage } }, 422);
    default:
      return c.json({ error: { code: "INTERNAL", message: result.errorMessage } }, 500);
  }
}

/**
 * Owner-scoped comment transport for mobile.
 *
 * Identity comes from the verified bearer actor; the request-scoped Supabase
 * client keeps RLS in force. The database RPC owns idempotency, mentions and
 * reaction atomicity.
 */
export function createTaskCommentsRoutes(): Hono<{ Variables: ServerVariables }> {
  const routes = new Hono<{ Variables: ServerVariables }>();

  function context(c: {
    var: ServerVariables;
  }) {
    const { actor, client } = c.var;
    return {
      viewer: { ownerUserId: actor.userId, actorRef: "owner" as const },
      author: ownerTaskCommentActor(actor.userId),
      repository: new SupabaseTaskCommentsRepository(client as never),
    };
  }

  routes.get("/:taskId/comments", async (c) => {
    try {
      const { viewer, repository } = context(c);
      const result = await listTaskComments(viewer, repository, c.req.param("taskId"));
      if (!result.ok) return errorResponse(c, result);

      return c.json(
        { ok: true as const, comments: result.data } satisfies TaskCommentListResponse,
      );
    } catch {
      return c.json({ error: { code: "INTERNAL", message: "Unable to load comments right now." } }, 500);
    }
  });

  routes.post("/:taskId/comments", async (c) => {
    try {
      const { author, repository } = context(c);
      const body = await readJsonBody(c);
      if (!body) {
        return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
      }

      const result = await createTaskComment(author, repository, {
        taskId: c.req.param("taskId"),
        body: body.body,
        clientRequestId: body.clientRequestId,
      });
      if (!result.ok) return errorResponse(c, result);

      return c.json(
        { ok: true as const, comment: result.data } satisfies TaskCommentMutationResponse,
        201,
      );
    } catch {
      return c.json({ error: { code: "INTERNAL", message: "Unable to post the comment right now." } }, 500);
    }
  });

  routes.patch("/:taskId/comments/:commentId", async (c) => {
    try {
      const { author, repository } = context(c);
      const body = await readJsonBody(c);
      if (!body) {
        return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
      }

      const result = await updateTaskComment(author, repository, {
        commentId: c.req.param("commentId"),
        taskId: c.req.param("taskId"),
        body: body.body,
      });
      if (!result.ok) return errorResponse(c, result);

      return c.json(
        { ok: true as const, comment: result.data } satisfies TaskCommentMutationResponse,
      );
    } catch {
      return c.json({ error: { code: "INTERNAL", message: "Unable to save the comment right now." } }, 500);
    }
  });

  routes.delete("/:taskId/comments/:commentId", async (c) => {
    try {
      const { author, repository } = context(c);
      const result = await deleteTaskComment(
        author,
        repository,
        c.req.param("commentId"),
        c.req.param("taskId"),
      );
      if (!result.ok) return errorResponse(c, result);

      return c.json({ ok: true as const, deleted: true } satisfies TaskCommentDeleteResponse);
    } catch {
      return c.json({ error: { code: "INTERNAL", message: "Unable to delete the comment right now." } }, 500);
    }
  });

  routes.post("/:taskId/comments/:commentId/reactions", async (c) => {
    try {
      const { author, repository } = context(c);
      const body = await readJsonBody(c);
      if (!body) {
        return c.json({ error: { code: "VALIDATION", message: "Request body must be valid JSON." } }, 400);
      }

      const result = await toggleTaskCommentReaction(author, repository, {
        commentId: c.req.param("commentId"),
        taskId: c.req.param("taskId"),
        emoji: body.emoji,
      });
      if (!result.ok) return errorResponse(c, result);

      return c.json(
        { ok: true as const, reactions: result.data } satisfies TaskCommentReactionResponse,
      );
    } catch {
      return c.json({ error: { code: "INTERNAL", message: "Unable to update the reaction right now." } }, 500);
    }
  });

  return routes;
}
