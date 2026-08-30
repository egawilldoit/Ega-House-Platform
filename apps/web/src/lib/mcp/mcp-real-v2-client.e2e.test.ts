import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module-boundary fakes (test-boundary, transport stays REAL).
//
// `@ega/data-access` is replaced at the external persistence boundary while
// the REAL production transport stack and canonical `@ega/application`
// services run:
// runs: withEgaMcpAuth → createWebMcpHandler → SDK createMcpHandler →
// registerMcpTools registry → audited read/write handlers → tool handlers.
// The factory imports the LEAF module mcp-e2e-mocks.ts (never the harness —
// importing the harness here would re-enter the mocked module graph and
// deadlock ESM evaluation) and read the CURRENT in-memory store at call time,
// so every test gets isolated persistence over one mock module graph. The
// pre-provisioned symbols also keep the graph loadable once the lead integrates
// apps/web/src/lib/mcp/write/{projects,goals,tasks,today,timer}.ts.
// ---------------------------------------------------------------------------
vi.mock("@ega/data-access", async () => {
  const mocks = await import("./mcp-e2e-mocks");
  return {
    SupabaseProjectsRepository: mocks.FakeSupabaseProjectsRepository,
    SupabaseTasksRepository: mocks.FakeSupabaseTasksRepository,
    SupabaseGoalsRepository: mocks.FakeSupabaseGoalsRepository,
    SupabaseTodayReadPort: mocks.FakeSupabaseTodayReadPort,
    SupabaseTimeContextRepository: mocks.FakeSupabaseTimeContextRepository,
    SupabaseTimerSessionRepository: mocks.FakeSupabaseTimerSessionRepository,
  };
});

// The production request-state codec has no fallback (getRequestStateSecret
// throws McpRequestStateConfigurationError), so the MRTR round trip requires a
// 32+ byte secret to exist BEFORE the runtime is constructed.
process.env.MCP_REQUEST_STATE_SECRET ??= "mcp-e2e-request-state-secret-0123456789abcdef";

import {
  E2E_MCP_URL,
  OWNER_USER_IDS,
  connectEgaMcpClient,
  createEgaMcpClient,
  createMcpE2eRuntime,
  setCurrentE2eStore,
  type McpE2eRuntime,
} from "./mcp-e2e-harness";

let runtime: McpE2eRuntime;

beforeEach(() => {
  runtime = createMcpE2eRuntime();
});

afterEach(() => {
  setCurrentE2eStore(undefined);
});

function toolNames(tools: Array<{ name: string }>): string[] {
  return tools.map((tool) => tool.name);
}

function clearCompletedMutationCount(): number {
  return runtime.store.mutations.filter(
    (mutation) =>
      mutation.table === "tasks"
      && mutation.op === "update"
      && mutation.patch?.planned_for_date === null,
  ).length;
}

function seededTasks(): Array<Record<string, unknown>> {
  return runtime.store.tables.get("tasks") ?? [];
}

function textPayload(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("MCP tool result did not include a text payload.");
  return JSON.parse(text) as Record<string, unknown>;
}

describe("MCP v2 real client E2E over the production route", () => {
  it("read-only principal: real client negotiates, lists reads, and every write attempt is refused", async () => {
    runtime.store.seed("projects", {
      owner_user_id: OWNER_USER_IDS.readOnly,
      name: "Alpha",
      slug: "alpha",
      description: null,
    });

    const { client, transport, close } = await connectEgaMcpClient(runtime.runtime, "ro-token");
    try {
      expect(client.getProtocolEra()).toBe("modern");
      expect(client.getServerVersion()).toMatchObject({ name: "ega-house", version: "0.1.0" });
      expect(transport.sessionId).toBeUndefined();

      const { tools } = await client.listTools();
      const names = toolNames(tools);
      expect(names).toContain("ega_list_projects");
      expect(names).toContain("ega_get_today_plan");
      expect(names).toContain("ega_list_timer_sessions");

      // Per-tool registration: read_only must not be advertised any write tool,
      // so the refusal is the protocol-level "Tool not found" error.
      await expect(
        client.callTool({
          name: "ega_create_project",
          arguments: { name: "Nope", operationId: randomUUID() },
        }),
      ).rejects.toThrow(/not found/i);
      expect(runtime.store.tables.get("projects")).toHaveLength(1);

      const listed = await client.callTool({ name: "ega_list_projects", arguments: {} });
      expect(listed.structuredContent).toMatchObject({ ok: true, count: 1 });
      const projects = (listed.structuredContent as { projects: Array<{ name: string }> }).projects;
      expect(projects[0]?.name).toBe("Alpha");
    } finally {
      await close();
    }
  });

  it("read-only discovery contract: tools/list exposes no write tools", async () => {
    const { client, close } = await connectEgaMcpClient(runtime.runtime, "ro-token");
    try {
      const { tools } = await client.listTools();
      const names = toolNames(tools);
      expect(names).not.toContain("ega_create_project");
      expect(names).not.toContain("ega_clear_completed_today");
    } finally {
      await close();
    }
  });

  it("partial grant discovery exposes only permitted writes", async () => {
    runtime.store.seed("projects", {
      owner_user_id: OWNER_USER_IDS.taskManager,
      name: "TM Project",
      slug: "tm-project",
      description: null,
    });

    const { client, close } = await connectEgaMcpClient(runtime.runtime, "tm-token");
    try {
      const { tools } = await client.listTools();
      expect(toolNames(tools)).not.toContain("ega_create_project");
      expect(runtime.store.tables.get("projects")).toHaveLength(1);

      // The same principal CAN write tasks: grant-scoped enforcement, not a blanket block.
      const projectId = (runtime.store.tables.get("projects") ?? [])[0]?.id as string;
      const allowed = await client.callTool({
        name: "ega_create_task",
        arguments: { title: "TM Task", projectId, operationId: randomUUID() },
      });
      expect(allowed.structuredContent).toMatchObject({ ok: true });
      expect(seededTasks()).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("workspace manager: real client performs project, task, today, and timer writes", async () => {
    const { client, close } = await connectEgaMcpClient(runtime.runtime, "wm-token");
    try {
      const { tools } = await client.listTools();
      const names = toolNames(tools);
      for (const writeTool of [
        "ega_create_project",
        "ega_create_task",
        "ega_plan_task_for_today",
        "ega_start_timer",
        "ega_stop_timer",
        "ega_clear_completed_today",
      ]) {
        expect(names).toContain(writeTool);
      }

      const created = await client.callTool({
        name: "ega_create_project",
        arguments: { name: "E2E Project", operationId: randomUUID() },
      });
      expect(created.structuredContent).toMatchObject({ ok: true });
      const project = (created.structuredContent as { project: { id: string; slug: string } }).project;
      expect(project.slug).toBe("e2e-project");

      const task = await client.callTool({
        name: "ega_create_task",
        arguments: { title: "Write E2E", projectId: project.id, operationId: randomUUID() },
      });
      expect(task.structuredContent).toMatchObject({ ok: true });
      const taskId = (task.structuredContent as { task: { id: string } }).task.id;
      expect(seededTasks()).toHaveLength(1);

      const planned = await client.callTool({
        name: "ega_plan_task_for_today",
        arguments: { taskId, date: "2026-08-28", operationId: randomUUID() },
      });
      expect(planned.structuredContent).toMatchObject({ ok: true });
      expect(seededTasks()[0]?.planned_for_date).toBe("2026-08-28");

      const started = await client.callTool({
        name: "ega_start_timer",
        arguments: { taskId, operationId: randomUUID() },
      });
      expect(started.structuredContent).toMatchObject({ ok: true });
      const sessionId = (started.structuredContent as { session: { id: string } }).session.id;

      const stopped = await client.callTool({
        name: "ega_stop_timer",
        arguments: { sessionId, operationId: randomUUID() },
      });
      expect(stopped.structuredContent).toMatchObject({ ok: true });
      const sessions = runtime.store.tables.get("task_sessions") ?? [];
      expect(sessions[0]?.ended_at).not.toBeNull();
      expect(sessions[0]?.duration_seconds).toBeGreaterThanOrEqual(0);
    } finally {
      await close();
    }
  });

  it("MRTR accept: input_required → elicitation → retry echoes requestState → single mutation", async () => {
    runtime.store.seed("tasks", {
      owner_user_id: OWNER_USER_IDS.workspaceManager,
      title: "Done A",
      status: "completed",
      planned_for_date: "2026-08-28",
    });
    runtime.store.seed("tasks", {
      owner_user_id: OWNER_USER_IDS.workspaceManager,
      title: "Done B",
      status: "completed",
      planned_for_date: "2026-08-28",
    });

    const { client, elicitationLog, close } = await connectEgaMcpClient(runtime.runtime, "wm-token", {
      elicitationAction: "accept",
    });
    try {
      const operationId = randomUUID();
      const result = await client.callTool({
        name: "ega_clear_completed_today",
        arguments: { date: "2026-08-28", operationId },
      });

      expect(result.isError).toBeFalsy();
      expect(textPayload(result)).toMatchObject({ ok: true, clearedCount: 2 });
      // The SDK fulfilled exactly one embedded elicitation round.
      expect(elicitationLog.requests).toHaveLength(1);
      // Exactly ONE mutation round on tasks, covering both seeded rows.
      expect(clearCompletedMutationCount()).toBe(1);
      const rows = seededTasks();
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.planned_for_date).toBeNull();
      // Idempotency ledger: exactly one claim and one stored result for the operationId.
      const claims = runtime.store.rpcCalls.filter(
        (call) => call.fn === "mcp_claim_mutation_receipt" && call.args.p_operation_id === operationId,
      );
      expect(claims).toHaveLength(1);
      const ledgerEntry = runtime.store.ledger.get(`ega_clear_completed_today:${operationId}`);
      expect(ledgerEntry?.resultPayload).toMatchObject({ ok: true, clearedCount: 2 });
    } finally {
      await close();
    }
  });

  it("MRTR decline: elicitation refusal surfaces an error with zero mutations", async () => {
    runtime.store.seed("tasks", {
      owner_user_id: OWNER_USER_IDS.workspaceManager,
      title: "Done C",
      status: "completed",
      planned_for_date: "2026-08-28",
    });

    const { client, elicitationLog, close } = await connectEgaMcpClient(runtime.runtime, "wm-token", {
      elicitationAction: "decline",
    });
    try {
      const operationId = randomUUID();
      const result = await client.callTool({
        name: "ega_clear_completed_today",
        arguments: { date: "2026-08-28", operationId },
      });

      expect(elicitationLog.requests).toHaveLength(1);
      expect(textPayload(result)).not.toMatchObject({ clearedCount: 1 });
      expect(clearCompletedMutationCount()).toBe(0);
      for (const row of seededTasks()) expect(row.planned_for_date).toBe("2026-08-28");
      const stored = runtime.store.ledger.get(`ega_clear_completed_today:${operationId}`);
      expect(stored?.resultPayload).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("security: revoked token gets 403 from the auth wrapper and the real client cannot connect", async () => {
    const raw = await runtime.runtime.POST(
      new Request(E2E_MCP_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer revoked-token",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    );
    expect(raw.status).toBe(403);
    expect(raw.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    await expect(raw.json()).resolves.toMatchObject({ error: "insufficient_scope" });

    const { client, transport } = createEgaMcpClient(runtime.runtime, "revoked-token");
    await expect(client.connect(transport)).rejects.toThrow();
  });

  it("duplicate operationId: replay returns the stored result with a single effect; changed args conflict", async () => {
    const { client, close } = await connectEgaMcpClient(runtime.runtime, "wm-token");
    try {
      const operationId = randomUUID();
      const first = await client.callTool({
        name: "ega_create_project",
        arguments: { name: "Idempotent", operationId },
      });
      expect(first.structuredContent).toMatchObject({ ok: true });

      const second = await client.callTool({
        name: "ega_create_project",
        arguments: { name: "Idempotent", operationId },
      });
      expect(second.structuredContent).toEqual(first.structuredContent);
      expect(runtime.store.tables.get("projects")).toHaveLength(1);
      expect(runtime.store.mutations.filter((mutation) => mutation.table === "projects" && mutation.op === "insert")).toHaveLength(1);

      const conflict = await client.callTool({
        name: "ega_create_project",
        arguments: { name: "Different", operationId },
      });
      expect(conflict.isError).toBe(true);
      expect(conflict.structuredContent).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(runtime.store.tables.get("projects")).toHaveLength(1);
      expect(runtime.store.mutations.filter((mutation) => mutation.table === "projects" && mutation.op === "insert")).toHaveLength(1);
    } finally {
      await close();
    }
  });
});
