// Scoped agent comments: PATCH /api/agent/tasks/:taskId/comments/:commentId
//                           DELETE /api/agent/tasks/:taskId/comments/:commentId

import { after } from "next/server";

import { db } from "@/db/client";
import { AgentRateLimitService } from "@/lib/services/agent-rate-limit-service";
import { DrizzleTokenRepository } from "@/lib/services/agent-token-repository";
import {
  createCommentHandlers,
  type CommentTelemetryFn,
} from "@/lib/http/agent-comment-handlers";

const repo = new DrizzleTokenRepository(db);
const rateLimiter = new AgentRateLimitService();

const telemetry: CommentTelemetryFn = async (tokenId) => {
  after(async () => {
    try {
      await repo.updateLastUsedAt(tokenId);
    } catch (err) {
      console.warn(
        "[agent-comments] last_used_at update failed:",
        (err as Error)?.message ?? err,
      );
    }
  });
};

const handlers = createCommentHandlers(repo, rateLimiter, telemetry);

type RouteContext = {
  params: Promise<{ taskId: string; commentId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { taskId, commentId } = await context.params;
  return handlers.PATCH_COMMENT(request, taskId, commentId);
}

export async function DELETE(request: Request, context: RouteContext) {
  const { taskId, commentId } = await context.params;
  return handlers.DELETE_COMMENT(request, taskId, commentId);
}
