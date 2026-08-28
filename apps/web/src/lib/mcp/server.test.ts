import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { registerMcpReadTools } from "@/lib/mcp/server";

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
    getTodayPlan: vi.fn().mockResolvedValue({ content: [] }),
    listTimerSessions: vi.fn().mockResolvedValue({ content: [] }),
  };
}

function getInputSchema(registration: Registration): z.ZodTypeAny {
  return registration.config.inputSchema as z.ZodTypeAny;
}

describe("registerMcpReadTools", () => {
  it("registers exactly the six read tools", () => {
    const fake = createFakeServer();

    registerMcpReadTools(fake.server, createHandlers());

    expect(fake.registrations.map(({ name }) => name)).toEqual([
      "ega_get_capabilities",
      "ega_list_projects",
      "ega_list_goals",
      "ega_list_tasks",
      "ega_get_today_plan",
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
  });
});
