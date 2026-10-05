import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPermissionsForProfile } from "@/lib/mcp/permissions";
import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { McpPrincipal } from "@/lib/mcp/principal";

/**
 * The class the canonical use case asserts is the ONLY thing that distinguishes a
 * transient dependency failure from a request the caller must fix. Nothing else
 * in the transport sees it, so this file drives the real write modules and the
 * real exclusive-execution wrapper and asserts the two observable consequences:
 *
 *   - the protocol error code the caller receives, and
 *   - `p_final` on mcp_fail_mutation_result.
 *
 * `p_final` is the decision that matters. `0058` makes a FAILED_FINAL receipt
 * REPLAY `result_payload`, so marking a dependency failure final freezes the
 * error and permanently burns that operationId: the retry under the same id can
 * never re-attempt. `p_final: false` leaves the receipt retryable.
 *
 * Each module is covered through its own advertised handler rather than through
 * a shared helper, because the defect was that the modules flattened
 * independently.
 */

vi.mock("@ega/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ega/application")>();
  return {
    ...actual,
    createTask: vi.fn(),
    updateProjectStatus: vi.fn(),
    updateGoalStatus: vi.fn(),
    planTaskForToday: vi.fn(),
    startTaskSession: vi.fn(),
  };
});

vi.mock("@ega/data-access", () => ({
  SupabaseTasksRepository: vi.fn(function SupabaseTasksRepository() { return {}; }),
  SupabaseTimeContextRepository: vi.fn(function SupabaseTimeContextRepository() { return {}; }),
  SupabaseTodayReadPort: vi.fn(function SupabaseTodayReadPort() { return {}; }),
  SupabaseTimerSessionRepository: vi.fn(function SupabaseTimerSessionRepository() { return {}; }),
  SupabaseProjectsRepository: vi.fn(function SupabaseProjectsRepository() { return {}; }),
  SupabaseGoalsRepository: vi.fn(function SupabaseGoalsRepository() { return {}; }),
}));

import {
  createTask,
  planTaskForToday,
  startTaskSession,
  updateGoalStatus,
  updateProjectStatus,
} from "@ega/application";

import { createMcpWriteToolHandlers } from "@/lib/mcp/write-tool-handlers";

const OWNER_USER_ID = "00000000-0000-0000-0000-0000000000aa";
const OPERATION_ID = "44444444-4444-4444-8444-444444444444";

const PRINCIPAL: McpPrincipal = {
  ownerUserId: OWNER_USER_ID,
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-0000000000bb",
  permissionProfile: "workspace_manager",
  permissionsVersion: 1,
  permissions: getPermissionsForProfile("workspace_manager", 1),
};
const AUTH_INFO = createMcpAuthInfo("bearer-token", PRINCIPAL) as AuthInfo;

const DEPENDENCY_MESSAGE = "Unable to reach EGA House right now.";
const VALIDATION_MESSAGE = "Task title is required.";

type FailRecord = { toolName: string; operationId: string; final: boolean };

/**
 * A ledger client that records the claim and the failure, and nothing else.
 * Claim is always granted so every case exercises exactly one mutation attempt.
 */
function recordingClient() {
  const failures: FailRecord[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "mcp_claim_mutation_receipt") {
      return {
        data: [{ claim_outcome: "CLAIM_GRANTED", claim_token: "token-1", existing_result: null }],
        error: null,
      };
    }
    if (fn === "mcp_fail_mutation_result") {
      failures.push({
        toolName: String(args.p_tool_name),
        operationId: String(args.p_operation_id),
        final: args.p_final as boolean,
      });
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });
  return {
    failures,
    client: { rpc } as unknown as SupabaseClient<McpDatabase>,
  };
}

function handlers() {
  const { client, failures } = recordingClient();
  return {
    failures,
    handlers: createMcpWriteToolHandlers({ createUserClient: () => client }, true),
  };
}

function errorCode(result: CallToolResult): string | undefined {
  const payload = result.structuredContent as { error?: { code?: string } } | undefined;
  return payload?.error?.code;
}

/**
 * One module, one advertised handler, one canonical use case. `invoke` drives the
 * real handler; `given` decides the outcome the mocked use case returns.
 */
type CanonicalFailure = { ok: false; errorMessage: string; code: string };

type ModuleCase = {
  module: string;
  tool: string;
  invoke: (
    handlers: ReturnType<typeof createMcpWriteToolHandlers>,
  ) => Promise<CallToolResult>;
  /** Installs the canonical outcome the module's use case will return. */
  given: (failure: CanonicalFailure) => void;
};

const CASES: ModuleCase[] = [
  {
    module: "tasks",
    tool: "ega_create_task",
    invoke: (h) => h.createTask(AUTH_INFO, { title: "T", projectId: "project-1", operationId: OPERATION_ID }),
    given: (failure) => vi.mocked(createTask).mockResolvedValue(failure as never),
  },
  {
    module: "projects",
    tool: "ega_update_project_status",
    invoke: (h) => h.updateProjectStatus(AUTH_INFO, { projectId: "project-1", status: "active", operationId: OPERATION_ID }),
    given: (failure) => vi.mocked(updateProjectStatus).mockResolvedValue(failure as never),
  },
  {
    module: "goals",
    tool: "ega_update_goal_status",
    invoke: (h) => h.updateGoalStatus(AUTH_INFO, { goalId: "goal-1", status: "active", operationId: OPERATION_ID }),
    given: (failure) => vi.mocked(updateGoalStatus).mockResolvedValue(failure as never),
  },
  {
    module: "today",
    tool: "ega_plan_task_for_today",
    invoke: (h) => h.planTaskForToday(AUTH_INFO, { taskId: "task-1", date: "2026-09-02", operationId: OPERATION_ID }),
    given: (failure) => vi.mocked(planTaskForToday).mockResolvedValue(failure as never),
  },
  {
    module: "timer",
    tool: "ega_start_timer",
    invoke: (h) => h.startTimer(AUTH_INFO, { taskId: "task-1", operationId: OPERATION_ID }),
    given: (failure) => vi.mocked(startTaskSession).mockResolvedValue(failure as never),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MCP write failure permanence follows the canonical class", () => {
  it("covers every advertised write module", () => {
    expect(CASES.map((testCase) => testCase.module).sort()).toEqual(
      ["goals", "projects", "tasks", "timer", "today"],
    );
  });

  for (const testCase of CASES) {
    describe(testCase.module, () => {
      it("leaves a dependency failure retryable and says so to the caller", async () => {
        // The class the canonical use case asserts for "the repository refused".
        testCase.given({ ok: false, errorMessage: DEPENDENCY_MESSAGE, code: "unknown" });
        const { handlers: h, failures } = handlers();

        const result = await testCase.invoke(h);

        expect(result.isError).toBe(true);
        expect(errorCode(result)).toBe("DEPENDENCY_UNAVAILABLE");
        expect(failures).toHaveLength(1);
        expect(failures[0]).toEqual({
          toolName: testCase.tool,
          operationId: OPERATION_ID,
          // FAILED_FINAL would make 0058 REPLAY the frozen error, so the retry
          // under this operationId could never reach the mutation again.
          final: false,
        });
      });

      it("marks a validation failure permanent so the retry cannot repeat it", async () => {
        testCase.given({ ok: false, errorMessage: VALIDATION_MESSAGE, code: "validation" });
        const { handlers: h, failures } = handlers();

        const result = await testCase.invoke(h);

        expect(result.isError).toBe(true);
        expect(errorCode(result)).toBe("INVALID_ARGUMENT");
        expect(failures).toHaveLength(1);
        expect(failures[0]?.final).toBe(true);
      });
    });
  }
});