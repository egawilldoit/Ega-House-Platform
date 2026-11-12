import assert from "node:assert/strict";
import test from "node:test";

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

  const visit = await handlers.recordCoffeeVisit(
    authInfo,
    {
      visitKey: "visit-1",
      localDate: "2026-11-09",
      timezone: "Africa/Casablanca",
      expenseIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      operationId: "00000000-0000-4000-8000-000000000012",
    } as never,
    "00000000-0000-4000-8000-000000000012",
  );
  const visitError = visit.structuredContent as { error?: { code: string } };
  assert.notEqual(visitError.error?.code, "INVALID_ARGUMENT");
});
