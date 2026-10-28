// Testable HTTP handlers for the scoped agent comment endpoints.
// Author identity always comes from the verified token context; body fields
// that try to select an author are rejected rather than ignored.

import { NextResponse } from "next/server";

import type { TokenRepository } from "@/lib/services/agent-token-repository";
import { resolveAgentAuth } from "@/lib/services/agent-token-service";
import { AgentRateLimitService } from "@/lib/services/agent-rate-limit-service";
import {
  createAgentTaskComment,
  deleteAgentTaskComment,
  listAgentTaskComments,
  toggleAgentTaskCommentReaction,
  updateAgentTaskComment,
  type AgentCommentIdentity,
  type AgentCommentResult,
} from "@/lib/services/agent-comment-service";
import {
  forbidden,
  invalidRequest,
  rateLimited,
} from "@/lib/http/agent-errors";
import { INTERNAL_ERROR_RESPONSE } from "@/lib/contracts/agent";
import type {
  AgentAuthContext,
  AgentTokenScopes,
} from "@/lib/contracts/agent";
import type {
  TaskCommentDeleteResponse,
  TaskCommentListResponse,
  TaskCommentMutationResponse,
  TaskCommentReactionResponse,
} from "@ega/contracts";

export type CommentTelemetryFn = (tokenId: string) => Promise<void>;

const FORBIDDEN_AUTHOR_FIELDS = new Set([
  "author",
  "authorKind",
  "author_kind",
  "authorRef",
  "author_ref",
  "authorLabel",
  "author_label",
  "authorUserId",
  "author_user_id",
  "authorTokenId",
  "author_token_id",
  "ownerUserId",
  "owner_user_id",
  "actorRef",
  "actor_ref",
  "actorKind",
  "actor_kind",
  "mentions",
  "mentionRefs",
  "mention_refs",
]);

function hasTaskScope(
  scopes: AgentTokenScopes,
  operation: "read" | "comment",
): boolean {
  return scopes.tasks?.[operation] === true;
}

function identity(auth: AgentAuthContext): AgentCommentIdentity {
  return {
    ownerUserId: auth.ownerUserId,
    tokenId: auth.tokenId,
    tokenName: auth.tokenName,
  };
}

function failureResponse(
  result: Extract<AgentCommentResult<unknown>, { ok: false }>,
): ReturnType<typeof NextResponse.json> {
  switch (result.code) {
    case "notFound":
      return NextResponse.json(
        { ok: false, error: { code: "NOT_FOUND", message: result.errorMessage } },
        { status: 404 },
      );
    case "forbidden":
      return NextResponse.json(
        { ok: false, error: { code: "FORBIDDEN", message: result.errorMessage } },
        { status: 403 },
      );
    case "conflict":
      return NextResponse.json(
        { ok: false, error: { code: "CONFLICT", message: result.errorMessage } },
        { status: 409 },
      );
    case "validation":
      return NextResponse.json(
        { ok: false, error: { code: "VALIDATION_ERROR", message: result.errorMessage } },
        { status: 422 },
      );
    default:
      return NextResponse.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
  }
}

function rejectAuthorFields(body: Record<string, unknown>): ReturnType<typeof NextResponse.json> | null {
  const present = Object.keys(body).filter((key) => FORBIDDEN_AUTHOR_FIELDS.has(key));
  if (present.length === 0) return null;
  const err = invalidRequest(
    `Author, owner and mention fields are derived from the verified token and comment body: ${present.join(", ")}.`,
  );
  return NextResponse.json(err.body, { status: err.status });
}

export function createCommentHandlers(
  repo: TokenRepository,
  rateLimiter?: AgentRateLimitService,
  telemetry?: CommentTelemetryFn,
) {
  async function authenticate(request: Request) {
    const auth = await resolveAgentAuth(request, repo);
    if (!auth.ok) {
      return { response: NextResponse.json(auth.response, { status: auth.status }), auth: null };
    }
    return { response: null, auth: auth.context };
  }

  function checkRateLimit(tokenId: string): ReturnType<typeof NextResponse.json> | null {
    if (!rateLimiter) return null;
    const result = rateLimiter.check(tokenId);
    if (!result.ok) {
      const err = rateLimited(result.retryAfter);
      return NextResponse.json(err.body, {
        status: err.status,
        headers: { "Retry-After": String(result.retryAfter) },
      });
    }
    return null;
  }

  function runTelemetry(tokenId: string): void {
    if (!telemetry) return;
    telemetry(tokenId).catch((err: unknown) => {
      console.warn(
        "[agent-comments] telemetry failed:",
        (err as Error)?.message ?? err,
      );
    });
  }

  async function readBody(request: Request) {
    try {
      const body: unknown = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { ok: false as const, error: invalidRequest("Request body must be a JSON object.") };
      }
      return { ok: true as const, body: body as Record<string, unknown> };
    } catch {
      return { ok: false as const, error: invalidRequest("Request body must be valid JSON.") };
    }
  }

  const GET_COMMENTS = async (request: Request, taskId: string) => {
    try {
      const { response: authResponse, auth } = await authenticate(request);
      if (authResponse) return authResponse;
      if (!hasTaskScope(auth!.scopes, "read")) {
        const err = forbidden('Agent token lacks "tasks:read" scope.');
        return NextResponse.json(err.body, { status: err.status });
      }
      const rateLimitResponse = checkRateLimit(auth!.tokenId);
      if (rateLimitResponse) return rateLimitResponse;
      runTelemetry(auth!.tokenId);

      const result = await listAgentTaskComments(identity(auth!), taskId);
      if (!result.ok) return failureResponse(result);

      const response: TaskCommentListResponse = {
        ok: true,
        comments: result.data,
      };
      return NextResponse.json(response, { status: 200 });
    } catch (err) {
      console.error("[agent-comments-list] internal error:", (err as Error)?.message ?? err);
      return NextResponse.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
    }
  };

  const POST_COMMENTS = async (request: Request, taskId: string) => {
    try {
      const { response: authResponse, auth } = await authenticate(request);
      if (authResponse) return authResponse;
      if (!hasTaskScope(auth!.scopes, "comment")) {
        const err = forbidden('Agent token lacks "tasks:comment" scope.');
        return NextResponse.json(err.body, { status: err.status });
      }
      const rateLimitResponse = checkRateLimit(auth!.tokenId);
      if (rateLimitResponse) return rateLimitResponse;
      runTelemetry(auth!.tokenId);

      const parsed = await readBody(request);
      if (!parsed.ok) {
        return NextResponse.json(parsed.error.body, { status: parsed.error.status });
      }
      const rejected = rejectAuthorFields(parsed.body);
      if (rejected) return rejected;

      const clientRequestId = String(
        parsed.body.clientRequestId ??
          (parsed.body.source && parsed.body.sourceId
            ? `${String(parsed.body.source)}:${String(parsed.body.sourceId)}`
            : ""),
      ).trim();
      if (!clientRequestId) {
        const err = invalidRequest(
          'A "clientRequestId" (or source+sourceId pair) is required so retries cannot duplicate the comment.',
        );
        return NextResponse.json(err.body, { status: err.status });
      }

      const result = await createAgentTaskComment(identity(auth!), {
        taskId,
        body: String(parsed.body.body ?? ""),
        clientRequestId,
      });
      if (!result.ok) return failureResponse(result);

      const response: TaskCommentMutationResponse = {
        ok: true,
        comment: result.data,
      };
      return NextResponse.json(response, { status: 201 });
    } catch (err) {
      console.error("[agent-comments-create] internal error:", (err as Error)?.message ?? err);
      return NextResponse.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
    }
  };

  const PATCH_COMMENT = async (request: Request, taskId: string, commentId: string) => {
    void taskId;
    try {
      const { response: authResponse, auth } = await authenticate(request);
      if (authResponse) return authResponse;
      if (!hasTaskScope(auth!.scopes, "comment")) {
        const err = forbidden('Agent token lacks "tasks:comment" scope.');
        return NextResponse.json(err.body, { status: err.status });
      }
      const rateLimitResponse = checkRateLimit(auth!.tokenId);
      if (rateLimitResponse) return rateLimitResponse;
      runTelemetry(auth!.tokenId);

      const parsed = await readBody(request);
      if (!parsed.ok) {
        return NextResponse.json(parsed.error.body, { status: parsed.error.status });
      }
      const rejected = rejectAuthorFields(parsed.body);
      if (rejected) return rejected;

      const result = await updateAgentTaskComment(identity(auth!), {
        commentId,
        body: String(parsed.body.body ?? ""),
      });
      if (!result.ok) return failureResponse(result);

      const response: TaskCommentMutationResponse = {
        ok: true,
        comment: result.data,
      };
      return NextResponse.json(response, { status: 200 });
    } catch (err) {
      console.error("[agent-comments-update] internal error:", (err as Error)?.message ?? err);
      return NextResponse.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
    }
  };

  const DELETE_COMMENT = async (request: Request, taskId: string, commentId: string) => {
    void taskId;
    try {
      const { response: authResponse, auth } = await authenticate(request);
      if (authResponse) return authResponse;
      if (!hasTaskScope(auth!.scopes, "comment")) {
        const err = forbidden('Agent token lacks "tasks:comment" scope.');
        return NextResponse.json(err.body, { status: err.status });
      }
      const rateLimitResponse = checkRateLimit(auth!.tokenId);
      if (rateLimitResponse) return rateLimitResponse;
      runTelemetry(auth!.tokenId);

      const result = await deleteAgentTaskComment(identity(auth!), commentId);
      if (!result.ok) return failureResponse(result);

      const response: TaskCommentDeleteResponse = { ok: true, deleted: true };
      return NextResponse.json(response, { status: 200 });
    } catch (err) {
      console.error("[agent-comments-delete] internal error:", (err as Error)?.message ?? err);
      return NextResponse.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
    }
  };

  const POST_REACTION = async (request: Request, taskId: string, commentId: string) => {
    void taskId;
    try {
      const { response: authResponse, auth } = await authenticate(request);
      if (authResponse) return authResponse;
      if (!hasTaskScope(auth!.scopes, "comment")) {
        const err = forbidden('Agent token lacks "tasks:comment" scope.');
        return NextResponse.json(err.body, { status: err.status });
      }
      const rateLimitResponse = checkRateLimit(auth!.tokenId);
      if (rateLimitResponse) return rateLimitResponse;
      runTelemetry(auth!.tokenId);

      const parsed = await readBody(request);
      if (!parsed.ok) {
        return NextResponse.json(parsed.error.body, { status: parsed.error.status });
      }
      const rejected = rejectAuthorFields(parsed.body);
      if (rejected) return rejected;

      const result = await toggleAgentTaskCommentReaction(identity(auth!), {
        commentId,
        emoji: String(parsed.body.emoji ?? ""),
      });
      if (!result.ok) return failureResponse(result);

      const response: TaskCommentReactionResponse = {
        ok: true,
        reactions: result.data,
      };
      return NextResponse.json(response, { status: 200 });
    } catch (err) {
      console.error("[agent-comments-reaction] internal error:", (err as Error)?.message ?? err);
      return NextResponse.json(INTERNAL_ERROR_RESPONSE, { status: 500 });
    }
  };

  return {
    GET_COMMENTS,
    POST_COMMENTS,
    PATCH_COMMENT,
    DELETE_COMMENT,
    POST_REACTION,
  };
}
