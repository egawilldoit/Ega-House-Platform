import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createAuthenticatedActor,
  startTaskSession,
  stopTaskSession,
  TIMER_ALREADY_RUNNING_MESSAGE,
  TIMER_NO_OPEN_SESSION_MATCH_MESSAGE,
  TIMER_SESSION_NO_LONGER_RUNNING_MESSAGE,
  TIMER_TASK_UNAVAILABLE_MESSAGE,
  type TimerSessionRecord,
} from "@ega/application";
import { SupabaseTimerSessionRepository } from "@ega/data-access";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import { McpToolAuthorizationError, requireMcpPermission } from "@/lib/mcp/tool-authorization";

export type McpWriteModuleDeps = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
};

export type McpTimerListInput = Readonly<{ limit?: number; includeClosed?: boolean }>;

export type McpTimerStartInput = Readonly<{ taskId: string; operationId?: string }>;

export type McpTimerStopInput = Readonly<{ sessionId?: string; operationId?: string }>;

export type McpTimerModuleHandlers = {
  listTimerSessions(
    authInfo: AuthInfo | undefined,
    input?: McpTimerListInput,
  ): Promise<CallToolResult>;
  startTimer(authInfo: AuthInfo | undefined, input: McpTimerStartInput): Promise<CallToolResult>;
  stopTimer(authInfo: AuthInfo | undefined, input: McpTimerStopInput): Promise<CallToolResult>;
};

type ToolPayload = {
  ok: boolean;
  error?: { code: string; message: string };
  [key: string]: unknown;
};

const DEFAULT_SESSION_LIMIT = 25;
const MAX_SESSION_LIMIT = 200;
const DEPENDENCY_UNAVAILABLE_MESSAGE = "EGA House data is temporarily unavailable.";
const WRITES_DISABLED_SNIPPET = "writes are disabled";

function resultFromPayload(payload: ToolPayload): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function errorResult(error: { code: string; message: string }): CallToolResult {
  return {
    ...resultFromPayload({ ok: false, error }),
    isError: true,
  };
}

function isWritesDisabledError(error: unknown): error is Error {
  return error instanceof Error && error.message.includes(WRITES_DISABLED_SNIPPET);
}

/**
 * Map a canonical timer ApplicationResult failure onto a protocol error code
 * without duplicating the canonical wording. Unrecognized canonical business
 * failures (for example task eligibility rejections) surface verbatim.
 */
function mapCanonicalTimerFailure(errorMessage: string): { code: string; message: string } {
  if (
    errorMessage === TIMER_ALREADY_RUNNING_MESSAGE
    || errorMessage === TIMER_SESSION_NO_LONGER_RUNNING_MESSAGE
  ) {
    return { code: "CONFLICT", message: errorMessage };
  }
  if (
    errorMessage === TIMER_TASK_UNAVAILABLE_MESSAGE
    || errorMessage === TIMER_NO_OPEN_SESSION_MATCH_MESSAGE
  ) {
    return { code: "NOT_FOUND", message: errorMessage };
  }
  if (errorMessage.startsWith("Unable to ")) {
    return { code: "DEPENDENCY_UNAVAILABLE", message: DEPENDENCY_UNAVAILABLE_MESSAGE };
  }
  return { code: "INVALID_ARGUMENT", message: errorMessage };
}

function mapModuleError(error: unknown): CallToolResult {
  if (error instanceof McpToolAuthorizationError) {
    return errorResult({ code: error.code, message: error.message });
  }
  if (isWritesDisabledError(error)) {
    return errorResult({ code: "WRITES_DISABLED", message: error.message });
  }
  return errorResult({ code: "INTERNAL_ERROR", message: "The MCP tool could not complete the request." });
}

function boundedSessionLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_SESSION_LIMIT, 1), MAX_SESSION_LIMIT);
}

export function createMcpTimerModuleHandlers(
  dependencies: McpWriteModuleDeps,
  writesEnabled = false,
): McpTimerModuleHandlers {
  const createClient = (authInfo: AuthInfo): SupabaseClient<McpDatabase> =>
    dependencies.createUserClient(authInfo.token);

  const assertWritesEnabled = () => {
    if (!writesEnabled) {
      throw new Error("MCP writes are disabled by server configuration (MCP_WRITES_ENABLED).");
    }
  };

  const createRepository = (authInfo: AuthInfo): SupabaseTimerSessionRepository =>
    new SupabaseTimerSessionRepository(createClient(authInfo));

  return {
    async listTimerSessions(authInfo, input = {}) {
      try {
        const principal = requireMcpPermission(authInfo, "timer.read");
        const actor = createAuthenticatedActor(principal.ownerUserId);
        const repository = createRepository(authInfo as AuthInfo);
        const limit = boundedSessionLimit(input.limit);

        const openResult = await repository.listOpenSessions(actor);
        if (!openResult.ok) {
          return errorResult({ code: "DEPENDENCY_UNAVAILABLE", message: DEPENDENCY_UNAVAILABLE_MESSAGE });
        }

        let recentSessions: TimerSessionRecord[] = [];
        if (input.includeClosed) {
          const recentResult = await repository.listRecentSessions(actor, { limit });
          if (!recentResult.ok) {
            return errorResult({ code: "DEPENDENCY_UNAVAILABLE", message: DEPENDENCY_UNAVAILABLE_MESSAGE });
          }
          recentSessions = recentResult.value;
        }

        const seenSessionIds = new Set<string>();
        const sessions: TimerSessionRecord[] = [];
        for (const session of [...openResult.value, ...recentSessions]) {
          if (seenSessionIds.has(session.id) || sessions.length >= limit) continue;
          seenSessionIds.add(session.id);
          sessions.push(session);
        }

        return resultFromPayload({ ok: true, sessions, count: sessions.length, limit });
      } catch (error) {
        return mapModuleError(error);
      }
    },

    async startTimer(authInfo, input) {
      try {
        assertWritesEnabled();
        const principal = requireMcpPermission(authInfo, "timer.create");
        const actor = createAuthenticatedActor(principal.ownerUserId);
        const repository = createRepository(authInfo as AuthInfo);

        const result = await startTaskSession(actor, repository, {
          taskId: input.taskId,
          ...(input.operationId
            ? { mcpOperationId: input.operationId, mcpClientId: principal.oauthClientId }
            : {}),
        });
        if (!result.ok) {
          return errorResult(mapCanonicalTimerFailure(result.errorMessage));
        }

        const { sessionId, taskId, startedAt, elapsedLabel, taskTitle } = result.data;
        return resultFromPayload({
          ok: true,
          session: { id: sessionId, taskId, startedAt, elapsedLabel, taskTitle },
        });
      } catch (error) {
        return mapModuleError(error);
      }
    },

    async stopTimer(authInfo, input) {
      try {
        assertWritesEnabled();
        const principal = requireMcpPermission(authInfo, "timer.update");
        const actor = createAuthenticatedActor(principal.ownerUserId);
        const repository = createRepository(authInfo as AuthInfo);

        const result = await stopTaskSession(actor, repository, { sessionId: input.sessionId });
        if (!result.ok) {
          return errorResult(mapCanonicalTimerFailure(result.errorMessage));
        }

        return resultFromPayload({
          ok: true,
          session: { id: result.data.sessionId, taskId: result.data.taskId },
        });
      } catch (error) {
        return mapModuleError(error);
      }
    },
  };
}
