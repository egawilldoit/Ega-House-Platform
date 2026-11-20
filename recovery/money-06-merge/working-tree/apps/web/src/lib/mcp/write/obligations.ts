import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createAuthenticatedActor,
  createObligation,
  createObligationTemplate,
  generateObligations,
  transitionObligation,
  updateObligation,
  updateObligationTemplate,
} from "@ega/application";
import { SupabaseObligationRepository } from "@ega/data-access";
import type {
  ExpenseCategory,
  ExpenseNeedVsWant,
} from "@ega/domain/expenses";
import type {
  ObligationCadence,
  ObligationKind,
  ObligationState,
  ObligationTemplateLifecycle,
} from "@ega/domain/obligations";
import type { MoneyPurpose } from "@ega/domain/money";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";

export type McpObligationWriteDeps = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
};

export type McpObligationCreateInput = Readonly<{
  kind: ObligationKind;
  description: string;
  amountMinor: number;
  dueDate: string;
  periodStart?: string;
  periodEnd?: string;
  templateId?: string | null;
  needVsWant?: ExpenseNeedVsWant | null;
  purpose?: MoneyPurpose | null;
  countsInDaily?: boolean | null;
  category?: ExpenseCategory | null;
  stateEffectiveDate: string;
  idempotencyKey: string;
}>;

export type McpObligationUpdateInput = Readonly<{
  obligationId: string;
  version: number;
  description?: string;
  amountMinor?: number;
  periodStart?: string;
  periodEnd?: string;
  dueDate?: string;
  needVsWant?: ExpenseNeedVsWant | null;
  purpose?: MoneyPurpose;
  countsInDaily?: boolean;
  category?: ExpenseCategory | null;
}>;

export type McpObligationTransitionInput = Readonly<{
  obligationId: string;
  version: number;
  to: ObligationState;
  effectiveDate: string;
  reason?: string | null;
}>;

export type McpObligationTemplateCreateInput = Readonly<{
  kind: ObligationKind;
  description: string;
  amountMinor: number;
  cadence: ObligationCadence;
  dueDayOfMonth?: number | null;
  dueWeekday?: number | null;
  startDate: string;
  endDate?: string | null;
  needVsWant?: ExpenseNeedVsWant | null;
  purpose?: MoneyPurpose | null;
  countsInDaily?: boolean | null;
  category?: ExpenseCategory | null;
  idempotencyKey: string;
}>;

export type McpObligationTemplateUpdateInput = Readonly<{
  templateId: string;
  version: number;
  description?: string;
  amountMinor?: number;
  cadence?: ObligationCadence;
  dueDayOfMonth?: number | null;
  dueWeekday?: number | null;
  startDate?: string;
  endDate?: string | null;
  needVsWant?: ExpenseNeedVsWant | null;
  purpose?: MoneyPurpose | null;
  countsInDaily?: boolean | null;
  category?: ExpenseCategory | null;
  lifecycle?: ObligationTemplateLifecycle;
}>;

type ToolPayload = {
  ok: boolean;
  error?: { code: string; message: string };
  [key: string]: unknown;
};

function resultFromPayload(payload: ToolPayload): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function errorResult(error: { code: string; message: string }): CallToolResult {
  return { ...resultFromPayload({ ok: false, error }), isError: true };
}

function invalidArgument(message: string): CallToolResult {
  return errorResult({ code: "INVALID_ARGUMENT", message });
}

/**
 * Map an application failure onto the MCP tool vocabulary without claiming a
 * write succeeded.
 */
function failure(code: string | undefined, message: string): CallToolResult {
  switch (code) {
    case "validation":
      return invalidArgument(message);
    case "notFound":
      return errorResult({ code: "NOT_FOUND", message });
    case "conflict":
      return errorResult({ code: "CONFLICT", message });
    case "forbidden":
      return errorResult({
        code: "PERMISSION_DENIED",
        message:
          "The stored grant does not allow changing Money obligations. Re-check the Money writer permission.",
      });
    default:
      return errorResult({
        code: "DEPENDENCY_UNAVAILABLE",
        message: "EGA House data is temporarily unavailable.",
      });
  }
}

/**
 * MONEY-06 MCP obligation tools. Reads and writes go through the same
 * application use cases as the app; no tool owns a second lifecycle or
 * calculation. Scheduling/cancelling never posts cash — only the atomic
 * MONEY-07 payment path can — so no tool here can mark an occurrence paid by
 * changing its status.
 */
export function createMcpObligationWriteHandlers(
  dependencies: McpObligationWriteDeps,
) {
  function context(authInfo: AuthInfo | undefined) {
    const principal = requireMcpPermission(authInfo, "personal_ops.write");
    if (!authInfo?.token) {
      throw new McpToolAuthorizationError(
        "UNAUTHENTICATED",
        "Authentication is required for this tool.",
      );
    }
    return {
      actor: createAuthenticatedActor(principal.ownerUserId),
      repository: new SupabaseObligationRepository(
        dependencies.createUserClient(authInfo.token) as never,
      ),
    };
  }

  return {
    async createObligation(
      authInfo: AuthInfo | undefined,
      input: McpObligationCreateInput,
      operationId: string,
    ): Promise<CallToolResult> {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { actor, repository } = context(authInfo);
        const result = await createObligation(actor, repository, {
          kind: input.kind,
          description: input.description,
          amountMinor: input.amountMinor,
          dueDate: input.dueDate,
          ...(input.periodStart !== undefined
            ? { periodStart: input.periodStart }
            : {}),
          ...(input.periodEnd !== undefined ? { periodEnd: input.periodEnd } : {}),
          ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
          ...(input.needVsWant !== undefined
            ? { needVsWant: input.needVsWant }
            : {}),
          ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
          ...(input.countsInDaily !== undefined
            ? { countsInDaily: input.countsInDaily }
            : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          stateEffectiveDate: input.stateEffectiveDate,
          idempotencyKey: input.idempotencyKey,
        });
        if (!result.ok) return failure(result.code, result.errorMessage);
        return resultFromPayload({
          ok: true,
          obligation: result.data.occurrence,
          replayed: result.data.replayed,
          operationId,
          cashEffect: "none",
          note: "A scheduled obligation is not a cash movement. Pay it through the atomic payment path.",
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return errorResult({ code: error.code, message: error.message });
        }
        return errorResult({
          code: "INTERNAL_ERROR",
          message: "The MCP tool could not complete the request.",
        });
      }
    },

    async updateObligation(
      authInfo: AuthInfo | undefined,
      input: McpObligationUpdateInput,
      operationId: string,
    ): Promise<CallToolResult> {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { actor, repository } = context(authInfo);
        const changes = {
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.amountMinor !== undefined
            ? { amountMinor: input.amountMinor }
            : {}),
          ...(input.periodStart !== undefined
            ? { periodStart: input.periodStart }
            : {}),
          ...(input.periodEnd !== undefined ? { periodEnd: input.periodEnd } : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
          ...(input.needVsWant !== undefined
            ? { needVsWant: input.needVsWant }
            : {}),
          ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
          ...(input.countsInDaily !== undefined
            ? { countsInDaily: input.countsInDaily }
            : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
        };
        const result = await updateObligation(
          actor,
          repository,
          input.obligationId,
          { version: input.version, ...changes },
        );
        if (!result.ok) return failure(result.code, result.errorMessage);
        return resultFromPayload({
          ok: true,
          obligation: result.data,
          operationId,
          cashEffect: "none",
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return errorResult({ code: error.code, message: error.message });
        }
        return errorResult({
          code: "INTERNAL_ERROR",
          message: "The MCP tool could not complete the request.",
        });
      }
    },

    async transitionObligation(
      authInfo: AuthInfo | undefined,
      input: McpObligationTransitionInput,
      operationId: string,
    ): Promise<CallToolResult> {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { actor, repository } = context(authInfo);
        const result = await transitionObligation(
          actor,
          repository,
          input.obligationId,
          {
            version: input.version,
            to: input.to,
            effectiveDate: input.effectiveDate,
            reason: input.reason ?? null,
          },
        );
        if (!result.ok) return failure(result.code, result.errorMessage);
        return resultFromPayload({
          ok: true,
          obligation: result.data,
          operationId,
          cashEffect: "none",
          note: "Cancelling or waiving is not a cash movement.",
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return errorResult({ code: error.code, message: error.message });
        }
        return errorResult({
          code: "INTERNAL_ERROR",
          message: "The MCP tool could not complete the request.",
        });
      }
    },

    async createObligationTemplate(
      authInfo: AuthInfo | undefined,
      input: McpObligationTemplateCreateInput,
      operationId: string,
    ): Promise<CallToolResult> {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { actor, repository } = context(authInfo);
        const result = await createObligationTemplate(actor, repository, {
          kind: input.kind,
          description: input.description,
          amountMinor: input.amountMinor,
          cadence: input.cadence,
          ...(input.dueDayOfMonth !== undefined
            ? { dueDayOfMonth: input.dueDayOfMonth }
            : {}),
          ...(input.dueWeekday !== undefined
            ? { dueWeekday: input.dueWeekday }
            : {}),
          startDate: input.startDate,
          ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
          needVsWant: input.needVsWant ?? null,
          purpose: input.purpose ?? null,
          countsInDaily: input.countsInDaily ?? null,
          category: input.category ?? null,
          idempotencyKey: input.idempotencyKey,
        });
        if (!result.ok) return failure(result.code, result.errorMessage);
        return resultFromPayload({
          ok: true,
          template: result.data,
          operationId,
          cashEffect: "none",
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return errorResult({ code: error.code, message: error.message });
        }
        return errorResult({
          code: "INTERNAL_ERROR",
          message: "The MCP tool could not complete the request.",
        });
      }
    },

    async updateObligationTemplate(
      authInfo: AuthInfo | undefined,
      input: McpObligationTemplateUpdateInput,
      operationId: string,
    ): Promise<CallToolResult> {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { actor, repository } = context(authInfo);
        const changes = {
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.amountMinor !== undefined
            ? { amountMinor: input.amountMinor }
            : {}),
          ...(input.cadence !== undefined ? { cadence: input.cadence } : {}),
          ...(input.dueDayOfMonth !== undefined
            ? { dueDayOfMonth: input.dueDayOfMonth }
            : {}),
          ...(input.dueWeekday !== undefined
            ? { dueWeekday: input.dueWeekday }
            : {}),
          ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
          ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
          ...(input.needVsWant !== undefined
            ? { needVsWant: input.needVsWant }
            : {}),
          ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
          ...(input.countsInDaily !== undefined
            ? { countsInDaily: input.countsInDaily }
            : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.lifecycle !== undefined ? { lifecycle: input.lifecycle } : {}),
        };
        const result = await updateObligationTemplate(
          actor,
          repository,
          input.templateId,
          { version: input.version, ...changes },
        );
        if (!result.ok) return failure(result.code, result.errorMessage);
        return resultFromPayload({
          ok: true,
          template: result.data,
          operationId,
          cashEffect: "none",
          note: "Editing a template does not rewrite previously generated occurrences.",
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return errorResult({ code: error.code, message: error.message });
        }
        return errorResult({
          code: "INTERNAL_ERROR",
          message: "The MCP tool could not complete the request.",
        });
      }
    },

    async generateObligations(
      authInfo: AuthInfo | undefined,
      input: { templateId: string; throughDate: string },
      operationId: string,
    ): Promise<CallToolResult> {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { actor, repository } = context(authInfo);
        const result = await generateObligations(actor, repository, input);
        if (!result.ok) return failure(result.code, result.errorMessage);
        return resultFromPayload({
          ok: true,
          templateId: result.data.templateId,
          throughDate: result.data.throughDate,
          created: result.data.created,
          existing: result.data.existing,
          occurrences: result.data.occurrences,
          truncated: result.data.truncated,
          operationId,
          cashEffect: "none",
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return errorResult({ code: error.code, message: error.message });
        }
        return errorResult({
          code: "INTERNAL_ERROR",
          message: "The MCP tool could not complete the request.",
        });
      }
    },
  };
}
