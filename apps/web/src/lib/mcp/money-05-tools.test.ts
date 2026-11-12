import assert from "node:assert/strict";
import { test } from "vitest";

import { createMcpMoneyBudgetHandlers } from "@/lib/mcp/money/budget-handlers";
import { createMcpReadToolHandlers } from "@/lib/mcp/read-tool-handlers";
import { filterToolsByPermissions, getAllToolNames } from "@/lib/mcp/tool-discovery";
import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import { getPermissionsForProfile } from "@/lib/mcp/permissions";

const MONEY_READ_TOOLS = [
  "ega_money_budget_get",
  "ega_money_coffee_window",
  "ega_money_coffee_visits_list",
];
const MONEY_WRITE_TOOLS = [
  "ega_money_set_allocation",
  "ega_money_classify_expense",
  "ega_money_record_coffee_visit",
  "ega_money_delete_coffee_visit",
];

test("MONEY-05 tools are discoverable only with their explicit grants", () => {
  const all = getAllToolNames();
  for (const name of [...MONEY_READ_TOOLS, ...MONEY_WRITE_TOOLS]) {
    assert.ok(all.includes(name), `${name} must be registered`);
  }

  const reader = filterToolsByPermissions(
    ["today.read", "timer.read", "personal_ops.read"],
    true,
  );
  for (const name of MONEY_READ_TOOLS) assert.ok(reader.includes(name));
  for (const name of MONEY_WRITE_TOOLS) assert.ok(!reader.includes(name));

  const writer = filterToolsByPermissions(
    ["today.read", "timer.read", "personal_ops.read", "personal_ops.write"],
    true,
  );
  for (const name of MONEY_WRITE_TOOLS) assert.ok(writer.includes(name));

  const readOnly = filterToolsByPermissions(["projects.read", "tasks.read"], true);
  for (const name of [...MONEY_READ_TOOLS, ...MONEY_WRITE_TOOLS]) {
    assert.ok(!readOnly.includes(name));
  }

  const disabled = filterToolsByPermissions(
    ["today.read", "timer.read", "personal_ops.read", "personal_ops.write"],
    false,
  );
  for (const name of MONEY_WRITE_TOOLS) assert.ok(!disabled.includes(name));
});

test("money writes deny an unauthenticated caller before any persistence", async () => {
  const handlers = createMcpMoneyBudgetHandlers({
    createUserClient: () => {
      throw new Error("must not create a client for a denied caller");
    },
  });
  const result = await handlers.setMoneyAllocation(
    undefined,
    {
      periodStartDate: "2026-11-09",
      periodEndDate: "2026-11-30",
      version: 0,
      allocations: { coffee: 7_000 },
    },
    "00000000-0000-4000-8000-000000000010",
  );
  assert.equal(result.isError, true);
  const payload = result.structuredContent as {
    ok: boolean;
    error: { code: string };
  };
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "UNAUTHENTICATED");
});

test("money reads deny an unauthenticated caller", async () => {
  const handlers = createMcpReadToolHandlers({
    createUserClient: () => {
      throw new Error("must not create a client for a denied caller");
    },
    listProjects: async () => [],
    listGoals: async () => [],
    listTasks: async () => [],
  });
  const result = await handlers.moneyBudgetGet(undefined, {
    periodStartDate: "2026-11-09",
    periodEndDate: "2026-11-30",
  });
  assert.equal(result.isError, true);
  const payload = result.structuredContent as {
    ok: boolean;
    error: { code: string };
  };
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "UNAUTHENTICATED");
});

/**
 * Write-tool wrappers pass the whole MCP input (including operationId) to these
 * handlers at runtime. The strict domain parsers must never see that transport
 * field, or every authenticated mutation fails with INVALID_ARGUMENT.
 */
function emptySupabaseClient() {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.order = () => builder;
  builder.is = () => builder;
  builder.maybeSingle = async () => ({ data: null, error: null });
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  return { from: () => builder } as never;
}

test("money mutations strip the transport operationId before domain parsing", async () => {
  const authInfo = createMcpAuthInfo("mcp-token", {
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    oauthClientId: "chatgpt-client",
    grantId: "22222222-2222-4222-8222-222222222222",
    permissionProfile: "personal_operations_writer",
    permissionsVersion: 1,
    permissions: getPermissionsForProfile("personal_operations_writer"),
  });
  const handlers = createMcpMoneyBudgetHandlers({
    createUserClient: () => emptySupabaseClient(),
  });

  const allocation = await handlers.setMoneyAllocation(
    authInfo,
    {
      periodStartDate: "2026-11-09",
      periodEndDate: "2026-11-30",
      version: 0,
      allocations: { coffee: 7_000 },
      operationId: "00000000-0000-4000-8000-000000000010",
    } as never,
    "00000000-0000-4000-8000-000000000010",
  );
  const allocationError = allocation.structuredContent as {
    error?: { code: string };
  };
  assert.notEqual(allocationError.error?.code, "INVALID_ARGUMENT");

  const classify = await handlers.classifyMoneyExpense(
    authInfo,
    {
      expenseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      version: 1,
      category: "groceries",
      operationId: "00000000-0000-4000-8000-000000000011",
    } as never,
    "00000000-0000-4000-8000-000000000011",
  );
  const classifyError = classify.structuredContent as {
    error?: { code: string };
  };
  assert.notEqual(classifyError.error?.code, "INVALID_ARGUMENT");
});

test("recordCoffeeVisit strips operationId and reaches the canonical visit", async () => {
  const authInfo = createMcpAuthInfo("mcp-token", {
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    oauthClientId: "chatgpt-client",
    grantId: "22222222-2222-4222-8222-222222222222",
    permissionProfile: "personal_operations_writer",
    permissionsVersion: 1,
    permissions: getPermissionsForProfile("personal_operations_writer"),
  });
  const expenseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const visitId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const results: unknown[] = [
    { data: null, error: null }, // findByVisitKey
    {
      data: {
        id: expenseId,
        kind: "expense",
        direction: "out",
        occurred_at: "2026-11-09T09:00:00.000Z",
        booking_date: "2026-11-09",
        amount_minor: 2_500,
        currency: "MAD",
        category: "coffee",
        note: null,
        merchant: null,
        need_vs_want: "want",
        payment_method: "card",
        purpose: null,
        counts_in_daily: true,
        period_id: null,
        idempotency_key: "key-1",
        create_fingerprint: "a".repeat(64),
        version: 1,
        deleted_at: null,
        created_at: "2026-11-09T09:00:00.000Z",
        updated_at: "2026-11-09T09:00:00.000Z",
      },
      error: null,
    }, // expenses.get
    { data: visitId, error: null }, // rpc
    {
      data: {
        id: visitId,
        visit_key: "visit-1",
        visit_fingerprint: "b".repeat(64),
        local_date: "2026-11-09",
        timezone: "Africa/Casablanca",
        note: null,
        version: 1,
        created_at: "2026-11-09T09:00:00.000Z",
        updated_at: "2026-11-09T09:00:00.000Z",
        lines: [
          {
            expense_id: expenseId,
            expenses: {
              amount_minor: 2_500,
              category: "coffee",
              booking_date: "2026-11-09",
              deleted_at: null,
            },
          },
        ],
      },
      error: null,
    }, // getVisit
  ];
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    maybeSingle: async () => results.shift(),
  };
  const client = {
    from: () => builder,
    rpc: async () => results.shift(),
  } as never;
  const handlers = createMcpMoneyBudgetHandlers({ createUserClient: () => client });
  const result = await handlers.recordCoffeeVisit(
    authInfo,
    {
      visitKey: "visit-1",
      localDate: "2026-11-09",
      timezone: "Africa/Casablanca",
      expenseIds: [expenseId],
      operationId: "00000000-0000-4000-8000-000000000012",
    } as never,
    "00000000-0000-4000-8000-000000000012",
  );
  assert.equal(result.isError, undefined);
  const payload = result.structuredContent as {
    ok: boolean;
    visit: { id: string; lines: Array<{ expenseId: string }> };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.visit.id, visitId);
  assert.equal(payload.visit.lines[0]!.expenseId, expenseId);
});
