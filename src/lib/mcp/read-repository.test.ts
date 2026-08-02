import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  listMcpGoals,
  listMcpProjects,
  listMcpTasks,
} from "@/lib/mcp/read-repository";

const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";

function createQueryClient(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  const methods = ["select", "eq", "is", "order", "limit"] as const;

  for (const method of methods) {
    query[method] = vi.fn(() => query);
  }

  query.then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);

  const from = vi.fn(() => query);
  return {
    client: { from } as unknown as SupabaseClient<McpDatabase>,
    query,
    from,
  };
}

describe("MCP read repository", () => {
  it("lists owner-scoped projects with a bounded deterministic order", async () => {
    const mock = createQueryClient({
      data: [
        {
          id: "project-1",
          name: "EGA House",
          slug: "ega-house",
          description: null,
          status: "active",
          created_at: "2026-07-29T10:00:00Z",
          updated_at: "2026-07-29T11:00:00Z",
        },
      ],
      error: null,
    });

    await expect(
      listMcpProjects(mock.client, OWNER_USER_ID, 25),
    ).resolves.toEqual([
      {
        id: "project-1",
        name: "EGA House",
        slug: "ega-house",
        description: null,
        status: "active",
        createdAt: "2026-07-29T10:00:00Z",
        updatedAt: "2026-07-29T11:00:00Z",
      },
    ]);

    expect(mock.from).toHaveBeenCalledWith("projects");
    expect(mock.query.eq).toHaveBeenCalledWith("owner_user_id", OWNER_USER_ID);
    expect(mock.query.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(mock.query.order).toHaveBeenCalledWith("id", { ascending: false });
    expect(mock.query.limit).toHaveBeenCalledWith(25);
  });

  it("lists goals and applies an optional project filter", async () => {
    const mock = createQueryClient({
      data: [
        {
          id: "goal-1",
          project_id: "project-1",
          title: "Ship MCP",
          slug: "ship-mcp",
          description: null,
          next_step: "Finish read tools",
          health: "good",
          status: "active",
          created_at: "2026-07-29T10:00:00Z",
          updated_at: "2026-07-29T11:00:00Z",
        },
      ],
      error: null,
    });

    await expect(
      listMcpGoals(mock.client, OWNER_USER_ID, {
        projectId: "project-1",
        limit: 10,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "goal-1",
        projectId: "project-1",
        title: "Ship MCP",
      }),
    ]);

    expect(mock.query.eq).toHaveBeenCalledWith("project_id", "project-1");
    expect(mock.query.limit).toHaveBeenCalledWith(10);
  });

  it("lists tasks with filters and excludes archived tasks by default", async () => {
    const mock = createQueryClient({
      data: [
        {
          id: "task-1",
          project_id: "project-1",
          goal_id: "goal-1",
          title: "Build route",
          description: null,
          blocked_reason: null,
          status: "in_progress",
          priority: "high",
          estimate_minutes: 60,
          focus_rank: 1,
          due_date: "2026-07-30",
          planned_for_date: "2026-07-29",
          scheduled_start_at: null,
          scheduled_end_at: null,
          completed_at: null,
          archived_at: null,
          created_at: "2026-07-29T10:00:00Z",
          updated_at: "2026-07-29T11:00:00Z",
          projects: { name: "EGA House" },
          goals: { title: "Ship MCP" },
        },
      ],
      error: null,
    });

    await expect(
      listMcpTasks(mock.client, OWNER_USER_ID, {
        projectId: "project-1",
        goalId: "goal-1",
        status: "in_progress",
        priority: "high",
        limit: 20,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "task-1",
        projectName: "EGA House",
        goalTitle: "Ship MCP",
        estimateMinutes: 60,
      }),
    ]);

    expect(mock.query.eq).toHaveBeenCalledWith("project_id", "project-1");
    expect(mock.query.eq).toHaveBeenCalledWith("goal_id", "goal-1");
    expect(mock.query.eq).toHaveBeenCalledWith("status", "in_progress");
    expect(mock.query.eq).toHaveBeenCalledWith("priority", "high");
    expect(mock.query.is).toHaveBeenCalledWith("archived_at", null);
    expect(mock.query.limit).toHaveBeenCalledWith(20);
  });

  it("rejects limits outside 1 to 100 before querying", async () => {
    const mock = createQueryClient({ data: [], error: null });

    await expect(
      listMcpProjects(mock.client, OWNER_USER_ID, 101),
    ).rejects.toThrow("MCP list limit must be between 1 and 100.");
    expect(mock.from).not.toHaveBeenCalled();
  });

  it("redacts database failures", async () => {
    const mock = createQueryClient({
      data: null,
      error: { message: "sensitive database detail" },
    });

    await expect(
      listMcpProjects(mock.client, OWNER_USER_ID, 25),
    ).rejects.toThrow("Failed to load EGA projects.");
  });

  it("rejects malformed rows instead of returning partial data", async () => {
    const mock = createQueryClient({
      data: [{ id: "project-1", name: null }],
      error: null,
    });

    await expect(
      listMcpProjects(mock.client, OWNER_USER_ID, 25),
    ).rejects.toThrow("Invalid EGA project record.");
  });
});
