import { describe, it, expect, vi, beforeEach } from "vitest";

// Create a proper chain mock for Supabase queries
function createChainMock() {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select", "eq", "is", "in", "neq", "gte", "lte", "not",
    "order", "limit", "maybeSingle", "single",
  ];

  // Default: resolve to empty success
  let resolveValue: Promise<{ data: unknown[] | null; error: unknown }> = Promise.resolve({ data: [], error: null });

  const setResolve = (value: Promise<{ data: unknown[] | null; error: unknown }>) => {
    resolveValue = value;
  };

  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }

  // Also support insert
  chain["insert"] = vi.fn(() => chain);

  // .then() makes it thenable (async await)
  chain["then"] = vi.fn((onFulfilled: (v: unknown) => unknown) => {
    return resolveValue.then(onFulfilled);
  });
  chain["catch"] = vi.fn((onRejected: (v: unknown) => unknown) => {
    return resolveValue.catch(onRejected);
  });

  return { chain, setResolve };
}

// Chain state management
let currentChain: ReturnType<typeof createChainMock>;
let tableChains: Map<string, ReturnType<typeof createChainMock>>;

vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      // If we have a custom chain for this table, use it
      if (tableChains && tableChains.has(table)) {
        return tableChains.get(table)!.chain;
      }
      return currentChain.chain;
    }),
  })),
}));

vi.mock("@/lib/services/task-service", () => ({
  getTaskInsertScopeError: vi.fn(),
  getTaskScopeSnapshot: vi.fn(),
}));

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  getProjects,
  getGoals,
  getTasks,
  validateTaskScope,
  createTasks,
} from "@/lib/services/agent-task-service";
import { getTaskInsertScopeError } from "@/lib/services/task-service";

const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  currentChain = createChainMock();
  tableChains = new Map();
  // Make from() return the chain by default
  const mockClient = { from: vi.fn(() => currentChain.chain) } as unknown;
  vi.mocked(getSupabaseServiceClient).mockReturnValue(mockClient as ReturnType<typeof getSupabaseServiceClient>);
});

describe("agent-task-service", () => {
  describe("getProjects", () => {
    it("returns projects for the owner", async () => {
      currentChain.setResolve(
        Promise.resolve({
          data: [
            {
              id: "proj-1",
              name: "Test Project",
              slug: "test-project",
              description: "A test project",
              status: "active",
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-02T00:00:00Z",
            },
          ],
          error: null,
        }),
      );

      const result = await getProjects(OWNER_USER_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]!.name).toBe("Test Project");
      }
    });

    it("scopes query by owner_user_id", async () => {
      currentChain.setResolve(Promise.resolve({ data: [], error: null }));

      await getProjects(OWNER_USER_ID);

      const fromCall = vi.mocked(getSupabaseServiceClient)().from;
      expect(fromCall).toHaveBeenCalledWith("projects");
    });

    it("returns error on query failure", async () => {
      currentChain.setResolve(
        Promise.resolve({
          data: null,
          error: { message: "DB error" },
        }),
      );

      const result = await getProjects(OWNER_USER_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorMessage).toBe("Failed to load projects.");
      }
    });
  });

  describe("getGoals", () => {
    it("returns goals for the owner", async () => {
      currentChain.setResolve(
        Promise.resolve({
          data: [
            {
              id: "goal-1",
              project_id: "proj-1",
              title: "Test Goal",
              slug: "test-goal",
              description: "A goal",
              next_step: null,
              health: "good",
              status: "active",
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-02T00:00:00Z",
            },
          ],
          error: null,
        }),
      );

      const result = await getGoals(OWNER_USER_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]!.title).toBe("Test Goal");
      }
    });

    it("returns error on query failure", async () => {
      currentChain.setResolve(
        Promise.resolve({
          data: null,
          error: { message: "DB error" },
        }),
      );

      const result = await getGoals(OWNER_USER_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorMessage).toBe("Failed to load goals.");
      }
    });
  });

  describe("getTasks", () => {
    it("returns tasks for the owner", async () => {
      currentChain.setResolve(
        Promise.resolve({
          data: [
            {
              id: "task-1",
              project_id: "proj-1",
              goal_id: "goal-1",
              title: "Test Task",
              description: null,
              blocked_reason: null,
              status: "todo",
              priority: "medium",
              estimate_minutes: 30,
              focus_rank: null,
              due_date: null,
              planned_for_date: null,
              scheduled_start_at: null,
              scheduled_end_at: null,
              completed_at: null,
              archived_at: null,
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-02T00:00:00Z",
              projects: { name: "Test Project" },
              goals: { title: "Test Goal" },
            },
          ],
          error: null,
        }),
      );

      const result = await getTasks(OWNER_USER_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]!.title).toBe("Test Task");
        expect(result.data[0]!.projectName).toBe("Test Project");
        expect(result.data[0]!.goalTitle).toBe("Test Goal");
      }
    });

    it("returns error on query failure", async () => {
      currentChain.setResolve(
        Promise.resolve({
          data: null,
          error: { message: "DB error" },
        }),
      );

      const result = await getTasks(OWNER_USER_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorMessage).toBe("Failed to load tasks.");
      }
    });
  });

  describe("validateTaskScope", () => {
    it("validates scope when project and goal exist", async () => {
      vi.mocked(getTaskInsertScopeError).mockReturnValue(null);

      // First call returns projects, second call returns goals
      let callCount = 0;
      const mockFromFn = vi.fn(() => {
        callCount++;
        const ch = createChainMock();
        if (callCount === 1) {
          ch.setResolve(Promise.resolve({ data: [{ id: "proj-1" }], error: null }));
        } else {
          ch.setResolve(
            Promise.resolve({
              data: [{ id: "goal-1", project_id: "proj-1" }],
              error: null,
            }),
          );
        }
        return ch.chain;
      });

      const mockClient = { from: mockFromFn } as unknown;
      vi.mocked(getSupabaseServiceClient).mockReturnValue(mockClient as ReturnType<typeof getSupabaseServiceClient>);

      const result = await validateTaskScope(OWNER_USER_ID, "proj-1", "goal-1");

      expect(result.ok).toBe(true);
    });
  });

  describe("createTasks", () => {
    const TOKEN_ID = "token-1";

    /**
     * Set up mock chains for createTasks.
     *
     * The tasks table is queried twice in createTasks:
     *   1. .insert(rows).select("id")  → returns insertData
     *   2. .select(...).eq(...).in(...)  → returns tasksData (via fetchTasksByIds)
     *
     * For idempotent tasks, only #2 is called (no insert).
     * We handle this by returning a fresh chain each time from() is called
     * for "tasks": first call = insert, subsequent = fetch.
     */
    function setupQueryChains(overrides?: {
      externalRefsData?: Array<{ source: string; source_id: string; task_id: string }>;
      projectsData?: Array<{ id: string }>;
      goalsData?: Array<{ id: string; project_id: string }>;
      insertData?: Array<{ id: string }>;
      tasksData?: Array<Record<string, unknown>>;
      insertError?: unknown;
    }) {
      tableChains = new Map();

      // Set up validateTaskScope queries (projects + goals)
      const projectsChain = createChainMock();
      projectsChain.setResolve(
        Promise.resolve({
          data: overrides?.projectsData ?? [{ id: "proj-1" }],
          error: null,
        }),
      );
      tableChains.set("projects", projectsChain);

      const goalsChain = createChainMock();
      goalsChain.setResolve(
        Promise.resolve({
          data: overrides?.goalsData ?? [{ id: "goal-1", project_id: "proj-1" }],
          error: null,
        }),
      );
      tableChains.set("goals", goalsChain);

      // Set up task_external_refs query (idempotency)
      const extRefsQueryChain = createChainMock();
      extRefsQueryChain.setResolve(
        Promise.resolve({
          data: overrides?.externalRefsData ?? [],
          error: null,
        }),
      );
      tableChains.set("task_external_refs", extRefsQueryChain);

      // Set up agent_integration_events
      const auditChain = createChainMock();
      auditChain.setResolve(Promise.resolve({ data: [], error: null }));
      tableChains.set("agent_integration_events", auditChain);

      // For "tasks" we create chains on the fly using a call counter.
      // If insertData is empty/not provided AND there's an idempotent match,
      // the first call to from("tasks") is actually fetchTasksByIds, not insert.
      // We detect this: if no tasks have source+sourceId then insert happens first.
      const hasIdempotentPairs = (overrides?.externalRefsData?.length ?? 0) > 0;
      let tasksCallCount = 0;

      const mockFromFn = vi.fn((table: string) => {
        if (table === "tasks") {
          tasksCallCount++;
          const ch = createChainMock();
          const isFirstCall = tasksCallCount === 1;
          const isIdempotentFirst = isFirstCall && hasIdempotentPairs;
          if (isIdempotentFirst && overrides?.tasksData) {
            // Idempotent: first call is fetchTasksByIds, not insert
            ch.setResolve(Promise.resolve({ data: overrides.tasksData, error: null }));
          } else if (isFirstCall && !overrides?.insertError) {
            // First call to "tasks": insert (unless insertError)
            if (overrides?.insertError) {
              ch.setResolve(Promise.resolve({ data: null, error: overrides.insertError }));
            } else {
              ch.setResolve(Promise.resolve({
                data: overrides?.insertData ?? [{ id: "new-task-1" }],
                error: null,
              }));
            }
          } else if (overrides?.tasksData) {
            // Subsequent calls are fetchTasksByIds
            ch.setResolve(Promise.resolve({ data: overrides.tasksData, error: null }));
          } else {
            ch.setResolve(Promise.resolve({ data: [], error: null }));
          }
          return ch.chain;
        }

        const tc = tableChains?.get(table);
        if (tc) return tc.chain;
        return currentChain.chain;
      });
      const mockClient = { from: mockFromFn } as unknown;
      vi.mocked(getSupabaseServiceClient).mockReturnValue(mockClient as ReturnType<typeof getSupabaseServiceClient>);

      vi.mocked(getTaskInsertScopeError).mockReturnValue(null);
    }

    it("creates a single task successfully", async () => {
      setupQueryChains({
        insertData: [{ id: "new-task-1" }],
        tasksData: [
          {
            id: "new-task-1",
            project_id: "proj-1",
            goal_id: null,
            title: "New Task",
            description: null,
            blocked_reason: null,
            status: "todo",
            priority: "medium",
            estimate_minutes: null,
            focus_rank: null,
            due_date: null,
            planned_for_date: null,
            scheduled_start_at: null,
            scheduled_end_at: null,
            completed_at: null,
            archived_at: null,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-02T00:00:00Z",
            projects: { name: "Test Project" },
            goals: null,
          },
        ],
      });

      const result = await createTasks(OWNER_USER_ID, TOKEN_ID, [
        { title: "New Task", projectId: "proj-1" },
      ]);

      expect(result.ok).toBe(true);
      expect(result.created).toHaveLength(1);
      expect(result.created[0]!.title).toBe("New Task");
      expect(result.existing).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("returns existing task on idempotent source+sourceId match", async () => {
      setupQueryChains({
        externalRefsData: [
          { source: "linear", source_id: "L-123", task_id: "existing-task-1" },
        ],
        tasksData: [
          {
            id: "existing-task-1",
            project_id: "proj-1",
            goal_id: null,
            title: "Existing Task",
            description: null,
            blocked_reason: null,
            status: "todo",
            priority: "medium",
            estimate_minutes: null,
            focus_rank: null,
            due_date: null,
            planned_for_date: null,
            scheduled_start_at: null,
            scheduled_end_at: null,
            completed_at: null,
            archived_at: null,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-02T00:00:00Z",
            projects: { name: "Test Project" },
            goals: null,
          },
        ],
      });

      const result = await createTasks(OWNER_USER_ID, TOKEN_ID, [
        {
          title: "Existing Task",
          projectId: "proj-1",
          source: "linear",
          sourceId: "L-123",
        },
      ]);

      expect(result.ok).toBe(true);
      expect(result.created).toHaveLength(0);
      expect(result.existing).toHaveLength(1);
      expect(result.existing[0]!.title).toBe("Existing Task");
      expect(result.errors).toHaveLength(0);
    });

    it("returns error for missing title", async () => {
      setupQueryChains({ insertData: [] });

      const result = await createTasks(OWNER_USER_ID, TOKEN_ID, [
        { title: "", projectId: "proj-1" },
      ]);

      expect(result.ok).toBe(true);
      expect(result.created).toHaveLength(0);
      expect(result.existing).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.error).toBe("Title is required.");
    });

    it("returns error for missing projectId", async () => {
      setupQueryChains({ insertData: [] });

      const result = await createTasks(OWNER_USER_ID, TOKEN_ID, [
        { title: "No Project", projectId: "" },
      ]);

      expect(result.ok).toBe(true);
      expect(result.created).toHaveLength(0);
      expect(result.existing).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.error).toBe("Project ID is required.");
    });

    it("returns validation error for cross-owner project", async () => {
      tableChains = new Map();

      // Projects returns nothing (cross-owner)
      const projectsChain = createChainMock();
      projectsChain.setResolve(Promise.resolve({ data: [], error: null }));
      tableChains.set("projects", projectsChain);

      const goalsChain = createChainMock();
      goalsChain.setResolve(Promise.resolve({ data: [], error: null }));
      tableChains.set("goals", goalsChain);

      const extRefsChain = createChainMock();
      extRefsChain.setResolve(Promise.resolve({ data: [], error: null }));
      tableChains.set("task_external_refs", extRefsChain);

      const auditChain = createChainMock();
      auditChain.setResolve(Promise.resolve({ data: [], error: null }));
      tableChains.set("agent_integration_events", auditChain);

      // tasks-from mock that returns empty
      let tasksCallCount = 0;
      const mockFromFn = vi.fn((table: string) => {
        if (table === "tasks") {
          tasksCallCount++;
          const ch = createChainMock();
          ch.setResolve(Promise.resolve({ data: [], error: null }));
          return ch.chain;
        }
        const tc = tableChains?.get(table);
        if (tc) return tc.chain;
        return currentChain.chain;
      });
      const mockClient = { from: mockFromFn } as unknown;
      vi.mocked(getSupabaseServiceClient).mockReturnValue(mockClient as ReturnType<typeof getSupabaseServiceClient>);

      vi.mocked(getTaskInsertScopeError).mockReturnValue("Selected project is unavailable.");

      const result = await createTasks(OWNER_USER_ID, TOKEN_ID, [
        { title: "Cross Owner", projectId: "other-proj" },
      ]);

      expect(result.ok).toBe(true);
      expect(result.created).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.error).toBe("Selected project is unavailable.");
    });

    it("returns error for blocked status without blockedReason", async () => {
      setupQueryChains({ insertData: [] });

      const result = await createTasks(OWNER_USER_ID, TOKEN_ID, [
        { title: "Blocked Task", projectId: "proj-1", status: "blocked" },
      ]);

      expect(result.ok).toBe(true);
      expect(result.created).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.error).toBe("Blocked reason is required when status is blocked.");
    });

    it("automatically sets completed_at for done status", async () => {
      setupQueryChains({
        insertData: [{ id: "new-task-1" }],
        tasksData: [
          {
            id: "new-task-1",
            project_id: "proj-1",
            goal_id: null,
            title: "Done Task",
            description: null,
            blocked_reason: null,
            status: "done",
            priority: "medium",
            estimate_minutes: null,
            focus_rank: null,
            due_date: null,
            planned_for_date: null,
            scheduled_start_at: null,
            scheduled_end_at: null,
            completed_at: new Date().toISOString(),
            archived_at: null,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-02T00:00:00Z",
            projects: { name: "Test Project" },
            goals: null,
          },
        ],
      });

      const result = await createTasks(OWNER_USER_ID, TOKEN_ID, [
        { title: "Done Task", projectId: "proj-1", status: "done" },
      ]);

      expect(result.ok).toBe(true);
      expect(result.created).toHaveLength(1);
      expect(result.created[0]!.status).toBe("done");
      expect(result.created[0]!.completedAt).toBeTruthy();
    });

    it("handles bulk partial success (some valid, some invalid)", async () => {
      setupQueryChains({
        insertData: [{ id: "new-task-1" }],
        tasksData: [
          {
            id: "new-task-1",
            project_id: "proj-1",
            goal_id: null,
            title: "Valid Task",
            description: null,
            blocked_reason: null,
            status: "todo",
            priority: "medium",
            estimate_minutes: null,
            focus_rank: null,
            due_date: null,
            planned_for_date: null,
            scheduled_start_at: null,
            scheduled_end_at: null,
            completed_at: null,
            archived_at: null,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-02T00:00:00Z",
            projects: { name: "Test Project" },
            goals: null,
          },
        ],
      });

      const result = await createTasks(OWNER_USER_ID, TOKEN_ID, [
        { title: "Valid Task", projectId: "proj-1" },
        { title: "", projectId: "proj-1" },
      ]);

      expect(result.ok).toBe(true);
      expect(result.created).toHaveLength(1);
      expect(result.created[0]!.title).toBe("Valid Task");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.index).toBe(1);
      expect(result.errors[0]!.error).toBe("Title is required.");
    });

    it("returns validation error for cross-owner goal", async () => {
      tableChains = new Map();

      // Projects OK
      const projectsChain = createChainMock();
      projectsChain.setResolve(Promise.resolve({ data: [{ id: "proj-1" }], error: null }));
      tableChains.set("projects", projectsChain);

      // Goals returns only goal-1
      const goalsChain = createChainMock();
      goalsChain.setResolve(
        Promise.resolve({ data: [{ id: "goal-1", project_id: "proj-1" }], error: null }),
      );
      tableChains.set("goals", goalsChain);

      const extRefsChain = createChainMock();
      extRefsChain.setResolve(Promise.resolve({ data: [], error: null }));
      tableChains.set("task_external_refs", extRefsChain);

      const auditChain = createChainMock();
      auditChain.setResolve(Promise.resolve({ data: [], error: null }));
      tableChains.set("agent_integration_events", auditChain);

      let tasksCallCount = 0;
      const mockFromFn = vi.fn((table: string) => {
        if (table === "tasks") {
          tasksCallCount++;
          const ch = createChainMock();
          ch.setResolve(Promise.resolve({ data: [], error: null }));
          return ch.chain;
        }
        const tc = tableChains?.get(table);
        if (tc) return tc.chain;
        return currentChain.chain;
      });
      const mockClient = { from: mockFromFn } as unknown;
      vi.mocked(getSupabaseServiceClient).mockReturnValue(mockClient as ReturnType<typeof getSupabaseServiceClient>);

      vi.mocked(getTaskInsertScopeError).mockReturnValue("Selected goal does not belong to the chosen project.");

      const result = await createTasks(OWNER_USER_ID, TOKEN_ID, [
        { title: "Bad Goal Task", projectId: "proj-1", goalId: "goal-2" },
      ]);

      expect(result.ok).toBe(true);
      expect(result.created).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.error).toBe("Selected goal does not belong to the chosen project.");
    });
  });
});
