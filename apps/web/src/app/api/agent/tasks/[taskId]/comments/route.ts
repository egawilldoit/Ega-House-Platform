// Scoped agent comments: GET /api/agent/tasks/:taskId/comments
//                           POST /api/agent/tasks/:taskId/comments

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

type RouteContext = { params: Promise<{ taskId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  return handlers.GET_COMMENTS(request, taskId);
}

export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  return handlers.POST_COMMENTS(request, taskId);
}
