import { describe, it, expect, vi, beforeEach } from "vitest";

// Create a proper chain mock for Supabase queries
function createChainMock() {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select", "eq", "is", "in", "neq", "gte", "lte", "not",
    "order", "limit", "maybeSingle", "single",
  ];

  const promiseHandler = {
    apply(target: () => Promise<unknown>, thisArg: unknown, args: unknown[]) {
      return Reflect.apply(target, thisArg, args);
    },
  };

  // Default: resolve to empty success
  let resolveValue: Promise<{ data: unknown[] | null; error: unknown }> = Promise.resolve({ data: [], error: null });

  const setResolve = (value: Promise<{ data: unknown[] | null; error: unknown }>) => {
    resolveValue = value;
  };

  for (const method of methods) {
    chain[method] = vi.fn(() => chain);
  }

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

vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: vi.fn(() => ({
    from: vi.fn(() => currentChain.chain),
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
} from "@/lib/services/agent-task-service";
import { getTaskInsertScopeError } from "@/lib/services/task-service";

const mockFrom = vi.mocked(getSupabaseServiceClient)().from;
const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  currentChain = createChainMock();
  // Make from() return the chain
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
});
