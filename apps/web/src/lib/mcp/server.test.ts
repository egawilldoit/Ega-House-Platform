import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod-v4";

import {
  registerMcpReadTools,
  registerMcpToolsForPrincipal,
  registerMcpWriteTools,
  type McpWriteToolHandlers,
} from "@/lib/mcp/server";
import { filterToolsByPermissions, getAllToolNames } from "@/lib/mcp/tool-discovery";

type Registration = {
  name: string;
  config: Record<string, unknown>;
  handler: (...args: unknown[]) => unknown;
};

function createFakeServer() {
  const registrations: Registration[] = [];
  return {
    registrations,
    server: {
      registerTool: vi.fn(
        (
          name: string,
          config: Record<string, unknown>,
          handler: (...args: unknown[]) => unknown,
        ) => {
          registrations.push({ name, config, handler });
        },
      ),
    } as unknown as McpServer,
  };
}

function createHandlers() {
  return {
    getCapabilities: vi.fn().mockResolvedValue({ content: [] }),
    listProjects: vi.fn().mockResolvedValue({ content: [] }),
    listGoals: vi.fn().mockResolvedValue({ content: [] }),
    listTasks: vi.fn().mockResolvedValue({ content: [] }),
    getTask: vi.fn().mockResolvedValue({ content: [] }),
    getTodayPlan: vi.fn().mockResolvedValue({ content: [] }),
    listTimerSessions: vi.fn().mockResolvedValue({ content: [] }),
    personalOpsSummary: vi.fn().mockResolvedValue({ content: [] }),
    personalOpsExpensesList: vi.fn().mockResolvedValue({ content: [] }),
    personalOpsCheckinGet: vi.fn().mockResolvedValue({ content: [] }),
    getMoneyExpense: vi.fn().mockResolvedValue({ content: [] }),
    listMoneyLedger: vi.fn().mockResolvedValue({ content: [] }),
    moneyState: vi.fn().mockResolvedValue({ content: [] }),
    moneyMovementList: vi.fn().mockResolvedValue({ content: [] }),
    moneyMovementGet: vi.fn().mockResolvedValue({ content: [] }),
    moneyBudgetGet: vi.fn().mockResolvedValue({ content: [] }),
    moneyCoffeeWindow: vi.fn().mockResolvedValue({ content: [] }),
    moneyCoffeeVisitList: vi.fn().mockResolvedValue({ content: [] }),
    moneyObligationsList: vi.fn().mockResolvedValue({ content: [] }),
    moneyObligationGet: vi.fn().mockResolvedValue({ content: [] }),
    moneyObligationTemplatesList: vi.fn().mockResolvedValue({ content: [] }),
  };
}

function getInputSchema(registration: Registration): z.ZodTypeAny {
  return registration.config.inputSchema as z.ZodTypeAny;
}

describe("registerMcpReadTools", () => {
  it("registers exactly the read tools including personal operations", () => {
    const fake = createFakeServer();

    registerMcpReadTools(fake.server, createHandlers());

    expect(fake.registrations.map(({ name }) => name)).toEqual([
      "ega_get_capabilities",
      "ega_list_projects",
      "ega_list_goals",
      "ega_list_tasks",
      "ega_get_task",
      "ega_get_today_plan",
      "ega_personal_ops_summary",
      "ega_personal_ops_expenses_list",
      "ega_personal_ops_checkin_get",
      "ega_money_get",
      "ega_money_ledger_list",
      "ega_money_state",
      "ega_money_movement_list",
      "ega_money_movement_get",
      "ega_money_budget_get",
      "ega_money_coffee_window",
      "ega_money_coffee_visits_list",
      "ega_money_obligations_list",
      "ega_money_obligation_get",
      "ega_money_obligation_templates_list",
      "ega_list_timer_sessions",
    ]);
  });

  it("marks every registered tool read-only, idempotent, and closed-world", () => {
    const fake = createFakeServer();
    registerMcpReadTools(fake.server, createHandlers());

    for (const registration of fake.registrations) {
      expect(registration.config.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it("uses strict schemas that reject unknown keys", () => {
    const fake = createFakeServer();
    registerMcpReadTools(fake.server, createHandlers());

    for (const registration of fake.registrations) {
      expect(
        getInputSchema(registration).safeParse({ unexpected: true }).success,
      ).toBe(false);
    }
  });

  it("uses a bounded integer limit for list tools", () => {
    const fake = createFakeServer();
    registerMcpReadTools(fake.server, createHandlers());

    for (const name of [
      "ega_list_projects",
      "ega_list_goals",
      "ega_list_tasks",
    ]) {
      const registration = fake.registrations.find((item) => item.name === name)!;
      const schema = getInputSchema(registration);

      expect(schema.safeParse({ limit: 25 }).success).toBe(true);
      expect(schema.safeParse({ limit: 0 }).success).toBe(false);
      expect(schema.safeParse({ limit: 101 }).success).toBe(false);
      expect(schema.safeParse({ limit: 1.5 }).success).toBe(false);
    }
  });

  it("exposes reachable Money ledger continuation and version-pinned edits", () => {
    const fake = createFakeServer();
    registerMcpReadTools(fake.server, createHandlers());
    registerMcpWriteTools(fake.server, {} as McpWriteToolHandlers);

    const ledger = fake.registrations.find(
      (item) => item.name === "ega_money_ledger_list",
    )!;
    const ledgerSchema = getInputSchema(ledger);
    expect(
      ledgerSchema.safeParse({ limit: 25, offset: 50 }).success,
    ).toBe(true);
    expect(ledgerSchema.safeParse({ offset: -1 }).success).toBe(false);
    expect(ledgerSchema.safeParse({ offset: 1_000_001 }).success).toBe(false);

    const update = fake.registrations.find(
      (item) => item.name === "ega_money_update_expense",
    )!;
    const updateSchema = getInputSchema(update);
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const operationId = "650e8400-e29b-41d4-a716-446655440000";
    expect(
      updateSchema.safeParse({
        expenseId: id,
        expectedVersion: 2,
        note: null,
        operationId,
      }).success,
    ).toBe(true);
    expect(
      updateSchema.safeParse({ expenseId: id, note: "x", operationId }).success,
    ).toBe(false);

    const remove = fake.registrations.find(
      (item) => item.name === "ega_money_delete_expense",
    )!;
    expect(
      getInputSchema(remove).safeParse({
        expenseId: id,
        expectedVersion: 2,
        operationId,
      }).success,
    ).toBe(true);
  });

  it("registers a non-colliding, kind-bounded MONEY-04 movement family", () => {
    const fake = createFakeServer();
    registerMcpReadTools(fake.server, createHandlers());
    registerMcpWriteTools(fake.server, {} as McpWriteToolHandlers);

    const names = fake.registrations.map(({ name }) => name);
    expect(names.filter((name) => name === "ega_money_state")).toHaveLength(1);
    expect(names.filter((name) => name === "ega_money_ledger_list")).toHaveLength(1);
    expect(names).toContain("ega_money_movement_list");
    expect(names).toContain("ega_money_movement_get");

    const movementList = fake.registrations.find(
      (item) => item.name === "ega_money_movement_list",
    )!;
    const listSchema = getInputSchema(movementList);
    expect(listSchema.safeParse({ kind: "income", limit: 10 }).success).toBe(true);
    expect(listSchema.safeParse({ kind: "transfer" }).success).toBe(false);

    const movementGet = fake.registrations.find(
      (item) => item.name === "ega_money_movement_get",
    )!;
    const getSchema = getInputSchema(movementGet);
    const movementId = "550e8400-e29b-41d4-a716-446655440001";
    expect(getSchema.safeParse({ movementId }).success).toBe(true);
    expect(getSchema.safeParse({}).success).toBe(false);

    const operationId = "650e8400-e29b-41d4-a716-446655440001";
    const create = fake.registrations.find(
      (item) => item.name === "ega_money_create_movement",
    )!;
    const createSchema = getInputSchema(create);
    expect(
      createSchema.safeParse({
        kind: "income",
        amountMinor: 20000,
        bookingDate: "2026-11-09",
        idempotencyKey: "income-1",
        operationId,
      }).success,
    ).toBe(true);
    // Opening cash stays owned by MONEY-03 period initialization.
    expect(
      createSchema.safeParse({
        kind: "opening",
        amountMinor: 50000,
        bookingDate: "2026-11-01",
        idempotencyKey: "opening-1",
        operationId,
      }).success,
    ).toBe(false);

    const update = fake.registrations.find(
      (item) => item.name === "ega_money_update_movement",
    )!;
    const updateSchema = getInputSchema(update);
    expect(
      updateSchema.safeParse({ movementId, version: 1, countsInDaily: false, operationId })
        .success,
    ).toBe(true);
    expect(updateSchema.safeParse({ movementId, operationId }).success).toBe(false);
  });

  it("validates UUID project and goal filters", () => {
    const fake = createFakeServer();
    registerMcpReadTools(fake.server, createHandlers());

    const goals = fake.registrations.find(
      (item) => item.name === "ega_list_goals",
    )!;
    const tasks = fake.registrations.find(
      (item) => item.name === "ega_list_tasks",
    )!;
    const uuid = "550e8400-e29b-41d4-a716-446655440000";

    expect(getInputSchema(goals).safeParse({ projectId: uuid }).success).toBe(true);
    expect(getInputSchema(goals).safeParse({ projectId: "project-1" }).success).toBe(false);
    expect(getInputSchema(tasks).safeParse({ goalId: uuid }).success).toBe(true);
    expect(getInputSchema(tasks).safeParse({ goalId: "goal-1" }).success).toBe(false);
  });

  it("keeps task relocation fields unavailable through the MCP update schema", () => {
    const fake = createFakeServer();
    registerMcpToolsForPrincipal(
      fake.server,
      createHandlers(),
      {} as McpWriteToolHandlers,
      new Set(["ega_update_task"]),
    );
    const updateTask = fake.registrations.find(
      (item) => item.name === "ega_update_task",
    )!;
    const schema = getInputSchema(updateTask);

    expect(schema.safeParse({
      taskId: "550e8400-e29b-41d4-a716-446655440000",
      operationId: "650e8400-e29b-41d4-a716-446655440000",
      projectId: "750e8400-e29b-41d4-a716-446655440000",
    }).success).toBe(false);
    expect(schema.safeParse({
      taskId: "550e8400-e29b-41d4-a716-446655440000",
      operationId: "650e8400-e29b-41d4-a716-446655440000",
      goalId: "750e8400-e29b-41d4-a716-446655440000",
    }).success).toBe(false);
  });

  it("registers every advertised read/write tool exactly once", () => {
    const fake = createFakeServer();
    const allowed = new Set(filterToolsByPermissions([
      "projects.read", "projects.create", "projects.update",
      "goals.read", "goals.create", "goals.update",
      "tasks.read", "tasks.create", "tasks.update",
      "today.read", "today.update", "timer.read", "timer.create", "timer.update",
      "personal_ops.read", "personal_ops.write",
    ], true));

    registerMcpToolsForPrincipal(
      fake.server,
      createHandlers(),
      {} as McpWriteToolHandlers,
      allowed,
    );

    expect(fake.registrations.map(({ name }) => name).sort()).toEqual(
      getAllToolNames().sort(),
    );
    expect(new Set(fake.registrations.map(({ name }) => name)).size).toBe(
      fake.registrations.length,
    );
  });

  it("accepts only canonical task status and priority filters", () => {
    const fake = createFakeServer();
    registerMcpReadTools(fake.server, createHandlers());
    const tasks = fake.registrations.find(
      (item) => item.name === "ega_list_tasks",
    )!;
    const schema = getInputSchema(tasks);

    expect(schema.safeParse({ status: "blocked", priority: "urgent" }).success).toBe(true);
    expect(schema.safeParse({ status: "complete" }).success).toBe(false);
    expect(schema.safeParse({ priority: "critical" }).success).toBe(false);
  });

  it("forwards request-local auth info, request ID, and validated arguments", async () => {
    const fake = createFakeServer();
    const handlers = createHandlers();
    registerMcpReadTools(fake.server, handlers);
    const authInfo = { token: "test-bearer", clientId: "hermes", scopes: [] };
    const context = { requestId: "mcp-request-1" };

    const projects = fake.registrations.find(
      (item) => item.name === "ega_list_projects",
    )!;
    await projects.handler({ limit: 10 }, { authInfo, ...context });
    expect(handlers.listProjects).toHaveBeenCalledWith(
      authInfo,
      { limit: 10 },
      context,
    );

    const capabilities = fake.registrations.find(
      (item) => item.name === "ega_get_capabilities",
    )!;
    await capabilities.handler({}, { authInfo, ...context });
    expect(handlers.getCapabilities).toHaveBeenCalledWith(authInfo, context);

    const task = fake.registrations.find(
      (item) => item.name === "ega_get_task",
    )!;
    await task.handler({ taskId: "550e8400-e29b-41d4-a716-446655440000" }, { authInfo, ...context });
    expect(handlers.getTask).toHaveBeenCalledWith(
      authInfo,
      { taskId: "550e8400-e29b-41d4-a716-446655440000" },
      context,
    );
  });
});
