import { describe, expect, it, vi } from "vitest";

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
    },
  };
}

function createHandlers() {
  return {
    getCapabilities: vi.fn().mockResolvedValue({ content: [] }),
    listProjects: vi.fn().mockResolvedValue({ content: [] }),
    listGoals: vi.fn().mockResolvedValue({ content: [] }),
    listTasks: vi.fn().mockResolvedValue({ content: [] }),
  };
}

describe("registerMcpReadTools", () => {
  it("registers exactly the four private-MVP read tools", () => {
    const fake = createFakeServer();

    registerMcpReadTools(fake.server, createHandlers());

    expect(fake.registrations.map(({ name }) => name)).toEqual([
      "ega_get_capabilities",
      "ega_list_projects",
      "ega_list_goals",
      "ega_list_tasks",
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

  it("uses a bounded integer limit for list tools", () => {
    const fake = createFakeServer();
    registerMcpReadTools(fake.server, createHandlers());

    for (const name of [
      "ega_list_projects",
      "ega_list_goals",
      "ega_list_tasks",
    ]) {
      const registration = fake.registrations.find((item) => item.name === name);
      const inputSchema = registration?.config.inputSchema as Record<
        string,
        { safeParse: (value: unknown) => { success: boolean } }
      >;

      expect(inputSchema.limit.safeParse(25).success).toBe(true);
      expect(inputSchema.limit.safeParse(0).success).toBe(false);
      expect(inputSchema.limit.safeParse(101).success).toBe(false);
      expect(inputSchema.limit.safeParse(1.5).success).toBe(false);
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
    const goalShape = goals.config.inputSchema as Record<
      string,
      { safeParse: (value: unknown) => { success: boolean } }
    >;
    const taskShape = tasks.config.inputSchema as Record<
      string,
      { safeParse: (value: unknown) => { success: boolean } }
    >;
    const uuid = "00000000-0000-0000-0000-000000000001";

    expect(goalShape.projectId.safeParse(uuid).success).toBe(true);
    expect(goalShape.projectId.safeParse("project-1").success).toBe(false);
    expect(taskShape.goalId.safeParse(uuid).success).toBe(true);
    expect(taskShape.goalId.safeParse("goal-1").success).toBe(false);
  });

  it("forwards request-local auth info and validated arguments", async () => {
    const fake = createFakeServer();
    const handlers = createHandlers();
    registerMcpReadTools(fake.server, handlers);
    const authInfo = { token: "test-bearer", clientId: "hermes", scopes: [] };

    const projects = fake.registrations.find(
      (item) => item.name === "ega_list_projects",
    )!;
    await projects.handler({ limit: 10 }, { authInfo });
    expect(handlers.listProjects).toHaveBeenCalledWith(authInfo, { limit: 10 });

    const capabilities = fake.registrations.find(
      (item) => item.name === "ega_get_capabilities",
    )!;
    await capabilities.handler({ authInfo });
    expect(handlers.getCapabilities).toHaveBeenCalledWith(authInfo);
  });
});
