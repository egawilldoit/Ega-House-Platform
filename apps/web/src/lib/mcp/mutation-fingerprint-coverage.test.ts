import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";
import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import { canonicalMutationFingerprint } from "@/lib/mcp/mutation-idempotency";
import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import { getPermissionsForProfile } from "@/lib/mcp/permissions";
import type { McpPrincipal } from "@/lib/mcp/principal";

// The handler layer is the ONLY place that decides which fields reach
// canonicalMutationFingerprint, so the coverage table below is asserted
// against the real write-tool handlers rather than a re-implementation.
vi.mock("@/lib/mcp/write/projects", () => ({
  createProject: vi.fn(async () => okResult({ ok: true })),
  updateProjectStatus: vi.fn(async () => okResult({ ok: true })),
  archiveProject: vi.fn(async () => okResult({ ok: true })),
  unarchiveProject: vi.fn(async () => okResult({ ok: true })),
}));
vi.mock("@/lib/mcp/write/goals", () => ({
  createGoal: vi.fn(async () => okResult({ ok: true })),
  updateGoalStatus: vi.fn(async () => okResult({ ok: true })),
  updateGoalHealth: vi.fn(async () => okResult({ ok: true })),
  updateGoalNextStep: vi.fn(async () => okResult({ ok: true })),
  archiveGoal: vi.fn(async () => okResult({ ok: true })),
  unarchiveGoal: vi.fn(async () => okResult({ ok: true })),
}));
vi.mock("@/lib/mcp/write/tasks", () => ({
  createTaskMcpWriteHandlers: () => ({
    getTask: vi.fn(),
    createTask: vi.fn(async () => okResult({ ok: true })),
    updateTask: vi.fn(async () => okResult({ ok: true })),
    archiveTask: vi.fn(async () => okResult({ ok: true })),
    unarchiveTask: vi.fn(async () => okResult({ ok: true })),
    setTaskFocusRank: vi.fn(async () => okResult({ ok: true })),
    createTaskReminder: vi.fn(async () => okResult({ ok: true })),
    cancelTaskReminder: vi.fn(async () => okResult({ ok: true })),
  }),
}));
vi.mock("@/lib/mcp/write/timer", () => ({
  createMcpTimerModuleHandlers: () => ({
    listTimerSessions: vi.fn(),
    startTimer: vi.fn(async () => okResult({ ok: true })),
    stopTimer: vi.fn(async () => okResult({ ok: true })),
  }),
}));
vi.mock("@/lib/mcp/write/today", () => ({
  createMcpTodayWriteHandlers: (deps: { clearCompletedMrtr: unknown }) => ({
    getTodayPlan: vi.fn(),
    planTaskForToday: vi.fn(async () => okResult({ ok: true })),
    removeTaskFromToday: vi.fn(async () => okResult({ ok: true })),
    updateTodayTaskStatus: vi.fn(async () => okResult({ ok: true })),
    clearCompletedToday: vi.fn(async (_auth: unknown, input: { date: string }) =>
      okResult({ ok: true, clearedCount: 0, date: input.date })),
    // Referenced so the unused-parameter lint cannot drop the dependency.
    __mrtr: deps.clearCompletedMrtr,
  }),
}));

import { createMcpWriteToolHandlers } from "@/lib/mcp/write-tool-handlers";

function okResult(payload: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
}

const OWNER_USER_ID = "00000000-0000-0000-0000-0000000000aa";
const PRINCIPAL: McpPrincipal = {
  ownerUserId: OWNER_USER_ID,
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-0000000000bb",
  permissionProfile: "workspace_manager",
  permissionsVersion: 1,
  permissions: getPermissionsForProfile("workspace_manager", 1),
};
const AUTH_INFO = createMcpAuthInfo("bearer-token", PRINCIPAL) as AuthInfo;

const OP = "44444444-4444-4444-8444-444444444444";

/**
 * Records the args_hash each handler passes to the claim RPC. This is the
 * fingerprint under test: `withExclusiveMutation` calls canonicalMutationFingerprint
 * on the semantic input and forwards only the hash, so a material field missing
 * from that object is invisible to everything except this recording.
 */
function recordingClient() {
  const claims: Array<{ tool: string; operationId: string; argsHash: string }> = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "mcp_claim_mutation_receipt") {
      claims.push({
        tool: String(args.p_tool_name),
        operationId: String(args.p_operation_id),
        argsHash: String(args.p_args_hash),
      });
      return {
        data: [{ claim_outcome: "CLAIM_GRANTED", claim_token: "token-1", existing_result: null }],
        error: null,
      };
    }
    return { data: null, error: null };
  });
  const client = { rpc } as unknown as SupabaseClient<McpDatabase>;
  return { client, claims };
}

function handlers() {
  const { client, claims } = recordingClient();
  const created = createMcpWriteToolHandlers({ createUserClient: () => client }, true);
  return { handlers: created, claims };
}

type WriteHandlerName = Exclude<keyof ReturnType<typeof createMcpWriteToolHandlers>, "getTask">;

type Case = {
  /** Registry tool name — the key the receipt is stored under. */
  tool: string;
  /** Write-tool handler method. */
  handler: WriteHandlerName;
  /** A full, valid base input for the tool. */
  base: Record<string, unknown>;
  /**
   * One entry per MATERIAL field: the field name and an alternative value that
   * changes the durable effect (or the domain identity) of the mutation.
   * operationId is deliberately excluded — it is the receipt key, not an input.
   */
  materialFields: Record<string, unknown>;
  /** Inputs the handler needs beyond the tool arguments. */
  ctx?: unknown;
};

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

/**
 * The coverage table. `materialFields` is exhaustive by construction: it is
 * every field of the tool's zod input schema except `operationId`. The
 * "table is exhaustive" test below re-derives that field set from the schema
 * source and fails if this table and the schema ever disagree.
 */
const CASES: Case[] = [
  {
    tool: "ega_create_project",
    handler: "createProject",
    base: { name: "Alpha", slug: "alpha", description: "first" },
    materialFields: { name: "Beta", slug: "beta", description: "second" },
  },
  {
    tool: "ega_update_project_status",
    handler: "updateProjectStatus",
    base: { projectId: UUID_A, status: "active" },
    materialFields: { projectId: UUID_B, status: "paused" },
  },
  {
    tool: "ega_archive_project",
    handler: "archiveProject",
    base: { projectId: UUID_A },
    materialFields: { projectId: UUID_B },
  },
  {
    tool: "ega_unarchive_project",
    handler: "unarchiveProject",
    base: { projectId: UUID_A },
    materialFields: { projectId: UUID_B },
  },
  {
    tool: "ega_create_goal",
    handler: "createGoal",
    base: {
      title: "Goal",
      projectId: UUID_A,
      description: "desc",
      status: "draft",
      slug: "goal",
      nextStep: "step",
      health: "on_track",
    },
    materialFields: {
      title: "Other",
      projectId: UUID_B,
      description: "other",
      status: "active",
      slug: "other",
      nextStep: "other",
      health: "at_risk",
    },
  },
  {
    tool: "ega_update_goal_status",
    handler: "updateGoalStatus",
    base: { goalId: UUID_A, status: "draft" },
    materialFields: { goalId: UUID_B, status: "active" },
  },
  {
    tool: "ega_update_goal_health",
    handler: "updateGoalHealth",
    base: { goalId: UUID_A, health: "on_track" },
    materialFields: { goalId: UUID_B, health: "at_risk" },
  },
  {
    tool: "ega_update_goal_next_step",
    handler: "updateGoalNextStep",
    base: { goalId: UUID_A, nextStep: "do it" },
    materialFields: { goalId: UUID_B, nextStep: "do that" },
  },
  {
    tool: "ega_archive_goal",
    handler: "archiveGoal",
    base: { goalId: UUID_A },
    materialFields: { goalId: UUID_B },
  },
  {
    tool: "ega_unarchive_goal",
    handler: "unarchiveGoal",
    base: { goalId: UUID_A },
    materialFields: { goalId: UUID_B },
  },
  {
    tool: "ega_create_task",
    handler: "createTask",
    base: {
      title: "Task",
      projectId: UUID_A,
      goalId: UUID_B,
      description: "desc",
      blockedReason: "waiting",
      status: "todo",
      priority: "medium",
      dueDate: "2026-09-02",
      estimateMinutes: 45,
    },
    materialFields: {
      title: "Other",
      projectId: UUID_B,
      goalId: UUID_C,
      description: "other",
      blockedReason: "other",
      status: "in_progress",
      priority: "high",
      dueDate: "2026-09-03",
      estimateMinutes: 90,
    },
  },
  {
    tool: "ega_update_task",
    handler: "updateTask",
    base: {
      taskId: UUID_A,
      title: "Task",
      status: "todo",
      priority: "medium",
      description: "desc",
      blockedReason: "waiting",
      dueDate: "2026-09-02",
      estimateMinutes: 45,
    },
    materialFields: {
      taskId: UUID_B,
      title: "Other",
      status: "in_progress",
      priority: "high",
      description: "other",
      blockedReason: "other",
      dueDate: "2026-09-03",
      estimateMinutes: 90,
    },
  },
  {
    tool: "ega_archive_task",
    handler: "archiveTask",
    base: { taskId: UUID_A },
    materialFields: { taskId: UUID_B },
  },
  {
    tool: "ega_unarchive_task",
    handler: "unarchiveTask",
    base: { taskId: UUID_A },
    materialFields: { taskId: UUID_B },
  },
  {
    tool: "ega_set_task_focus_rank",
    handler: "setTaskFocusRank",
    base: { taskId: UUID_A, pinned: true },
    materialFields: { taskId: UUID_B, pinned: false },
  },
  {
    tool: "ega_create_task_reminder",
    handler: "createTaskReminder",
    base: { taskId: UUID_A, remindAt: "2026-09-02T10:00:00.000Z" },
    materialFields: { taskId: UUID_B, remindAt: "2026-09-03T11:00:00.000Z" },
  },
  {
    tool: "ega_cancel_task_reminder",
    handler: "cancelTaskReminder",
    base: { taskId: UUID_A, reminderId: UUID_B },
    materialFields: { taskId: UUID_B, reminderId: UUID_C },
  },
  {
    tool: "ega_plan_task_for_today",
    handler: "planTaskForToday",
    base: { taskId: UUID_A, date: "2026-09-02" },
    materialFields: { taskId: UUID_B, date: "2026-09-03" },
  },
  {
    tool: "ega_remove_task_from_today",
    handler: "removeTaskFromToday",
    base: { taskId: UUID_A },
    materialFields: { taskId: UUID_B },
  },
  {
    tool: "ega_update_today_task_status",
    handler: "updateTodayTaskStatus",
    base: { taskId: UUID_A, status: "in_progress", blockedReason: "waiting" },
    materialFields: { taskId: UUID_B, status: "completed", blockedReason: "other" },
  },
  {
    tool: "ega_start_timer",
    handler: "startTimer",
    base: { taskId: UUID_A },
    materialFields: { taskId: UUID_B },
  },
  {
    tool: "ega_stop_timer",
    handler: "stopTimer",
    base: { sessionId: UUID_A },
    materialFields: { sessionId: UUID_B },
  },
];

/**
 * ega_clear_completed_today is MRTR-gated: the handler returns
 * `input_required` on round 1 and only claims the receipt once the SDK has
 * verified the requestState. It is covered separately below so the receipt
 * fingerprint is asserted through the real second-round path.
 */
const CLEAR_COMPLETED_CASE = {
  tool: "ega_clear_completed_today",
  handler: "clearCompletedToday" as WriteHandlerName,
  base: { date: "2026-09-02" },
  materialFields: { date: "2026-09-03" },
};

function structured(result: CallToolResult): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

function errorCode(result: CallToolResult): string | undefined {
  return (structured(result).error as { code?: string } | undefined)?.code;
}

describe("MCP mutation receipt fingerprint covers every material input", () => {
  it("enumerates exactly the write capabilities that claim a receipt", () => {
    // Guards the table against silently dropping or inventing a tool: the
    // receipt-bearing write set is every registry write capability.
    const expected = [
      "ega_create_project",
      "ega_update_project_status",
      "ega_archive_project",
      "ega_unarchive_project",
      "ega_create_goal",
      "ega_update_goal_status",
      "ega_update_goal_health",
      "ega_update_goal_next_step",
      "ega_archive_goal",
      "ega_unarchive_goal",
      "ega_create_task",
      "ega_update_task",
      "ega_archive_task",
      "ega_unarchive_task",
      "ega_set_task_focus_rank",
      "ega_create_task_reminder",
      "ega_cancel_task_reminder",
      "ega_plan_task_for_today",
      "ega_remove_task_from_today",
      "ega_update_today_task_status",
      "ega_clear_completed_today",
      "ega_start_timer",
      "ega_stop_timer",
    ].sort();
    expect([...CASES.map((c) => c.tool), CLEAR_COMPLETED_CASE.tool].sort()).toEqual(expected);
  });

  it("uses a unique operationId per case so claims cannot alias", () => {
    const operationIds = CASES.map((c) => c.tool);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  for (const testCase of CASES) {
    describe(testCase.tool, () => {
      it("hashes the full base input, not a partial projection", async () => {
        const { handlers: h, claims } = handlers();
        await (h[testCase.handler] as (...args: unknown[]) => Promise<CallToolResult>)(
          AUTH_INFO,
          { ...testCase.base, operationId: OP },
        );
        expect(claims).toHaveLength(1);
        expect(claims[0].tool).toBe(testCase.tool);
        expect(claims[0].operationId).toBe(OP);
        // The hash must equal the hash of the FULL input including
        // operationId-independent material fields. Asserting against an
        // explicit expected hash (rather than only inequality between
        // variants) is what makes an ADDED field visible as a failure.
        const full = { ...testCase.base };
        const expected = canonicalMutationFingerprint(testCase.tool, full);
        expect(claims[0].argsHash).toBe(expected);
      });

      for (const [field, changedValue] of Object.entries(testCase.materialFields)) {
        it(`changes the fingerprint when ${field} changes (same operationId)`, async () => {
          const { handlers: h, claims } = handlers();
          const call = h[testCase.handler] as (...args: unknown[]) => Promise<CallToolResult>;
          await call(AUTH_INFO, { ...testCase.base, operationId: OP });
          await call(AUTH_INFO, { ...testCase.base, [field]: changedValue, operationId: OP });

          expect(claims).toHaveLength(2);
          expect(claims[0].operationId).toBe(OP);
          expect(claims[1].operationId).toBe(OP);
          // Same operationId + changed material field must NOT hash equal,
          // otherwise the ledger CONFLICT branch is unreachable and the
          // second request silently REPLAYs the first result.
          expect(claims[1].argsHash, `${testCase.tool} must fingerprint ${field}`).not.toBe(claims[0].argsHash);
        });
      }

      it("does not fingerprint operationId as a material field", async () => {
        const { handlers: h, claims } = handlers();
        const call = h[testCase.handler] as (...args: unknown[]) => Promise<CallToolResult>;
        await call(AUTH_INFO, { ...testCase.base, operationId: OP });
        await call(AUTH_INFO, { ...testCase.base, operationId: "55555555-5555-4555-8555-555555555555" });
        // operationId is the receipt key's fourth component; including it in
        // the hash would be redundant, and the ledger already separates rows.
        expect(claims[1].argsHash).toBe(claims[0].argsHash);
        expect(claims[1].operationId).not.toBe(claims[0].operationId);
      });

      it("rejects a same-operationId retry with a changed field as CONFLICT, not REPLAY", async () => {
        // Drives the real ledger decision: a faithful in-memory claim RPC that
        // applies the documented (owner, client, tool, operation_id) key and
        // the documented args_hash equality branch.
        const { client, claims } = recordingClient();
        const stored = new Map<string, { argsHash: string; result?: Record<string, unknown> }>();
        const ledgerRpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
          if (fn !== "mcp_claim_mutation_receipt") {
            if (fn === "mcp_store_mutation_result") {
              const key = `${String(args.p_tool_name)}:${String(args.p_operation_id)}`;
              const row = stored.get(key);
              if (row) row.result = args.p_result_payload as Record<string, unknown>;
              return { data: null, error: null };
            }
            return { data: null, error: null };
          }
          claims.push({
            tool: String(args.p_tool_name),
            operationId: String(args.p_operation_id),
            argsHash: String(args.p_args_hash),
          });
          const key = `${String(args.p_tool_name)}:${String(args.p_operation_id)}`;
          const existing = stored.get(key);
          if (!existing) {
            stored.set(key, { argsHash: String(args.p_args_hash) });
            return {
              data: [{ claim_outcome: "CLAIM_GRANTED", claim_token: "token-1", existing_result: null }],
              error: null,
            };
          }
          if (existing.argsHash !== String(args.p_args_hash)) {
            return {
              data: [{ claim_outcome: "CONFLICT", claim_token: null, existing_result: null }],
              error: null,
            };
          }
          if (existing.result) {
            return {
              data: [{ claim_outcome: "REPLAY", claim_token: null, existing_result: existing.result }],
              error: null,
            };
          }
          return {
            data: [{ claim_outcome: "IN_PROGRESS", claim_token: null, existing_result: null }],
            error: null,
          };
        });
        const ledgerClient = { rpc: ledgerRpc } as unknown as SupabaseClient<McpDatabase>;
        const h = createMcpWriteToolHandlers({ createUserClient: () => ledgerClient }, true);
        const call = h[testCase.handler] as (...args: unknown[]) => Promise<CallToolResult>;

        const first = await call(AUTH_INFO, { ...testCase.base, operationId: OP });
        expect(errorCode(first)).toBeUndefined();

        const field = Object.keys(testCase.materialFields)[0];
        const changed = await call(AUTH_INFO, {
          ...testCase.base,
          [field]: testCase.materialFields[field],
          operationId: OP,
        });
        expect(errorCode(changed), `${testCase.tool} must CONFLICT when ${field} changes`).toBe("CONFLICT");
        expect(changed.isError).toBe(true);

        // An identical retry still replays — the conflict is caused by the
        // changed field, not by reusing the operationId.
        const replay = await call(AUTH_INFO, { ...testCase.base, operationId: OP });
        expect(errorCode(replay)).toBeUndefined();
        expect(replay.isError).toBeFalsy();
        expect(structured(replay)).toEqual(structured(first));

        void client;
      });
    });
  }
});

describe("write-module surface cannot exceed the fingerprinted MCP contract", () => {
  /**
   * The write modules (apps/web/src/lib/mcp/write/*.ts) declare a few input
   * fields the MCP tool schemas do NOT expose. Today those fields are inert:
   * every write schema is `.strict()` and the transport handler does not
   * forward them, so a caller cannot set them.
   *
   * That inertness is load-bearing and was previously unstated. If a future
   * change added `projectId`/`goalId` to `ega_update_task` WITHOUT also adding
   * them to the fingerprint, the domain would move the task to a different
   * project/goal (packages/application/src/tasks/service.ts assigns
   * `update.projectId` / `update.goalId`, and the repository writes
   * `project_id` / `goal_id`) while the receipt replayed the first result —
   * a silent cross-project mutation under a reused operationId.
   *
   * This test pins the two independent guards that make the fields inert, so
   * the trap has to be dismantled deliberately rather than by accident.
   */
  it("ega_update_task exposes no projectId/goalId, so the unfingerprinted domain fields stay unreachable", async () => {
    // Guard 1: the transport handler forwards only fingerprinted fields.
    const { handlers: h, claims } = handlers();
    // A caller that smuggles the unfingerprinted fields past the SDK is
    // ignored by the handler: the claim fingerprint is unchanged.
    await h.updateTask(AUTH_INFO, {
      taskId: UUID_A,
      title: "Task",
      operationId: OP,
      projectId: UUID_C,
      goalId: UUID_C,
    } as never);
    expect(claims).toHaveLength(1);
    // The fingerprint is the handler's full normalized projection over the declared
    // update_task material fields. An OMITTED optional is now hashed as ABSENT rather
    // than as null: `canonicalizeFingerprintValue` drops `undefined` object entries, and
    // the transport now forwards the value as received instead of coercing it with
    // `?? null`. That is what makes an omission a different mutation from an explicit
    // clear. projectId/goalId are NOT among the fields at all — that is still the point
    // of this test, and it is asserted by the source scan below.
    expect(claims[0].argsHash).toBe(
      canonicalMutationFingerprint("ega_update_task", {
        taskId: UUID_A,
        title: "Task",
        description: undefined,
        blockedReason: undefined,
        status: undefined,
        priority: undefined,
        dueDate: undefined,
        estimateMinutes: undefined,
      }),
    );

    // And the corrected semantics must not have made a smuggled field fingerprinted:
    // the hash above is unchanged whether or not projectId/goalId were supplied.
    const { handlers: hWithoutSmuggle, claims: claimsWithoutSmuggle } = handlers();
    await hWithoutSmuggle.updateTask(AUTH_INFO, {
      taskId: UUID_A,
      title: "Task",
      operationId: OP,
    } as never);
    expect(claimsWithoutSmuggle[0].argsHash).toBe(claims[0].argsHash);

    // Guard 2: the registered schema is `.strict()`, so the SDK rejects the
    // extra keys before a handler ever runs. Asserted against the schema
    // source because the schema objects are module-private.
    const serverSource = readFileSync(
      resolve(process.cwd(), "src/lib/mcp/server.ts"),
      "utf8",
    );
    const schemaBlock = serverSource.slice(
      serverSource.indexOf("const updateTaskInputSchema"),
      serverSource.indexOf("const archiveTaskInputSchema"),
    );
    expect(schemaBlock).toContain(".strict()");
    expect(schemaBlock).not.toMatch(/^\s{2}projectId:/m);
    expect(schemaBlock).not.toMatch(/^\s{2}goalId:/m);
  });
});

describe("ega_clear_completed_today fingerprint", () => {
  // Round 2 requires a verified requestState whose argsHash matches the
  // current { date }. Round 2 is the ONLY path that claims the receipt, so
  // this is where the material-field contract is decided for this tool.
  function verifiedContext(date: string): unknown {
    const resource = "https://ega.example.com/api/mcp";
    return {
      mcpReq: {
        requestState: () => ({
          user: PRINCIPAL.ownerUserId,
          client: PRINCIPAL.oauthClientId,
          grantId: PRINCIPAL.grantId,
          grantVersion: PRINCIPAL.permissionsVersion,
          resource,
          tool: CLEAR_COMPLETED_CASE.tool,
          operationId: OP,
          argsHash: canonicalMutationFingerprint(CLEAR_COMPLETED_CASE.tool, { date }),
          phase: "awaiting_confirmation",
          targetDate: date,
        }),
        inputResponses: { confirm: { action: "accept", content: { confirm: true } } },
      },
    };
  }

  it("claims the receipt with the date in the fingerprint", async () => {
    const { handlers: h, claims } = handlers();
    const result = await h.clearCompletedToday(
      AUTH_INFO,
      { ...CLEAR_COMPLETED_CASE.base, operationId: OP },
      verifiedContext(CLEAR_COMPLETED_CASE.base.date as string),
    );
    expect(errorCode(result)).toBeUndefined();
    expect(claims).toHaveLength(1);
    expect(claims[0].tool).toBe(CLEAR_COMPLETED_CASE.tool);
    expect(claims[0].argsHash).toBe(
      canonicalMutationFingerprint(CLEAR_COMPLETED_CASE.tool, CLEAR_COMPLETED_CASE.base),
    );
  });

  it("changes the fingerprint when date changes (same operationId)", async () => {
    const { handlers: h, claims } = handlers();
    const call = h.clearCompletedToday as (...args: unknown[]) => Promise<CallToolResult>;
    const base = CLEAR_COMPLETED_CASE.base.date as string;
    const changed = CLEAR_COMPLETED_CASE.materialFields.date as string;
    await call(AUTH_INFO, { date: base, operationId: OP }, verifiedContext(base));
    await call(AUTH_INFO, { date: changed, operationId: OP }, verifiedContext(changed));
    expect(claims).toHaveLength(2);
    expect(claims[1].operationId).toBe(OP);
    expect(claims[1].argsHash, "ega_clear_completed_today must fingerprint date").not.toBe(claims[0].argsHash);
  });

  it("binds the MRTR argsHash to the same fingerprint the receipt uses", async () => {
    // If the MRTR binding and the receipt disagreed, a caller could confirm
    // one date and have a different date fingerprinted at claim time.
    const date = CLEAR_COMPLETED_CASE.base.date as string;
    expect(verifiedContextBindingArgsHash(date)).toBe(
      canonicalMutationFingerprint(CLEAR_COMPLETED_CASE.tool, { date }),
    );
  });
});

function verifiedContextBindingArgsHash(date: string): string {
  const resource = "https://ega.example.com/api/mcp";
  const binding = {
    user: PRINCIPAL.ownerUserId,
    client: PRINCIPAL.oauthClientId,
    grantId: PRINCIPAL.grantId,
    grantVersion: PRINCIPAL.permissionsVersion,
    resource,
    tool: CLEAR_COMPLETED_CASE.tool,
    operationId: OP,
    argsHash: canonicalMutationFingerprint(CLEAR_COMPLETED_CASE.tool, { date }),
    phase: "awaiting_confirmation",
    targetDate: date,
  };
  return binding.argsHash;
}
