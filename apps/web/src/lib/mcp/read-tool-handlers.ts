import type { AuthInfo } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readPrincipalFromAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  listMcpGoals,
  listMcpProjects,
  listMcpTasks,
  type McpGoal,
  type McpGoalFilters,
  type McpProject,
  type McpTask,
  type McpTaskFilters,
} from "@/lib/mcp/read-repository";
import {
  getTaskReadModel,
  getTodayPlan as getTodayPlanFromApplication,
} from "@ega/application";
import { isIsoDate, isValidIANATimeZone } from "@ega/domain/time-context";
import {
  SupabaseTasksRepository,
  SupabaseTimeContextRepository,
  SupabaseTimerSessionRepository,
  SupabaseTodayReadPort,
} from "@ega/data-access";
import { createMcpMoneyHandlers } from "@/lib/mcp/money/handlers";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";

export type McpReadToolDependencies = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
  listProjects: typeof listMcpProjects;
  listGoals: typeof listMcpGoals;
  listTasks: typeof listMcpTasks;
  getTask?: (
    client: SupabaseClient<McpDatabase>,
    ownerUserId: string,
    taskId: string,
  ) => ReturnType<typeof getTaskReadModel>;
  getTodayPlan?: (client: SupabaseClient<McpDatabase>, ownerUserId: string, date: string) => Promise<unknown>;
  listTimerSessions?: (client: SupabaseClient<McpDatabase>, ownerUserId: string, limit: number) => Promise<unknown>;
  personalOpsSummary?: (
    client: SupabaseClient<McpDatabase>,
    ownerUserId: string,
    context: { date?: string; timezone?: string },
  ) => Promise<unknown>;
  personalOpsExpensesList?: (
    client: SupabaseClient<McpDatabase>,
    ownerUserId: string,
    query: { from?: string; to?: string; timezone?: string; limit?: number },
  ) => Promise<unknown>;
  personalOpsCheckinGet?: (
    client: SupabaseClient<McpDatabase>,
    ownerUserId: string,
    localDate: string,
    timezone: string,
  ) => Promise<unknown>;
};

const DEFAULT_DEPENDENCIES: McpReadToolDependencies = {
  createUserClient: () => {
    throw new Error("MCP user client dependency is not configured.");
  },
  listProjects: listMcpProjects,
  listGoals: listMcpGoals,
  listTasks: listMcpTasks,
  getTask: (client, ownerUserId, taskId) =>
    getTaskReadModel(
      { userId: ownerUserId },
      new SupabaseTasksRepository(client as never),
      taskId,
    ),
};

type ToolErrorCode =
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "INVALID_ARGUMENT"
  | "DEPENDENCY_UNAVAILABLE"
  | "INTERNAL_ERROR";

/** A caller-supplied date/timezone/identifier failure, not an outage. */
export class McpInvalidArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpInvalidArgumentError";
  }
}

type ToolErrorPayload = {
  ok: false;
  error: {
    code: ToolErrorCode;
    message: string;
  };
};

function resultFromPayload(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function errorResult(error: unknown): CallToolResult {
  let payload: ToolErrorPayload;

  if (error instanceof McpToolAuthorizationError) {
    payload = {
      ok: false,
      error: { code: error.code, message: error.message },
    };
  } else if (error instanceof McpInvalidArgumentError) {
    payload = {
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: error.message },
    };
  } else if (
    error instanceof Error
    && error.message.startsWith("Failed to load EGA ")
  ) {
    payload = {
      ok: false,
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "EGA House data is temporarily unavailable.",
      },
    };
  } else {
    payload = {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The MCP tool could not complete the request.",
      },
    };
  }

  return {
    ...resultFromPayload(payload as unknown as Record<string, unknown>),
    isError: true,
  };
}

function requirePrincipal(authInfo: AuthInfo | undefined) {
  if (!authInfo) {
    throw new McpToolAuthorizationError(
      "UNAUTHENTICATED",
      "Authentication is required for this tool.",
    );
  }

  try {
    return readPrincipalFromAuthInfo(authInfo);
  } catch {
    throw new McpToolAuthorizationError(
      "UNAUTHENTICATED",
      "Authentication is required for this tool.",
    );
  }
}

function createClient(
  dependencies: McpReadToolDependencies,
  authInfo: AuthInfo,
): SupabaseClient<McpDatabase> {
  return dependencies.createUserClient(authInfo.token);
}

export function createMcpReadToolHandlers(
  dependencies: McpReadToolDependencies = DEFAULT_DEPENDENCIES,
  writesEnabled = false,
) {
  const moneyHandlers = createMcpMoneyHandlers({
    createUserClient: (accessToken) => dependencies.createUserClient(accessToken),
  });

  return {
    async getCapabilities(
      authInfo: AuthInfo | undefined,
    ): Promise<CallToolResult> {
      try {
        const principal = requirePrincipal(authInfo);
        return resultFromPayload({
          ok: true,
          permissionProfile: principal.permissionProfile,
          permissionsVersion: principal.permissionsVersion,
          permissions: [...principal.permissions],
          writesEnabled,
        });
      } catch (error) {
        return errorResult(error);
      }
    },

    async listProjects(
      authInfo: AuthInfo | undefined,
      input: { limit?: number },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "projects.read");
        const projects: McpProject[] = await dependencies.listProjects(
          createClient(dependencies, authInfo!),
          principal.ownerUserId,
          input.limit,
        );
        return resultFromPayload({
          ok: true,
          projects,
          count: projects.length,
        });
      } catch (error) {
        return errorResult(error);
      }
    },

    async listGoals(
      authInfo: AuthInfo | undefined,
      input: McpGoalFilters,
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "goals.read");
        const goals: McpGoal[] = await dependencies.listGoals(
          createClient(dependencies, authInfo!),
          principal.ownerUserId,
          input,
        );
        return resultFromPayload({ ok: true, goals, count: goals.length });
      } catch (error) {
        return errorResult(error);
      }
    },

    async listTasks(
      authInfo: AuthInfo | undefined,
      input: McpTaskFilters,
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "tasks.read");
        const tasks: McpTask[] = await dependencies.listTasks(
          createClient(dependencies, authInfo!),
          principal.ownerUserId,
          input,
        );
        return resultFromPayload({ ok: true, tasks, count: tasks.length });
      } catch (error) {
        return errorResult(error);
      }
    },

    async getTask(
      authInfo: AuthInfo | undefined,
      input: { taskId: string },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "tasks.read");
        const result = await (dependencies.getTask ?? DEFAULT_DEPENDENCIES.getTask!)(
          createClient(dependencies, authInfo!),
          principal.ownerUserId,
          input.taskId,
        );
        if (!result.ok) {
          throw new Error("Failed to load EGA task.");
        }
        if (!result.data) {
          return {
            ...resultFromPayload({
              ok: false,
              error: { code: "NOT_FOUND", message: "Task not found." },
            }),
            isError: true,
          };
        }
        return resultFromPayload({ ok: true, task: result.data });
      } catch (error) {
        return errorResult(error);
      }
    },

    async getTodayPlan(
      authInfo: AuthInfo | undefined,
      input: { date?: string },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "today.read");
        const client = createClient(dependencies, authInfo!);
        const port = new SupabaseTodayReadPort(client as unknown as never);
        const result = await getTodayPlanFromApplication(
          { userId: principal.ownerUserId } as never,
          port as never,
          new SupabaseTimeContextRepository(client as never),
          { date: input.date },
        );
        if (!result.ok) {
          return resultFromPayload({
            ok: false,
            error: { code: "DEPENDENCY_UNAVAILABLE", message: "EGA House data is temporarily unavailable." },
          });
        }
        const plan = result.data as unknown as {
          date?: string;
          sections?: { planned?: unknown[]; inProgress?: unknown[]; blocked?: unknown[] };
          suggestions?: { pinned?: unknown[]; inProgress?: unknown[] };
          summary?: unknown;
          activeTimer?: unknown;
        };
        const planned = plan.sections?.planned ?? [];
        const inProgress = plan.sections?.inProgress ?? [];
        const blocked = plan.sections?.blocked ?? [];
        return resultFromPayload({
          ok: true,
          today: plan.date ?? input.date ?? new Date().toISOString().slice(0, 10),
          selectedCount: planned.length + inProgress.length + blocked.length,
          sections: plan.sections ?? { planned: [], inProgress: [], blocked: [] },
          suggestions: plan.suggestions ?? { pinned: [], inProgress: [] },
          summary: plan.summary ?? null,
          activeTimer: plan.activeTimer ?? null,
        });
      } catch (error) {
        return errorResult(error);
      }
    },

    async listTimerSessions(
      authInfo: AuthInfo | undefined,
      input: { limit?: number; includeClosed?: boolean },
    ): Promise<CallToolResult> {
      try {
        requireMcpPermission(authInfo, "timer.read");
        const principal = requirePrincipal(authInfo);
        const client = createClient(dependencies, authInfo!);
        const limit = input.limit ?? 25;
        const timerRepo = new SupabaseTimerSessionRepository(client as unknown as never);
        const actor = { userId: principal.ownerUserId } as unknown as never;
        const open = await timerRepo.listOpenSessions(actor as never);
        const recent = input.includeClosed ? await timerRepo.listRecentSessions(actor as never, { limit } as never) : { ok: true, value: [] } as unknown as { ok: boolean; value: unknown[] };
        const sessions = [...((open as unknown as { value?: unknown[] }).value ?? []), ...((recent as unknown as { value?: unknown[] }).value ?? [])].slice(0, limit);
        return resultFromPayload({ ok: true, sessions, count: sessions.length });
      } catch (error) {
        return errorResult(error);
      }
    },

    // Personal Operations read tools (PO-13, issue #358). Each tool is
    // fenced by the explicit personal_ops.read grant; old profiles and
    // tokens without that grant are denied without automatic upgrade.
    async personalOpsSummary(
      authInfo: AuthInfo | undefined,
      input: { date?: string; timezone?: string },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "personal_ops.read");
        const client = createClient(dependencies, authInfo!);
        const summary = await (dependencies.personalOpsSummary ?? defaultPersonalOpsSummary)(
          client,
          principal.ownerUserId,
          input ?? {},
        );
        return resultFromPayload({ ok: true, summary });
      } catch (error) {
        return errorResult(error);
      }
    },

    async personalOpsExpensesList(
      authInfo: AuthInfo | undefined,
      input: { from?: string; to?: string; timezone?: string; limit?: number },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "personal_ops.read");
        const client = createClient(dependencies, authInfo!);
        const data = await (dependencies.personalOpsExpensesList ?? defaultPersonalOpsExpensesList)(
          client,
          principal.ownerUserId,
          input ?? {},
        );
        return resultFromPayload({ ok: true, ...((data as Record<string, unknown>) ?? {}) });
      } catch (error) {
        return errorResult(error);
      }
    },

    async personalOpsCheckinGet(
      authInfo: AuthInfo | undefined,
      input: { localDate: string; timezone: string },
    ): Promise<CallToolResult> {
      try {
        const principal = requireMcpPermission(authInfo, "personal_ops.read");
        const client = createClient(dependencies, authInfo!);
        const data = await (dependencies.personalOpsCheckinGet ?? defaultPersonalOpsCheckinGet)(
          client,
          principal.ownerUserId,
          input.localDate,
          input.timezone,
        );
        return resultFromPayload({ ok: true, ...((data as Record<string, unknown>) ?? {}) });
      } catch (error) {
        return errorResult(error);
      }
    },

    async moneyState(
      authInfo: AuthInfo | undefined,
      input: { cutoff?: string; timezone?: string },
    ): Promise<CallToolResult> {
      return moneyHandlers.moneyState(authInfo, input ?? {});
    },

    async moneyLedgerList(
      authInfo: AuthInfo | undefined,
      input: {
        from?: string;
        to?: string;
        cutoff?: string;
        timezone?: string;
        kind?: string;
        limit?: number;
      },
    ): Promise<CallToolResult> {
      return moneyHandlers.moneyLedgerList(authInfo, input ?? {});
    },
  };
}

type PersonalOpsSnapshot = {
  date: string;
  timezone: string;
  summary: { trackedTodaySeconds: number; trackedTodayLabel: string };
};

type ExpenseSummaryLike =
  | {
      ok: true;
      data: {
        day: unknown;
        weekToDate: unknown;
        monthToDate: unknown;
        coffee: unknown;
      };
    }
  | { ok: false }
  | null;

/**
 * Compose the owner-resolved time snapshot with the canonical spending
 * summary. An unavailable/failed summary is reported as unavailable — never as
 * zero spending — while the time fields still return.
 */
export function composePersonalOpsSummary(
  snapshot: PersonalOpsSnapshot,
  expenseSummary: ExpenseSummaryLike,
) {
  const spending = expenseSummary?.ok
    ? {
        available: true as const,
        currency: "MAD" as const,
        localDate: snapshot.date,
        timezone: snapshot.timezone,
        note: "Recorded non-deleted expenses in integer MAD centimes; totals exclude deleted rows.",
        day: expenseSummary.data.day,
        weekToDate: expenseSummary.data.weekToDate,
        monthToDate: expenseSummary.data.monthToDate,
        // Coffee is the same-month category projection, beside — not inside —
        // the day/week windows. The name states the period explicitly.
        coffeeMonthToDate: expenseSummary.data.coffee,
      }
    : {
        available: false as const,
        currency: "MAD" as const,
        localDate: snapshot.date,
        timezone: snapshot.timezone,
        reason: "Recorded spending totals are temporarily unavailable.",
      };

  return {
    date: snapshot.date,
    timezone: snapshot.timezone,
    trackedTodaySeconds: snapshot.summary.trackedTodaySeconds,
    trackedTodayLabel: snapshot.summary.trackedTodayLabel,
    spending,
  };
}

export async function defaultPersonalOpsSummary(
  client: SupabaseClient<McpDatabase>,
  ownerUserId: string,
  context: { date?: string; timezone?: string },
) {
  // Validate caller-supplied context before the application call: the
  // snapshot use case reports these as a generic failure, which would be
  // misreported as a dependency outage.
  if (context.date !== undefined && !isIsoDate(context.date)) {
    throw new McpInvalidArgumentError(
      "date must be a real calendar date in YYYY-MM-DD form.",
    );
  }
  if (
    context.timezone !== undefined
    && !isValidIANATimeZone(context.timezone)
  ) {
    throw new McpInvalidArgumentError("timezone must be a valid IANA timezone.");
  }

  const { getExpenseSummary, getOperatorSnapshot } = await import("@ega/application");
  const {
    SupabaseExpenseRepository,
    SupabaseTimeContextRepository,
    SupabaseTodayReadPort,
  } = await import("@ega/data-access");
  const result = await getOperatorSnapshot(
    { userId: ownerUserId } as never,
    new SupabaseTodayReadPort(client as never),
    new SupabaseTimeContextRepository(client as never),
    { date: context.date, timezone: context.timezone },
  );
  if (!result.ok) {
    if (result.code === "validation") {
      throw new McpInvalidArgumentError(result.errorMessage);
    }
    throw new Error("Failed to load EGA personal operations summary.");
  }
  const snapshot = result.data as unknown as PersonalOpsSnapshot;

  // Canonical recorded-spending summary over the same owner-resolved date and
  // timezone. Analytics failure is reported as unavailable — never as zero
  // spending — while the time summary still returns.
  const actor = { userId: ownerUserId } as never;
  const expenseSummary = await getExpenseSummary(
    actor,
    new SupabaseExpenseRepository(client as never),
    { localDate: snapshot.date, timezone: snapshot.timezone },
  ).catch(() => null);

  return composePersonalOpsSummary(snapshot, expenseSummary);
}

async function defaultPersonalOpsExpensesList(
  client: SupabaseClient<McpDatabase>,
  ownerUserId: string,
  query: { from?: string; to?: string; timezone?: string; limit?: number },
) {
  const { listExpenses } = await import("@ega/application");
  const { SupabaseExpenseRepository } = await import("@ega/data-access");
  const result = await listExpenses(
    { userId: ownerUserId } as never,
    new SupabaseExpenseRepository(client as never),
    {
      from: query.from,
      to: query.to,
      limit: String(Math.min(Math.max(query.limit ?? 25, 1), 100)),
    },
    { timezone: query.timezone ?? null },
  );
  if (!result.ok) {
    if (result.code === "validation") {
      throw new McpInvalidArgumentError(result.errorMessage);
    }
    throw new Error("Failed to list EGA expenses.");
  }
  return { expenses: result.data.expenses, pagination: result.data.pagination };
}

async function defaultPersonalOpsCheckinGet(
  client: SupabaseClient<McpDatabase>,
  ownerUserId: string,
  localDate: string,
  timezone: string,
) {
  const { createDailyCheckinService } = await import("@ega/application");
  const { SupabaseDailyCheckinRepository } = await import("@ega/data-access");
  const service = createDailyCheckinService(new SupabaseDailyCheckinRepository(client as never));
  const result = await service.getDailyCheckin({ userId: ownerUserId } as never, localDate, timezone);
  if (!result.ok) {
    if (result.code === "validation") {
      throw new McpInvalidArgumentError(result.errorMessage);
    }
    throw new Error("Failed to load EGA check-in.");
  }
  return { localDate, checkin: result.data };
}
